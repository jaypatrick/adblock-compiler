/**
 * HealthMonitoringWorkflow - Scheduled workflow for monitoring filter source health.
 *
 * This workflow periodically checks the availability and validity of upstream
 * filter list sources, tracking health over time and alerting on degradation.
 *
 * Benefits:
 * - Reliable scheduled health checks with durable timers
 * - Historical health tracking for trend analysis
 * - Automatic alerting on source failures
 * - Crash recovery ensures no missed checks
 */

/// <reference types="@cloudflare/workers-types" />

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../worker.ts';
import type { HealthMonitoringParams, HealthMonitoringResult, SourceHealthResult } from './types.ts';
import { WorkflowEvents } from './WorkflowEvents.ts';
import { captureExceptionInIsolate } from '../services/sentry-isolate-init.ts';

/**
 * Default sources to monitor
 */
const DEFAULT_SOURCES = [
    {
        name: 'EasyList',
        url: 'https://easylist.to/easylist/easylist.txt',
        expectedMinRules: 50000,
    },
    {
        name: 'EasyPrivacy',
        url: 'https://easylist.to/easylist/easyprivacy.txt',
        expectedMinRules: 10000,
    },
    {
        name: 'AdGuard Base',
        url: 'https://filters.adtidy.org/extension/chromium/filters/2.txt',
        expectedMinRules: 30000,
    },
    {
        name: 'AdGuard Tracking Protection',
        url: 'https://filters.adtidy.org/extension/chromium/filters/3.txt',
        expectedMinRules: 10000,
    },
    {
        name: "Peter Lowe's List",
        url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
        expectedMinRules: 2000,
    },
];

/**
 * Health status thresholds
 */
const HEALTH_THRESHOLDS = {
    /** Maximum acceptable response time in ms */
    maxResponseTimeMs: 10_000,
    /** Maximum bytes to inspect per source response */
    maxSampleBytes: 8_192,
    /** Minimum expected rules (if not specified per-source) */
    defaultMinRules: 100,
    /** Minimum non-comment rules required in the 8KB sample probe */
    minRulesInSample: 5,
    /** Number of failed checks before alerting */
    failureThreshold: 3,
};

const SOURCE_CHECK_STEP_TIMEOUT_DURATION = '30 seconds';

/**
 * Formats source health-check step errors for alerting and logs.
 *
 * Timeout-style failures are normalized to include the configured step timeout
 * while preserving original error details for troubleshooting.
 */
export function formatHealthCheckStepError(error: unknown, stepTimeout: string = SOURCE_CHECK_STEP_TIMEOUT_DURATION): string {
    const timeoutPattern = /(timeout|timed out|abort|aborted)/i;

    if (error instanceof Error) {
        const message = error.message.trim();
        const isTimeoutError = timeoutPattern.test(error.name) || timeoutPattern.test(message);
        if (isTimeoutError) {
            return `Step timed out after ${stepTimeout} (${message ? `${error.name}: ${message}` : error.name})`;
        }

        return message || error.name || 'Unknown error';
    }

    const fallback = String(error);
    if (timeoutPattern.test(fallback)) {
        return `Step timed out after ${stepTimeout} (${fallback})`;
    }

    return fallback;
}

export async function readResponseSample(response: Response, maxBytes: number): Promise<string> {
    if (!response.body || maxBytes <= 0) {
        return '';
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
        while (totalBytes < maxBytes) {
            const { done, value } = await reader.read();
            if (done || !value) {
                break;
            }

            const remainingBytes = maxBytes - totalBytes;
            if (value.byteLength > remainingBytes) {
                const boundedChunk = value.subarray(0, remainingBytes);
                chunks.push(boundedChunk);
                totalBytes += boundedChunk.byteLength;
                break;
            }

            chunks.push(value);
            totalBytes += value.byteLength;
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }

    if (totalBytes === 0) {
        return '';
    }

    const sampleBytes = new Uint8Array(totalBytes);
    let writeOffset = 0;
    for (const chunk of chunks) {
        sampleBytes.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
    }

    return new TextDecoder().decode(sampleBytes);
}

/**
 * HealthMonitoringWorkflow checks source availability and content validity.
 *
 * Steps:
 * 1. load-history - Load recent health history
 * 2. check-source-N - Check each source
 * 3. analyze-results - Determine if alerts needed
 * 4. store-results - Persist health data
 */
export class HealthMonitoringWorkflow extends WorkflowEntrypoint<Env, HealthMonitoringParams> {
    /**
     * Main workflow execution
     */
    override async run(event: WorkflowEvent<HealthMonitoringParams>, step: WorkflowStep): Promise<HealthMonitoringResult> {
        const startTime = Date.now();
        const {
            runId = `health-${Date.now()}`,
            sources = [],
            alertOnFailure = false,
        } = event.payload;

        // Initialize event emitter for real-time progress tracking
        // Constructor only assigns fields — safe to call even if METRICS is absent.
        const events = new WorkflowEvents(this.env.METRICS, runId, 'health-monitoring');

        // Use provided sources or defaults
        const sourcesToCheck = sources.length > 0 ? sources : DEFAULT_SOURCES;

        console.log(
            `[WORKFLOW:HEALTH] Starting health monitoring (runId: ${runId}, ` +
                `sources: ${sourcesToCheck.length}, alertOnFailure: ${alertOnFailure})`,
        );

        const results: SourceHealthResult[] = [];
        let healthySources = 0;
        let unhealthySources = 0;
        let alertsSent = false;

        try {
            // Fail fast if METRICS KV binding is absent — inside try so the catch
            // handler can call captureExceptionInIsolate and re-throw with context.
            if (!this.env.METRICS) {
                throw new Error('[WORKFLOW:HEALTH] METRICS KV binding is not configured in the Workflow isolate — check wrangler.toml [[workflows]] bindings');
            }

            // Emit workflow started event
            await events.emitWorkflowStarted({
                sourceCount: sourcesToCheck.length,
                alertOnFailure,
            });

            // Step 1: Load recent health history for trend analysis
            await events.emitStepStarted('load-health-history');
            const healthHistory = await step.do('load-health-history', {
                retries: { limit: 1, delay: '1 second' },
            }, async () => {
                console.log(`[WORKFLOW:HEALTH] Loading health history`);

                const historyKey = 'health:history';
                const history = await this.env.METRICS.get(historyKey, 'json') as {
                    checks: Array<{
                        timestamp: string;
                        results: Record<string, { healthy: boolean; responseTimeMs?: number }>;
                    }>;
                } | null;

                return history || { checks: [] };
            });
            await events.emitStepCompleted('load-health-history', { checkCount: healthHistory.checks.length });
            await events.emitProgress(10, 'Health history loaded');

            // Step 2: Check each source
            for (let i = 0; i < sourcesToCheck.length; i++) {
                const source = sourcesToCheck[i];
                const sourceNumber = i + 1;

                await events.emitHealthCheckStarted(source.name, source.url);
                const healthResult = await step.do(`check-source-${sourceNumber}`, {
                    retries: { limit: 2, delay: '5 seconds' },
                    // Applied per attempt by the Workflows runtime; retries may
                    // extend total per-source wall time.
                    timeout: SOURCE_CHECK_STEP_TIMEOUT_DURATION,
                }, async () => {
                    console.log(
                        `[WORKFLOW:HEALTH] Checking source ${sourceNumber}/${sourcesToCheck.length}: ${source.name}`,
                    );

                    const checkStart = Date.now();
                    const result: SourceHealthResult = {
                        name: source.name,
                        url: source.url,
                        healthy: false,
                        lastChecked: new Date().toISOString(),
                    };

                    try {
                        const response = await fetch(source.url, {
                            method: 'GET',
                            headers: {
                                'User-Agent': 'AdblockCompiler-HealthCheck/1.0',
                                'Range': 'bytes=0-8191',
                            },
                            signal: AbortSignal.timeout(HEALTH_THRESHOLDS.maxResponseTimeMs),
                        });

                        result.statusCode = response.status;
                        result.responseTimeMs = Date.now() - checkStart;

                        if (response.status !== 200 && response.status !== 206) {
                            result.error = `HTTP ${response.status}: ${response.statusText}`;
                            return result;
                        }

                        const sample = await readResponseSample(response, HEALTH_THRESHOLDS.maxSampleBytes);
                        const sampleLines = sample.split('\n').filter((line) => {
                            const trimmed = line.trim();
                            return trimmed && !trimmed.startsWith('!') && !trimmed.startsWith('#');
                        });

                        result.ruleCount = sampleLines.length;

                        // For an 8KB sample probe, cap the minimum to a small
                        // threshold so large-list expected counts do not reject
                        // otherwise healthy partial responses.
                        const minRules = Math.min(
                            source.expectedMinRules || HEALTH_THRESHOLDS.defaultMinRules,
                            HEALTH_THRESHOLDS.minRulesInSample,
                        );
                        if (sampleLines.length < minRules) {
                            result.error = `Source appears empty - only ${sampleLines.length} rules found in 8KB sample`;
                            return result;
                        }

                        // All checks passed
                        result.healthy = true;
                        console.log(
                            `[WORKFLOW:HEALTH] Source "${source.name}" healthy: ` +
                                `${result.ruleCount} rules, ${result.responseTimeMs}ms`,
                        );
                    } catch (error) {
                        result.responseTimeMs = Date.now() - checkStart;
                        result.error = formatHealthCheckStepError(error);

                        console.error(
                            `[WORKFLOW:HEALTH] Source "${source.name}" unhealthy: ${result.error}`,
                        );
                    }

                    return result;
                });

                results.push(healthResult);
                if (healthResult.healthy) {
                    healthySources++;
                } else {
                    unhealthySources++;
                }

                await events.emitHealthCheckCompleted(
                    source.name,
                    healthResult.healthy,
                    healthResult.responseTimeMs,
                    healthResult.ruleCount,
                );

                const checkProgress = 10 + Math.round(((i + 1) / sourcesToCheck.length) * 60);
                await events.emitProgress(checkProgress, `Checked ${sourceNumber}/${sourcesToCheck.length} sources`);

                // Small delay between checks to avoid rate limiting
                if (i < sourcesToCheck.length - 1) {
                    await step.sleep(`delay-after-${sourceNumber}`, '2 seconds');
                }
            }

            // Step 3: Analyze results and determine if alerts needed
            await events.emitStepStarted('analyze-results', { resultCount: results.length });
            const alertAnalysis = await step.do('analyze-results', {
                retries: { limit: 1, delay: '1 second' },
            }, async () => {
                console.log(`[WORKFLOW:HEALTH] Analyzing health results`);

                const shouldAlert: string[] = [];

                if (!alertOnFailure) {
                    return { shouldAlert: [], triggeredAlerts: false };
                }

                // Check for consecutive failures
                for (const result of results) {
                    if (!result.healthy) {
                        // Count recent failures for this source
                        let consecutiveFailures = 1;
                        for (const check of healthHistory.checks.slice(0, HEALTH_THRESHOLDS.failureThreshold - 1)) {
                            const sourceCheck = check.results[result.name];
                            if (sourceCheck && !sourceCheck.healthy) {
                                consecutiveFailures++;
                            } else {
                                break;
                            }
                        }

                        if (consecutiveFailures >= HEALTH_THRESHOLDS.failureThreshold) {
                            shouldAlert.push(result.name);
                        }
                    }
                }

                return {
                    shouldAlert,
                    triggeredAlerts: shouldAlert.length > 0,
                };
            });
            await events.emitStepCompleted('analyze-results', {
                alertsNeeded: alertAnalysis.shouldAlert.length,
            });
            await events.emitProgress(75, 'Analysis complete');

            // Step 4: Send alerts if needed
            if (alertAnalysis.triggeredAlerts && alertAnalysis.shouldAlert.length > 0) {
                await step.do('send-alerts', {
                    retries: { limit: 2, delay: '5 seconds' },
                }, async () => {
                    console.warn(
                        `[WORKFLOW:HEALTH] ALERT: Sources with consecutive failures: ` +
                            alertAnalysis.shouldAlert.join(', '),
                    );

                    // In a real implementation, you would send alerts via:
                    // - Email (via SendGrid, etc.)
                    // - Slack webhook
                    // - PagerDuty
                    // - Custom webhook

                    // For now, we log and store the alert
                    const alertKey = `health:alerts:${runId}`;
                    await this.env.METRICS.put(
                        alertKey,
                        JSON.stringify({
                            timestamp: new Date().toISOString(),
                            runId,
                            failedSources: alertAnalysis.shouldAlert,
                            results: results.filter((r) => alertAnalysis.shouldAlert.includes(r.name)),
                        }),
                        {
                            expirationTtl: 86400 * 7, // 7 days
                        },
                    );

                    return { sent: true };
                });

                alertsSent = true;
            }

            // Step 5: Store health results
            await events.emitStepStarted('store-results');
            await step.do('store-results', {
                retries: { limit: 2, delay: '2 seconds' },
            }, async () => {
                console.log(`[WORKFLOW:HEALTH] Storing health results`);

                // Store current check
                const checkRecord: Record<string, { healthy: boolean; responseTimeMs?: number }> = {};
                for (const result of results) {
                    checkRecord[result.name] = {
                        healthy: result.healthy,
                        responseTimeMs: result.responseTimeMs,
                    };
                }

                // Update history (keep last 100 checks)
                healthHistory.checks.unshift({
                    timestamp: new Date().toISOString(),
                    results: checkRecord,
                });
                if (healthHistory.checks.length > 100) {
                    healthHistory.checks = healthHistory.checks.slice(0, 100);
                }

                await this.env.METRICS.put('health:history', JSON.stringify(healthHistory), {
                    expirationTtl: 86400 * 30, // 30 days
                });

                // Store latest results for quick access
                await this.env.METRICS.put(
                    'health:latest',
                    JSON.stringify({
                        timestamp: new Date().toISOString(),
                        runId,
                        results,
                        summary: {
                            total: sourcesToCheck.length,
                            healthy: healthySources,
                            unhealthy: unhealthySources,
                        },
                    }),
                    {
                        expirationTtl: 86400, // 24 hours
                    },
                );

                // Update aggregate metrics
                const metricsKey = 'workflow:health:metrics';
                const existingMetrics = await this.env.METRICS.get(metricsKey, 'json') as {
                    totalChecks: number;
                    totalSourcesChecked: number;
                    totalHealthy: number;
                    totalUnhealthy: number;
                    alertsTriggered: number;
                    lastCheckAt: string;
                    avgCheckDurationMs: number;
                } | null;

                const metrics = existingMetrics || {
                    totalChecks: 0,
                    totalSourcesChecked: 0,
                    totalHealthy: 0,
                    totalUnhealthy: 0,
                    alertsTriggered: 0,
                    lastCheckAt: '',
                    avgCheckDurationMs: 0,
                };

                const totalDuration = Date.now() - startTime;
                metrics.totalChecks++;
                metrics.totalSourcesChecked += sourcesToCheck.length;
                metrics.totalHealthy += healthySources;
                metrics.totalUnhealthy += unhealthySources;
                if (alertsSent) {
                    metrics.alertsTriggered++;
                }
                metrics.lastCheckAt = new Date().toISOString();
                metrics.avgCheckDurationMs = Math.round(
                    (metrics.avgCheckDurationMs * (metrics.totalChecks - 1) + totalDuration) /
                        metrics.totalChecks,
                );

                await this.env.METRICS.put(metricsKey, JSON.stringify(metrics), {
                    expirationTtl: 86400 * 30,
                });

                return { stored: true };
            });
            await events.emitStepCompleted('store-results');

            const totalDuration = Date.now() - startTime;

            // Emit workflow completed event
            await events.emitProgress(100, 'Health monitoring complete');
            await events.emitWorkflowCompleted({
                healthySources,
                unhealthySources,
                alertsSent,
                totalDurationMs: totalDuration,
            });
            await events.flush();

            console.log(
                `[WORKFLOW:HEALTH] Health monitoring completed: ${healthySources}/${sourcesToCheck.length} ` +
                    `healthy in ${totalDuration}ms (runId: ${runId})`,
            );

            return {
                runId,
                sourcesChecked: sourcesToCheck.length,
                healthySources,
                unhealthySources,
                results,
                alertsSent,
                totalDurationMs: totalDuration,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await captureExceptionInIsolate(this.env, error);
            console.error(`[WORKFLOW:HEALTH] Health monitoring failed (runId: ${runId}): ${errorMessage}`);

            // Only emit failure events when METRICS is available. If the guard threw
            // because METRICS is absent, calling events.flush() would trigger a secondary
            // KV error with a misleading log line. captureExceptionInIsolate above already
            // sends the real error to Sentry.
            if (this.env.METRICS) {
                await events.emitWorkflowFailed(errorMessage, {
                    healthySources,
                    unhealthySources,
                    alertsSent,
                });
                await events.flush();
            }

            // Always throw an Error instance so CF Workflows telemetry captures the real
            // message (non-Error throws are logged as the generic category label "workflow").
            throw error instanceof Error ? error : new Error(`[WORKFLOW:HEALTH] run=${runId}: ${errorMessage}`);
        }
    }
}

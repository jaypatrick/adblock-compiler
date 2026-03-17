/**
 * Workflow API handlers for the Cloudflare Worker.
 * Provides endpoints for triggering and monitoring Cloudflare Workflows.
 *
 * ZTA: All workflow endpoints require authentication (requireAuth) and
 * rate limiting (checkRateLimitTiered). Security events are emitted via
 * analytics.trackSecurityEvent() on auth/rate failures.
 */

import type { BatchCompilationParams, CacheWarmingParams, CompilationParams, HealthMonitoringParams } from '../workflows/index.ts';
import { generateWorkflowId } from '../utils/index.ts';
import type { Env, IAuthContext, Priority, Workflow } from '../types.ts';
import type { IConfiguration } from '../../src/types/index.ts';
import type { CompileRequest } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { checkRateLimitTiered } from '../middleware/index.ts';
import { requireAuth } from '../middleware/auth.ts';

// ============================================================================
// Constants
// ============================================================================

/**
 * Error message returned when Workflow bindings are not configured.
 */
export const WORKFLOW_BINDINGS_NOT_AVAILABLE_ERROR = 'Workflow bindings are not available. ' +
    'Workflows must be configured in wrangler.toml. See the Cloudflare Workflows documentation for setup instructions.';

// ============================================================================
// Workflow Handlers
// ============================================================================

/**
 * Handle workflow-based async compilation.
 * POST /api/workflow/compile
 */
export async function handleWorkflowCompile(
    request: Request,
    env: Env,
): Promise<Response> {
    if (!env.COMPILATION_WORKFLOW) {
        return Response.json(
            { success: false, error: WORKFLOW_BINDINGS_NOT_AVAILABLE_ERROR },
            { status: 503 },
        );
    }

    try {
        const body = await request.json() as CompileRequest;
        const { configuration, preFetchedContent, benchmark, priority } = body;

        const params: CompilationParams = {
            requestId: generateWorkflowId('wf-compile'),
            configuration,
            preFetchedContent,
            benchmark,
            priority,
            queuedAt: Date.now(),
        };

        const instance = await env.COMPILATION_WORKFLOW.create({
            id: params.requestId,
            params,
        });

        // deno-lint-ignore no-console
        console.log(`[WORKFLOW:API] Created compilation workflow instance: ${instance.id}`);

        return Response.json(
            {
                success: true,
                message: 'Compilation workflow started',
                workflowId: instance.id,
                workflowType: 'compilation',
            },
            { status: 202 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[WORKFLOW:API] Failed to create compilation workflow:', message);
        return Response.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * Handle workflow-based batch compilation.
 * POST /api/workflow/batch
 */
export async function handleWorkflowBatchCompile(
    request: Request,
    env: Env,
): Promise<Response> {
    if (!env.BATCH_COMPILATION_WORKFLOW) {
        return Response.json(
            { success: false, error: WORKFLOW_BINDINGS_NOT_AVAILABLE_ERROR },
            { status: 503 },
        );
    }

    try {
        interface BatchRequest {
            requests: Array<{
                id: string;
                configuration: IConfiguration;
                preFetchedContent?: Record<string, string>;
                benchmark?: boolean;
            }>;
            priority?: Priority;
        }

        const body = await request.json() as BatchRequest;
        const { requests, priority } = body;

        if (!requests || !Array.isArray(requests) || requests.length === 0) {
            return Response.json(
                { success: false, error: 'Invalid batch request' },
                { status: 400 },
            );
        }

        const batchId = generateWorkflowId('wf-batch');
        const params: BatchCompilationParams = {
            batchId,
            requests,
            priority,
            queuedAt: Date.now(),
        };

        const instance = await env.BATCH_COMPILATION_WORKFLOW.create({
            id: batchId,
            params,
        });

        // deno-lint-ignore no-console
        console.log(`[WORKFLOW:API] Created batch compilation workflow: ${instance.id} (${requests.length} items)`);

        return Response.json(
            {
                success: true,
                message: 'Batch compilation workflow started',
                workflowId: instance.id,
                workflowType: 'batch-compilation',
                batchSize: requests.length,
            },
            { status: 202 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[WORKFLOW:API] Failed to create batch compilation workflow:', message);
        return Response.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * Handle manual cache warming trigger.
 * POST /api/workflow/cache-warm
 */
export async function handleWorkflowCacheWarm(
    request: Request,
    env: Env,
): Promise<Response> {
    if (!env.CACHE_WARMING_WORKFLOW) {
        return Response.json(
            { success: false, error: WORKFLOW_BINDINGS_NOT_AVAILABLE_ERROR },
            { status: 503 },
        );
    }

    try {
        const body = await request.json() as { configurations?: IConfiguration[] };
        const configurations = body.configurations || [];

        const runId = generateWorkflowId('wf-cache-warm');
        const params: CacheWarmingParams = {
            runId,
            configurations,
            scheduled: false,
        };

        const instance = await env.CACHE_WARMING_WORKFLOW.create({
            id: runId,
            params,
        });

        // deno-lint-ignore no-console
        console.log(`[WORKFLOW:API] Created cache warming workflow: ${instance.id}`);

        return Response.json(
            {
                success: true,
                message: 'Cache warming workflow started',
                workflowId: instance.id,
                workflowType: 'cache-warming',
                configurationsCount: configurations.length || 'default',
            },
            { status: 202 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[WORKFLOW:API] Failed to create cache warming workflow:', message);
        return Response.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * Handle manual health monitoring trigger.
 * POST /api/workflow/health-check
 */
export async function handleWorkflowHealthCheck(
    request: Request,
    env: Env,
): Promise<Response> {
    if (!env.HEALTH_MONITORING_WORKFLOW) {
        return Response.json(
            { success: false, error: WORKFLOW_BINDINGS_NOT_AVAILABLE_ERROR },
            { status: 503 },
        );
    }

    try {
        const body = await request.json() as {
            sources?: Array<{ name: string; url: string; expectedMinRules?: number }>;
            alertOnFailure?: boolean;
        };

        const runId = generateWorkflowId('wf-health');
        const params: HealthMonitoringParams = {
            runId,
            sources: body.sources || [],
            alertOnFailure: body.alertOnFailure ?? true,
        };

        const instance = await env.HEALTH_MONITORING_WORKFLOW.create({
            id: runId,
            params,
        });

        // deno-lint-ignore no-console
        console.log(`[WORKFLOW:API] Created health monitoring workflow: ${instance.id}`);

        return Response.json(
            {
                success: true,
                message: 'Health monitoring workflow started',
                workflowId: instance.id,
                workflowType: 'health-monitoring',
                sourcesCount: body.sources?.length || 'default',
            },
            { status: 202 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[WORKFLOW:API] Failed to create health monitoring workflow:', message);
        return Response.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * Get workflow instance status.
 * GET /api/workflow/status/:workflowType/:workflowId
 */
export async function handleWorkflowStatus(
    workflowType: string,
    workflowId: string,
    env: Env,
): Promise<Response> {
    let workflow: Workflow<unknown> | undefined;

    switch (workflowType) {
        case 'compilation':
            workflow = env.COMPILATION_WORKFLOW;
            break;
        case 'batch-compilation':
            workflow = env.BATCH_COMPILATION_WORKFLOW;
            break;
        case 'cache-warming':
            workflow = env.CACHE_WARMING_WORKFLOW;
            break;
        case 'health-monitoring':
            workflow = env.HEALTH_MONITORING_WORKFLOW;
            break;
        default:
            return Response.json(
                { success: false, error: `Unknown workflow type: ${workflowType}` },
                { status: 400 },
            );
    }

    if (!workflow) {
        return Response.json(
            { success: false, error: WORKFLOW_BINDINGS_NOT_AVAILABLE_ERROR },
            { status: 503 },
        );
    }

    try {
        const instance = await workflow.get(workflowId);
        const status = await instance.status();

        return Response.json({
            success: true,
            workflowId,
            workflowType,
            status: status.status,
            output: status.output,
            error: status.error,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ success: false, error: message }, { status: 404 });
    }
}

/**
 * Get aggregated workflow metrics.
 * GET /api/workflow/metrics
 */
export async function handleWorkflowMetrics(env: Env): Promise<Response> {
    try {
        const [compileMetrics, batchMetrics, cacheWarmMetrics, healthMetrics] = await Promise.all([
            env.METRICS.get('workflow:compile:metrics', 'json'),
            env.METRICS.get('workflow:batch:metrics', 'json'),
            env.METRICS.get('workflow:cache-warm:metrics', 'json'),
            env.METRICS.get('workflow:health:metrics', 'json'),
        ]);

        return Response.json({
            success: true,
            timestamp: new Date().toISOString(),
            workflows: {
                compilation: compileMetrics || { totalCompilations: 0 },
                batchCompilation: batchMetrics || { totalBatches: 0 },
                cacheWarming: cacheWarmMetrics || { totalRuns: 0 },
                healthMonitoring: healthMetrics || { totalChecks: 0 },
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * Get workflow events for real-time progress tracking.
 * GET /api/workflow/events/:workflowId
 */
export async function handleWorkflowEvents(
    workflowId: string,
    env: Env,
    since?: string,
): Promise<Response> {
    try {
        const eventsKey = `workflow:events:${workflowId}`;
        const eventLog = await env.METRICS.get(eventsKey, 'json') as {
            workflowId: string;
            workflowType: string;
            startedAt: string;
            completedAt?: string;
            events: Array<{
                type: string;
                workflowId: string;
                workflowType: string;
                timestamp: string;
                step?: string;
                progress?: number;
                message?: string;
                data?: Record<string, unknown>;
            }>;
        } | null;

        if (!eventLog) {
            return Response.json({
                success: true,
                workflowId,
                events: [],
                message: 'No events found for this workflow',
            });
        }

        let events = eventLog.events;
        if (since) {
            const sinceTime = new Date(since).getTime();
            events = events.filter((e) => new Date(e.timestamp).getTime() > sinceTime);
        }

        const progressEvents = eventLog.events.filter((e) => e.type === 'workflow:progress');
        const latestProgress = progressEvents.length > 0 ? (progressEvents[progressEvents.length - 1].progress ?? 0) : 0;

        const isComplete = eventLog.events.some(
            (e) => e.type === 'workflow:completed' || e.type === 'workflow:failed',
        );

        return Response.json({
            success: true,
            workflowId,
            workflowType: eventLog.workflowType,
            startedAt: eventLog.startedAt,
            completedAt: eventLog.completedAt,
            progress: latestProgress,
            isComplete,
            events,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ success: false, error: message }, { status: 500 });
    }
}

// ============================================================================
// Workflow Route Handler (for lazy import from worker.ts)
// ============================================================================

/**
 * Route handler for all /workflow/* endpoints.
 *
 * ZTA: Auth guard and rate limiting are applied before any business logic.
 * Security events are emitted on auth/rate failures.
 *
 * @param routePath - Path with /api prefix stripped (e.g. "/workflow/compile")
 * @param request - Incoming request
 * @param env - Worker environment bindings
 * @param authContext - Authenticated request context
 * @param analytics - Analytics service instance
 * @param ip - Client IP address
 * @param url - Parsed request URL
 */
export async function routeWorkflow(
    routePath: string,
    request: Request,
    env: Env,
    authContext: IAuthContext,
    analytics: AnalyticsService,
    ip: string,
    url: URL,
): Promise<Response> {
    // ZTA: require authentication
    const workflowAuthGuard = requireAuth(authContext);
    if (workflowAuthGuard) {
        analytics.trackSecurityEvent({
            eventType: 'auth_failure',
            path: routePath,
            method: request.method,
            clientIpHash: AnalyticsService.hashIp(ip),
            reason: 'unauthenticated_workflow_access',
        });
        return workflowAuthGuard;
    }

    // ZTA: rate limiting
    const workflowRl = await checkRateLimitTiered(env, ip, authContext);
    if (!workflowRl.allowed) {
        analytics.trackSecurityEvent({
            eventType: 'rate_limit',
            path: routePath,
            method: request.method,
            clientIpHash: AnalyticsService.hashIp(ip),
            tier: authContext.tier,
            reason: 'workflow_rate_limit_exceeded',
        });
        return Response.json(
            { success: false, error: 'Rate limit exceeded' },
            {
                status: 429,
                headers: {
                    'Retry-After': String(Math.ceil((workflowRl.resetAt - Date.now()) / 1000)),
                    'X-RateLimit-Limit': String(workflowRl.limit),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(workflowRl.resetAt),
                },
            },
        );
    }

    if (routePath === '/workflow/compile' && request.method === 'POST') {
        return handleWorkflowCompile(request, env);
    }

    if (routePath === '/workflow/batch' && request.method === 'POST') {
        return handleWorkflowBatchCompile(request, env);
    }

    if (routePath === '/workflow/cache-warm' && request.method === 'POST') {
        return handleWorkflowCacheWarm(request, env);
    }

    if (routePath === '/workflow/health-check' && request.method === 'POST') {
        return handleWorkflowHealthCheck(request, env);
    }

    if (routePath.startsWith('/workflow/status/') && request.method === 'GET') {
        const parts = routePath.split('/');
        if (parts.length >= 5) {
            const workflowType = parts[3];
            const instanceId = parts[4];
            return handleWorkflowStatus(workflowType, instanceId, env);
        }
        return Response.json(
            { success: false, error: 'Invalid workflow status path. Use /workflow/status/:type/:id' },
            { status: 400 },
        );
    }

    if (routePath === '/workflow/metrics' && request.method === 'GET') {
        return handleWorkflowMetrics(env);
    }

    if (routePath.startsWith('/workflow/events/') && request.method === 'GET') {
        const parts = routePath.split('/');
        if (parts.length >= 4) {
            const workflowId = parts[3];
            const since = url.searchParams.get('since') || undefined;
            return handleWorkflowEvents(workflowId, env, since);
        }
        return Response.json(
            { success: false, error: 'Invalid workflow events path. Use /workflow/events/:workflowId' },
            { status: 400 },
        );
    }

    return Response.json({ success: false, error: 'Not found' }, { status: 404 });
}

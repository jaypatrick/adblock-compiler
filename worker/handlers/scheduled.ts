/**
 * Scheduled (CRON) handler for the Cloudflare Worker.
 *
 * Triggered by `workerHandler.scheduled()`; fires Workflow instances
 * for cache-warming (every 6 h) and health-monitoring (every 1 h).
 * Also runs the Page Shield script sync on the hourly `0 * * * *` trigger.
 */

import type { Env } from '../types.ts';
import { createCloudflareApiService, type PageShieldScript } from '../../src/services/cloudflareApiService.ts';
import {
    PAGE_SHIELD_ALLOW_THRESHOLD,
    PAGE_SHIELD_BLOCK_THRESHOLD,
    toAllowRule,
    toBlockRule,
} from '../../src/utils/pageshield-rules.ts';

// ── Page Shield ───────────────────────────────────────────────────────────────

// KV entries expire after two cron cycles (1 h each) to provide a buffer window
// in case a sync run fails. Stale data is preferable to a cache miss.
const PAGE_SHIELD_KV_TTL_SECONDS = 7200;

/**
 * Fetches Page Shield scripts and stores generated ABP rules in Cloudflare KV.
 *
 * Malicious scripts (malicious_score > 0.7) are stored as block rules under
 * `pageshield:blocklist`. Trusted scripts (malicious_score < 0.1) are stored
 * as allow rules under `pageshield:allowlist`.
 *
 * Requires `CF_ZONE_ID` and `CF_PAGE_SHIELD_API_TOKEN` Worker secrets.
 *
 * @param env - Worker environment bindings.
 */
async function syncPageShieldScripts(env: Env): Promise<void> {
    const zoneId = env.CF_ZONE_ID;
    const apiToken = env.CF_PAGE_SHIELD_API_TOKEN;

    if (!zoneId || !apiToken) {
        // deno-lint-ignore no-console
        console.warn('[pageshield:sync] CF_ZONE_ID or CF_PAGE_SHIELD_API_TOKEN not set — skipping');
        return;
    }

    // deno-lint-ignore no-console
    console.log('[pageshield:sync] Fetching Page Shield scripts…');

    const cfApi = createCloudflareApiService({ apiToken });
    const scripts = await cfApi.getPageShieldScripts(zoneId);

    // Narrow once to scripts that Cloudflare has already scored, eliminating
    // the repeated `typeof s.malicious_score === 'number'` guard below.
    const scoredScripts = scripts.filter(
        (s): s is PageShieldScript & { malicious_score: number } =>
            typeof s.malicious_score === 'number',
    );

    const blockRules = [...new Set(
        scoredScripts
            .filter((s) => s.malicious_score > PAGE_SHIELD_BLOCK_THRESHOLD)
            .map((s) => toBlockRule(s.url)),
    )];

    const allowRules = [...new Set(
        scoredScripts
            .filter((s) => s.malicious_score < PAGE_SHIELD_ALLOW_THRESHOLD)
            .map((s) => toAllowRule(s.url)),
    )];

    // Persist to KV so compiler routes can include them as optional sources.
    if (env.COMPILATION_CACHE) {
        const timestamp = new Date().toISOString();
        const blockContent = `! Page Shield Blocklist\n! Generated: ${timestamp}\n${blockRules.join('\n')}\n`;
        const allowContent = `! Page Shield Allowlist\n! Generated: ${timestamp}\n${allowRules.join('\n')}\n`;

        await env.COMPILATION_CACHE.put('pageshield:blocklist', blockContent, { expirationTtl: PAGE_SHIELD_KV_TTL_SECONDS });
        await env.COMPILATION_CACHE.put('pageshield:allowlist', allowContent, { expirationTtl: PAGE_SHIELD_KV_TTL_SECONDS });
    }

    // deno-lint-ignore no-console
    console.log(`[pageshield:sync] ${blockRules.length} block rules, ${allowRules.length} allow rules — done`);
}

// ── Scheduled handler ─────────────────────────────────────────────────────────

/**
 * Handle a scheduled Cloudflare cron trigger.
 *
 * @param controller - Provides the cron pattern that fired.
 * @param env        - Worker environment bindings.
 */
export async function handleScheduled(
    controller: ScheduledController,
    env: Env,
): Promise<void> {
    const cronPattern = controller.cron;
    const runId = `scheduled-${Date.now()}`;
    // deno-lint-ignore no-console
    console.log(`[CRON] Scheduled event triggered: ${cronPattern} (runId: ${runId})`);
    try {
        if (cronPattern === '0 */6 * * *' && env.CACHE_WARMING_WORKFLOW) {
            const instance = await env.CACHE_WARMING_WORKFLOW.create({
                id: `cache-warm-${runId}`,
                params: { runId: `cron-${runId}`, configurations: [], scheduled: true },
            });
            // deno-lint-ignore no-console
            console.log(`[CRON] Started cache warming workflow: ${instance.id}`);
        } else if (cronPattern === '0 */6 * * *') {
            // deno-lint-ignore no-console
            console.warn('[CRON] CACHE_WARMING_WORKFLOW not available');
        }
        if (cronPattern === '0 * * * *' && env.HEALTH_MONITORING_WORKFLOW) {
            const instance = await env.HEALTH_MONITORING_WORKFLOW.create({
                id: `health-check-${runId}`,
                params: { runId: `cron-${runId}`, sources: [], alertOnFailure: true },
            });
            // deno-lint-ignore no-console
            console.log(`[CRON] Started health monitoring workflow: ${instance.id}`);
        } else if (cronPattern === '0 * * * *') {
            // deno-lint-ignore no-console
            console.warn('[CRON] HEALTH_MONITORING_WORKFLOW not available');
        }
        // Page Shield sync runs on the same hourly trigger as health monitoring.
        if (cronPattern === '0 * * * *') {
            await syncPageShieldScripts(env);
        }
    } catch (error) {
        // deno-lint-ignore no-console
        console.error(`[CRON] Failed to start scheduled workflow (${cronPattern}):`, error);
    }
}

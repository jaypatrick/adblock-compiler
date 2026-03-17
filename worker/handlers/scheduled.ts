/**
 * Scheduled (CRON) handler for the Cloudflare Worker.
 *
 * Triggered by `workerHandler.scheduled()`; fires Workflow instances
 * for cache-warming (every 6 h) and health-monitoring (every 1 h).
 */

import type { Env } from '../types.ts';

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
    } catch (error) {
        // deno-lint-ignore no-console
        console.error(`[CRON] Failed to start scheduled workflow (${cronPattern}):`, error);
    }
}

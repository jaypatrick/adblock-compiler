/**
 * Scheduled (CRON) handler for the Cloudflare Worker.
 *
 * Triggered by `workerHandler.scheduled()`; fires Workflow instances
 * for cache-warming (every 6 h) and health-monitoring (every 1 h).
 */

import type { Env } from '../types.ts';

// ── Page Shield ───────────────────────────────────────────────────────────────

/**
 * Module-level flag to suppress repeated warnings within the same isolate
 * lifetime.  The cron fires hourly; without this the Worker logs would fill
 * with identical "disabled" messages every hour.
 */
let _pageShieldWarnLogged = false;

/**
 * Page Shield sync is intentionally disabled until the generated KV entries are
 * consumed by the compilation pipeline or another in-repo reader.
 *
 * Keeping this as a no-op avoids an hourly Cloudflare API call and unused KV
 * writes to `pageshield:blocklist` / `pageshield:allowlist`.
 *
 * The warning is emitted only once per isolate lifetime (guarded by
 * `_pageShieldWarnLogged`) to avoid alert fatigue in production logs.
 *
 * @param _env - Worker environment bindings.
 */
async function syncPageShieldScripts(_env: Env): Promise<void> {
    if (!_pageShieldWarnLogged) {
        // deno-lint-ignore no-console
        console.warn('[pageshield:sync] Disabled: no in-repo consumer for pageshield:blocklist or pageshield:allowlist yet');
        _pageShieldWarnLogged = true;
    }
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
        // Page Shield sync: no-op until a KV consumer is wired into the pipeline.
        if (cronPattern === '0 * * * *') {
            await syncPageShieldScripts(env);
        }
    } catch (error) {
        // deno-lint-ignore no-console
        console.error(`[CRON] Failed to start scheduled workflow (${cronPattern}):`, error);
    }
}

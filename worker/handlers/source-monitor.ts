/**
 * Source monitor handler — POST /browser/monitor
 *
 * Accepts a list of filter-list source URLs, takes a full-page screenshot of
 * each one via Cloudflare Browser Rendering, writes a health summary to KV,
 * and returns the results immediately.  Screenshots are stored to R2 when
 * `storeScreenshots: true` and the `FILTER_STORAGE` binding is configured.
 *
 * WHY: Filter list maintainers occasionally break their hosting without notice.
 * This endpoint enables proactive visibility into source health — we can detect
 * when a source has gone behind a paywall, shows an error page, or changed
 * structure *before* a compilation run fails.
 *
 * The handler uses `ctx.waitUntil()` to persist the KV summary without blocking
 * the HTTP response.
 */

import { takeSourceScreenshot } from './browser.ts';
import { JsonResponse } from '../utils/index.ts';
import type { Env, SourceMonitorRequest, SourceMonitorResponse, SourceMonitorResult } from '../types.ts';

const SOURCE_MONITOR_KV_KEY = 'SOURCE_MONITOR_RESULTS';

/**
 * Handles POST /browser/monitor requests.
 *
 * Request body: `{ "urls": ["https://..."], "storeScreenshots": true }`
 * Response: health summary with per-URL status and optional screenshot keys.
 *
 * Returns 503 if `env.BROWSER` is not configured.
 * Returns 400 for invalid request bodies.
 */
export async function handleSourceMonitor(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
): Promise<Response> {
    if (!env.BROWSER) {
        return JsonResponse.error(
            'Browser Rendering binding (BROWSER) is not configured. ' +
                'Add a [browser] section to wrangler.toml to enable this endpoint.',
            503,
        );
    }

    let body: SourceMonitorRequest;
    try {
        body = await request.json() as SourceMonitorRequest;
    } catch {
        return JsonResponse.error('Invalid JSON request body', 400);
    }

    if (!Array.isArray(body.urls) || body.urls.length === 0) {
        return JsonResponse.error('Request body must include a non-empty "urls" array', 400);
    }

    const storeScreenshots = body.storeScreenshots ?? false;
    const r2Bucket = storeScreenshots ? env.FILTER_STORAGE : undefined;

    const results: SourceMonitorResult[] = await Promise.all(
        body.urls.map(async (url): Promise<SourceMonitorResult> => {
            try {
                const { screenshotBase64, storedKey } = await takeSourceScreenshot(
                    env.BROWSER!,
                    url,
                    r2Bucket,
                );
                const result: SourceMonitorResult = { url, status: 'ok' };
                if (storedKey) {
                    result.screenshotKey = storedKey;
                }
                if (!storedKey && storeScreenshots) {
                    // Screenshot was taken but not stored (no R2) — include base64 inline
                    result.screenshotBase64 = screenshotBase64;
                }
                return result;
            } catch (err) {
                return {
                    url,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        }),
    );

    const response: SourceMonitorResponse = {
        checked: results.length,
        results,
    };

    // Persist health summary to KV in the background so the response is not delayed.
    ctx.waitUntil(
        env.COMPILATION_CACHE.put(SOURCE_MONITOR_KV_KEY, JSON.stringify({
            ...response,
            checkedAt: new Date().toISOString(),
        })).catch((err) => {
            // deno-lint-ignore no-console
            console.warn('[source-monitor] Failed to persist results to KV:', err instanceof Error ? err.message : String(err));
        }),
    );

    return JsonResponse.success(response);
}

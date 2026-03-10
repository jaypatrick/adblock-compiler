/**
 * URL resolver handler — POST /browser/resolve-url
 *
 * Resolves the canonical URL of a given address by following all redirects —
 * including JS-triggered ones — in a headless Chromium browser.
 *
 * WHY: Some filter-list distributors use short links, CDN redirects, or mirror
 * systems.  `fetch()` follows HTTP redirects but cannot follow JS-triggered
 * ones.  Consumers of this service (other workers, CI pipelines) may need the
 * fully-resolved canonical URL before caching or storing filter list metadata.
 * Caching the result in D1 or KV reduces redirect hops on every compilation run.
 *
 * Returns 503 if `env.BROWSER` is not configured.
 */

import { resolveCanonicalUrl } from './browser.ts';
import { JsonResponse } from '../utils/index.ts';
import type { Env, UrlResolveRequest, UrlResolveResponse } from '../types.ts';

/**
 * Handles POST /browser/resolve-url requests.
 *
 * Request body: `{ "url": "https://short.link/abc" }`
 * Response: `{ "canonical": "https://example.com/list.txt", "hops": 2 }`
 *
 * Returns 503 if `env.BROWSER` is not configured.
 * Returns 400 for invalid request bodies or missing URL field.
 */
export async function handleUrlResolve(
    request: Request,
    env: Env,
): Promise<Response> {
    if (!env.BROWSER) {
        return JsonResponse.error(
            'Browser Rendering binding (BROWSER) is not configured. ' +
                'Add a [browser] section to wrangler.toml to enable this endpoint.',
            503,
        );
    }

    let body: UrlResolveRequest;
    try {
        body = await request.json() as UrlResolveRequest;
    } catch {
        return JsonResponse.error('Invalid JSON request body', 400);
    }

    if (!body.url || typeof body.url !== 'string') {
        return JsonResponse.error('Request body must include a "url" string field', 400);
    }

    if (!body.url.startsWith('http://') && !body.url.startsWith('https://')) {
        return JsonResponse.error('URL must use the http:// or https:// scheme', 400);
    }

    try {
        const { canonical, hops } = await resolveCanonicalUrl(env.BROWSER, body.url);
        const responseBody: UrlResolveResponse = { canonical, hops };
        return JsonResponse.success(responseBody);
    } catch (err) {
        return JsonResponse.error(
            `URL resolution failed: ${err instanceof Error ? err.message : String(err)}`,
            502,
        );
    }
}

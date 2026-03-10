/**
 * Handler for POST /api/browser/resolve-url
 *
 * Accepts a JSON body `{ "url": "<target>" }` and returns the canonical URL
 * of the page after all HTTP redirects and client-side navigation.
 *
 * Returns 503 when the BROWSER binding is not configured.
 */

import { resolveCanonicalUrl } from './browser.ts';
import { JsonResponse } from '../utils/index.ts';
import type { Env } from '../types.ts';

interface ResolveUrlRequest {
    url: string;
}

/**
 * Handle POST /api/browser/resolve-url
 */
export async function handleResolveUrl(request: Request, env: Env): Promise<Response> {
    if (!env.BROWSER) {
        return JsonResponse.serviceUnavailable('Browser Rendering binding (BROWSER) is not configured.');
    }

    let body: ResolveUrlRequest;
    try {
        body = await request.json() as ResolveUrlRequest;
    } catch {
        return JsonResponse.badRequest('Invalid JSON body.');
    }

    if (!body.url || typeof body.url !== 'string') {
        return JsonResponse.badRequest('Missing required field: url');
    }

    try {
        const resolvedUrl = await resolveCanonicalUrl(env.BROWSER, body.url);
        return JsonResponse.success({ url: body.url, resolvedUrl });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

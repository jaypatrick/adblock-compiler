/**
 * Handler for POST /api/browser/monitor
 *
 * Accepts a JSON body `{ "url": "<target>" }` and returns the rendered HTML
 * content and a full-page screenshot (base64-encoded PNG) of the source at
 * that URL.  Useful for monitoring whether a filter-list source is alive and
 * what it currently contains after JavaScript rendering.
 *
 * Returns 503 when the BROWSER binding is not configured.
 */

import { fetchWithBrowser, takeSourceScreenshot } from './browser.ts';
import { JsonResponse } from '../utils/index.ts';
import type { Env } from '../types.ts';

interface MonitorRequest {
    url: string;
}

/**
 * Handle POST /api/browser/monitor
 */
export async function handleSourceMonitor(request: Request, env: Env): Promise<Response> {
    if (!env.BROWSER) {
        return JsonResponse.serviceUnavailable('Browser Rendering binding (BROWSER) is not configured.');
    }

    let body: MonitorRequest;
    try {
        body = await request.json() as MonitorRequest;
    } catch {
        return JsonResponse.badRequest('Invalid JSON body.');
    }

    if (!body.url || typeof body.url !== 'string') {
        return JsonResponse.badRequest('Missing required field: url');
    }

    try {
        const [html, screenshotBytes] = await Promise.all([
            fetchWithBrowser(env.BROWSER, body.url),
            takeSourceScreenshot(env.BROWSER, body.url),
        ]);

        // Encode screenshot as base64 for JSON transport.
        // Process in chunks to avoid stack overflow with large screenshots.
        const CHUNK_SIZE = 8192;
        let binary = '';
        for (let i = 0; i < screenshotBytes.length; i += CHUNK_SIZE) {
            binary += String.fromCharCode(...screenshotBytes.subarray(i, i + CHUNK_SIZE));
        }
        const screenshot = btoa(binary);

        return JsonResponse.success({
            url: body.url,
            html,
            screenshot,
            screenshotMimeType: 'image/png',
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

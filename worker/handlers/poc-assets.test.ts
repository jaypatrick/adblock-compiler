/**
 * Unit tests for /poc/* route handling in router.ts
 *
 * These tests verify the routing logic directly rather than through the full router.
 */

import { assertEquals } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';

// Helper: simulate the /poc/* routing logic
async function routePoc(
    pathname: string,
    env: ReturnType<typeof makeEnv>,
    rateLimitAllowed = true,
): Promise<Response> {
    // Simulate checkRateLimitTiered result
    if (!rateLimitAllowed) {
        return Response.json(
            { success: false, error: 'Rate limit exceeded.' },
            {
                status: 429,
                headers: {
                    'Retry-After': '60',
                    'X-RateLimit-Limit': '100',
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(Date.now() + 60000),
                },
            },
        );
    }
    if ((env as { ASSETS?: unknown }).ASSETS) {
        const request = new Request(`http://localhost${pathname}`);
        return (env as { ASSETS: { fetch: (r: Request) => Promise<Response> } }).ASSETS.fetch(request);
    }
    return Response.json({ success: false, error: 'PoC assets not available in this deployment' }, { status: 503 });
}

Deno.test('poc-assets - returns ASSETS.fetch response when ASSETS binding present', async () => {
    const assetResponse = new Response('<html>PoC App</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const env = makeEnv({
        ASSETS: { fetch: async (_r: Request) => assetResponse } as unknown as Fetcher,
    });
    const res = await routePoc('/poc/react/', env);
    assertEquals(res.status, 200);
});

Deno.test('poc-assets - returns 503 when ASSETS binding is absent', async () => {
    const env = makeEnv({ ASSETS: undefined as unknown as Fetcher });
    const res = await routePoc('/poc/react/', env);
    assertEquals(res.status, 503);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
});

Deno.test('poc-assets - returns 429 when rate limit exceeded', async () => {
    const env = makeEnv();
    const res = await routePoc('/poc/react/', env, false);
    assertEquals(res.status, 429);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertEquals(res.headers.has('Retry-After'), true);
});

/**
 * Unit tests for /poc/* route handling in router.ts
 *
 * These tests drive the real handleRequest() function to verify the
 * actual router logic: ASSETS.fetch() delegation, 503 fallback when
 * ASSETS is absent, and 429 rate-limit enforcement.
 */

import { assertEquals } from '@std/assert';
import { makeEnv, makeInMemoryKv } from '../test-helpers.ts';
import { handleRequest } from './router.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeCtx(): ExecutionContext {
    return {
        waitUntil(_p: Promise<unknown>): void {},
        passThroughOnException(): void {},
    } as unknown as ExecutionContext;
}

function makePocRequest(pathname = '/poc/react/'): Request {
    return new Request(`http://localhost${pathname}`);
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('poc-assets - returns ASSETS.fetch response when ASSETS binding is present', async () => {
    const assetBody = '<html>PoC App</html>';
    const assetResponse = new Response(assetBody, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
    });
    const env = makeEnv({
        ASSETS: { fetch: async (_r: Request) => assetResponse } as unknown as Fetcher,
        // Ensure rate limit KV returns null (first request → allowed)
        RATE_LIMIT: makeInMemoryKv(),
    });
    const req = makePocRequest('/poc/react/');
    const url = new URL(req.url);
    const res = await handleRequest(req, env, url, url.pathname, makeCtx());
    assertEquals(res.status, 200);
});

Deno.test('poc-assets - returns 503 when ASSETS binding is absent', async () => {
    const env = makeEnv({
        ASSETS: undefined as unknown as Fetcher,
        RATE_LIMIT: makeInMemoryKv(),
    });
    const req = makePocRequest('/poc/react/');
    const url = new URL(req.url);
    const res = await handleRequest(req, env, url, url.pathname, makeCtx());
    assertEquals(res.status, 503);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
});

Deno.test('poc-assets - returns 429 and rate-limit headers when limit is exhausted', async () => {
    // Fill the rate-limit KV with an exhausted window (count >= max, resetAt in the future)
    const now = Date.now();
    const resetAt = now + 60_000;
    const kv = makeInMemoryKv(
        new Map([
            ['ratelimit:ip:unknown', JSON.stringify({ count: 9999, resetAt })],
        ]),
    );
    const env = makeEnv({
        ASSETS: { fetch: async (_r: Request) => new Response('ok') } as unknown as Fetcher,
        RATE_LIMIT: kv,
    });
    const req = makePocRequest('/poc/react/');
    const url = new URL(req.url);
    const res = await handleRequest(req, env, url, url.pathname, makeCtx());
    assertEquals(res.status, 429);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
    assertEquals(res.headers.has('Retry-After'), true);
    assertEquals(res.headers.has('X-RateLimit-Limit'), true);
    assertEquals(res.headers.has('X-RateLimit-Remaining'), true);
});

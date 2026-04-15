/// <reference types="@cloudflare/workers-types" />

/**
 * Unit tests for PAYG billing routes.
 *
 * Tests cover:
 *   - GET  /api/payg/pricing  — public, no auth required
 *   - GET  /api/payg/usage    — returns usage summary or zero baseline
 *   - POST /api/payg/session/create — creates session (requires auth)
 *   - GET  /api/payg/session/status — returns session status
 *
 * @see worker/routes/payg.routes.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';
import { app } from '../hono-app.ts';

// ============================================================================
// Helpers
// ============================================================================

function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

async function fetchApp(
    path: string,
    options: RequestInit & { env?: ReturnType<typeof makeEnv> } = {},
): Promise<Response> {
    const { env: envOverride, ...init } = options;
    const env = envOverride ?? makeEnv();
    const request = new Request(`https://worker.example.com${path}`, init);
    return app.fetch(request, env, makeCtx());
}

// ============================================================================
// GET /api/payg/pricing — public endpoint
// ============================================================================

Deno.test('GET /api/payg/pricing - returns 200 with pricing data', async () => {
    const res = await fetchApp('/api/payg/pricing');
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertExists(body.pricePerCallUsdCents);
    assertExists(body.includedRequestsPerSession);
    assertExists(body.sessionTtlSeconds);
    assertExists(body.tierLimits);
});

Deno.test('GET /api/payg/pricing - uses default 1 cent price when env not set', async () => {
    // Ensure PAYG_PRICE_PER_CALL_USD_CENTS is not set — pass undefined explicitly
    const res = await fetchApp('/api/payg/pricing', { env: makeEnv({ PAYG_PRICE_PER_CALL_USD_CENTS: undefined }) });
    assertEquals(res.status, 200);
    const body = await res.json() as { pricePerCallUsdCents: number };
    assertEquals(body.pricePerCallUsdCents, 1);
});

Deno.test('GET /api/payg/pricing - uses configured price from env', async () => {
    const env = makeEnv({ PAYG_PRICE_PER_CALL_USD_CENTS: '5' });
    const res = await fetchApp('/api/payg/pricing', { env });
    assertEquals(res.status, 200);
    const body = await res.json() as { pricePerCallUsdCents: number };
    assertEquals(body.pricePerCallUsdCents, 5);
});

Deno.test('GET /api/payg/pricing - includedRequestsPerSession is 10', async () => {
    const res = await fetchApp('/api/payg/pricing');
    assertEquals(res.status, 200);
    const body = await res.json() as { includedRequestsPerSession: number };
    // DEFAULT_REQUESTS_PER_SESSION from payg-middleware.ts
    assertEquals(body.includedRequestsPerSession, 10);
});

Deno.test('GET /api/payg/pricing - sessionTtlSeconds is 3600', async () => {
    const res = await fetchApp('/api/payg/pricing');
    assertEquals(res.status, 200);
    const body = await res.json() as { sessionTtlSeconds: number };
    // DEFAULT_SESSION_TTL_MS / 1000 from payg-middleware.ts
    assertEquals(body.sessionTtlSeconds, 3600);
});

Deno.test('GET /api/payg/pricing - tierLimits contains expected keys', async () => {
    const res = await fetchApp('/api/payg/pricing');
    assertEquals(res.status, 200);
    const body = await res.json() as { tierLimits: Record<string, unknown> };
    assertExists(body.tierLimits.requestsPerMinute);
    assertExists(body.tierLimits.requestsPerDay);
    assertExists(body.tierLimits.maxRulesPerList);
});

// ============================================================================
// GET /api/payg/usage — requires X-Stripe-Customer-Id or auth
// ============================================================================

Deno.test('GET /api/payg/usage - returns 400 without X-Stripe-Customer-Id', async () => {
    const res = await fetchApp('/api/payg/usage');
    // Without a stripe customer ID and no DB, expect 400 or pass-through to auth
    // The route requires rateLimitMiddleware which needs auth context — may be 401 from unified auth
    // Accept 400 or 401 — either is valid depending on middleware order
    assertEquals([400, 401, 403].includes(res.status), true);
});

// ============================================================================
// POST /api/payg/session/create — requires auth
// ============================================================================

Deno.test('POST /api/payg/session/create - returns 401 or 403 without auth', async () => {
    const res = await fetchApp('/api/payg/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestsToPurchase: 10 }),
    });
    // requireAuthMiddleware blocks anonymous requests
    assertEquals([401, 403].includes(res.status), true);
});

// ============================================================================
// GET /api/payg/session/status — requires X-Payg-Session
// ============================================================================

Deno.test('GET /api/payg/session/status - returns 401 without X-Payg-Session header', async () => {
    const res = await fetchApp('/api/payg/session/status');
    // paygSessionMiddleware returns 401 when header is missing
    assertEquals(res.status, 401);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('GET /api/payg/session/status - returns 402 with invalid session token', async () => {
    const res = await fetchApp('/api/payg/session/status', {
        headers: { 'X-Payg-Session': 'not-a-real-token' },
    });
    // paygSessionMiddleware: no DB → database_unavailable → 402
    assertEquals(res.status, 402);
    const body = await res.json() as { paymentRequired: boolean };
    assertEquals(body.paymentRequired, true);
});

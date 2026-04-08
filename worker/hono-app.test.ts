/**
 * Tests for the Hono-based request router (hono-app.ts).
 *
 * Verifies that the Phase 1 migration preserves all routing behaviours from
 * the previous if/else chain in `worker/handlers/router.ts`.
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { makeEnv, makeInMemoryKv } from './test-helpers.ts';
import { app } from './hono-app.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal ExecutionContext stub. */
function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

/** Send a request through the Hono app and return the Response. */
async function fetch(
    path: string,
    options: RequestInit & { env?: ReturnType<typeof makeEnv> } = {},
): Promise<Response> {
    const { env: envOverride, ...init } = options;
    const env = envOverride ?? makeEnv();
    const request = new Request(`https://worker.example.com${path}`, init);
    return app.fetch(request, env, makeCtx());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('GET /api/health returns 200 (via /api prefix)', async () => {
    const res = await fetch('/api/health');
    assertEquals(res.status, 200);
});

Deno.test('GET /api/version returns version info (pre-auth meta route)', async () => {
    const res = await fetch('/api/version');
    // Returns 200 when a D1 database is configured, or 503 with version info when DB is absent.
    assertEquals(res.status === 200 || res.status === 503, true);
    const body = await res.json() as Record<string, unknown>;
    // Either way the response must include a `version` string
    assertEquals(typeof body.version, 'string');
});

Deno.test('GET /api/rules returns 401 for anonymous users (via /api prefix)', async () => {
    const res = await fetch('/api/rules');
    assertEquals(res.status, 401);
});

Deno.test('POST /api/compile returns 401 for anonymous users (Free tier required)', async () => {
    // /compile requires UserTier.Free per the route-permission registry.
    // Anonymous requests are blocked before the rate-limit check is reached.
    const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: ['||example.com^'] }),
    });
    assertEquals(res.status, 401);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

Deno.test('GET /api/configuration/defaults rate-limits anonymous users when quota is exhausted', async () => {
    // /configuration/defaults is accessible to UserTier.Anonymous, so rate limiting
    // is enforced before the handler runs — ideal for verifying the 429 path.
    const store = new Map<string, string>();
    const now = Date.now();
    store.set('ratelimit:ip:unknown', JSON.stringify({ count: 9999, resetAt: now + 60_000 }));
    const env = makeEnv({ RATE_LIMIT: makeInMemoryKv(store) });

    const res = await fetch('/api/configuration/defaults', { env });
    assertEquals(res.status, 429);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertStringIncludes(String(body.error), 'Rate limit exceeded');
});

Deno.test('GET /poc returns 503 when ASSETS not configured', async () => {
    const env = makeEnv({ ASSETS: undefined as unknown as Fetcher });
    const res = await fetch('/poc', { env });
    assertEquals(res.status, 503);
});

Deno.test('CORS middleware adds Access-Control-Allow-Origin for public endpoints', async () => {
    const res = await fetch('/health', {
        headers: { 'Origin': 'https://example.com' },
    });
    // Public endpoint: should have * or reflect origin
    const acao = res.headers.get('Access-Control-Allow-Origin');
    // Either wildcard or an origin header should be present
    assertEquals(typeof acao, 'string');
});

Deno.test('OPTIONS preflight returns 200 or 204', async () => {
    const res = await fetch('/compile', {
        method: 'OPTIONS',
        headers: {
            'Origin': 'http://localhost:4200',
            'Access-Control-Request-Method': 'POST',
        },
    });
    // Hono cors() responds with 204 for preflight
    assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test('GET /api/docs serves Scalar UI documentation', async () => {
    const res = await fetch('/api/docs');
    // Should return HTML with Scalar UI (200 OK)
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('404 for unknown routes', async () => {
    const res = await fetch('/no-such-route-xyz');
    // Static assets handler may return 404 or 503; at minimum should not be 200 or 500
    assertEquals(res.status !== 200 && res.status !== 500, true);
});

// ── Monitoring endpoint pre-auth bypass (#1370) ───────────────────────────────
// /health and /metrics are Anonymous-tier per ROUTE_PERMISSION_REGISTRY.
// /queue/stats and /queue/history remain Free-tier (authenticated only).

Deno.test('GET /api/metrics is publicly accessible (pre-auth bypass)', async () => {
    const env = makeEnv({ METRICS: makeInMemoryKv(new Map()) });
    const res = await fetch('/api/metrics', { env });
    assertEquals(res.status, 200);
});

Deno.test('GET /api/health/latest is publicly accessible (pre-auth bypass)', async () => {
    const res = await fetch('/api/health/latest');
    // Returns 200 (healthy) or 503 (degraded) — never 401/403 for anonymous callers.
    assertEquals(res.status === 200 || res.status === 503, true);
});

Deno.test('GET /api/queue/stats returns 401 for anonymous users (Free tier required)', async () => {
    // /queue/stats requires UserTier.Free per ROUTE_PERMISSION_REGISTRY and must NOT
    // be in the pre-auth list — anonymous SWR callers should be rejected.
    const res = await fetch('/api/queue/stats');
    assertEquals(res.status, 401);
});

Deno.test('GET /api/openapi.json is publicly accessible and returns valid spec or 501 when not yet configured', async () => {
    const res = await fetch('/api/openapi.json');
    // The endpoint is publicly accessible (no auth required)
    // With no .openapi() routes registered it returns 501; once routes are migrated it returns 200.
    const isExpectedStatus = res.status === 200 || res.status === 501;
    assertEquals(isExpectedStatus, true);
    const body = await res.json() as Record<string, unknown>;
    if (res.status === 200) {
        // When routes are registered the spec must contain required top-level OpenAPI fields
        assertEquals(body['openapi'], '3.0.0');
        const info = body['info'] as Record<string, unknown> | undefined;
        assertEquals(typeof info?.['title'], 'string');
        assertEquals(typeof body['paths'], 'object');
    } else {
        // Until .openapi() routes are registered the endpoint surfaces a clear 501
        assertEquals(typeof body['error'], 'string');
        assertEquals(body['status'], 501);
    }
});

// ── Admin session revocation — DELETE /admin/users/:id/sessions (#1275) ──────

Deno.test('DELETE /api/admin/users/:id/sessions returns 401 for anonymous (/api prefix)', async () => {
    const res = await fetch('/api/admin/users/user_123/sessions', { method: 'DELETE' });
    assertEquals(res.status, 401);
});

Deno.test('DELETE /api/admin/users/:id/sessions returns 401 when Bearer token is invalid', async () => {
    // An invalid Bearer token is rejected by the auth chain → 401.
    // This also verifies the route is registered (not 404) and the auth chain runs.
    const res = await fetch('/api/admin/users/user_123/sessions', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer invalid_token' },
    });
    // Auth chain rejects invalid credentials → 401 (not 404, proving the route exists)
    assertEquals(res.status, 401);
});

Deno.test('DELETE /api/admin/users/:id/sessions route is registered (not 404)', async () => {
    const res = await fetch('/api/admin/users/user_123/sessions', { method: 'DELETE' });
    // Should be 401 (unauthorized) not 404 (not found)
    assertEquals(res.status !== 404, true);
});

// ── Better Auth middleware bypass regression (#1424) ──────────────────────────
// logger() and compress() are scoped to the `routes` sub-app (not global app).
// Because app.on('/api/auth/*') is resolved before the routes sub-app is mounted,
// /api/auth/* requests never enter the routes middleware chain.  These tests
// verify the observable behavior: no Content-Encoding on auth responses and no
// logger output for auth paths.

Deno.test('/api/auth/* bypasses compress middleware (no Content-Encoding header)', async () => {
    // Without BETTER_AUTH_SECRET the handler short-circuits with 404 — but the
    // critical property is that compress() must NOT have wrapped the response,
    // so Content-Encoding must be absent regardless of Accept-Encoding.
    const res = await fetch('/api/auth/get-session', {
        headers: { 'Accept-Encoding': 'gzip' },
    });
    assertEquals(res.headers.get('Content-Encoding'), null);
});

Deno.test('/api/auth/* bypasses logger middleware (no request log emitted)', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
    };
    try {
        await fetch('/api/auth/get-session');
        // logger() emits lines containing the HTTP method and path; if ordering is
        // correct this list will be empty for /api/auth/* requests.
        const authLogEntry = logs.find((log) => log.includes('/api/auth/'));
        assertEquals(authLogEntry, undefined, 'Expected logger() NOT to log /api/auth/* requests');
    } finally {
        console.log = originalLog;
    }
});

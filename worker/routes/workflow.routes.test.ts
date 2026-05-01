/// <reference types="@cloudflare/workers-types" />

/**
 * Regression tests for POST /api/workflow/* routes.
 *
 * Primary regression: Hono OpenAPI middleware consumes the request body stream
 * during Zod validation before the handler runs.  Accessing `c.req.raw` (or
 * calling `request.json()`) inside the handler after that point throws:
 *   "Body has already been used".
 *
 * These tests confirm the routes no longer throw on a POST with a valid JSON
 * body — 401 / 503 are the expected terminal statuses depending on auth, not
 * 500 with "Body has already been used".
 *
 * Additionally, tests cover that the routeWorkflow() legacy dispatcher now
 * Zod-validates POST bodies and returns 400 for malformed payloads.
 *
 * @see worker/routes/workflow.routes.ts
 * @see worker/handlers/workflow.ts
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';
import { app } from '../hono-app.ts';
import { routeWorkflow } from '../handlers/workflow.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { UserTier } from '../types.ts';
import type { IAuthContext } from '../types.ts';

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

/** Authenticated (non-anonymous) context that passes requireAuth. */
function makeAuthContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'u_test',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: 's_test',
        scopes: [],
        authMethod: 'better-auth',
        ...overrides,
    };
}

/** Call routeWorkflow with all required parameters and a stub analytics service. */
async function callRouteWorkflow(
    path: string,
    request: Request,
    env: ReturnType<typeof makeEnv> = makeEnv(),
    authContext: IAuthContext = makeAuthContext(),
): Promise<Response> {
    const analytics = new AnalyticsService(undefined);
    const url = new URL(request.url);
    return routeWorkflow(path, request, env, authContext, analytics, '127.0.0.1', url);
}

// ============================================================================
// Regression: POST routes do not throw "Body has already been used"
//
// Before the fix, all POST /api/workflow/* handlers crashed with a 500
// because they called `request.json()` after Hono had already consumed the
// stream during OpenAPI/Zod validation.  The fix passes `c.req.valid('json')`
// (the already-parsed body) to the handler.
//
// Expected behaviour post-fix:
//   - Valid JSON body → 401 (auth required, no worker secret set in test env)
//   - No 500 with "Body has already been used" message
// ============================================================================

Deno.test('POST /api/workflow/compile - valid body returns 401, not 500 "Body has already been used"', async () => {
    const res = await fetchApp('/api/workflow/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            configuration: { name: 'test', sources: [] },
        }),
    });
    // Auth middleware must reject unauthenticated requests — not a 500 crash
    assertEquals(res.status, 401);
    const body = await res.json() as { error?: string; message?: string };
    const combined = JSON.stringify(body).toLowerCase();
    // Ensure neither "body has already been used" nor a generic 500 are present
    assertEquals(combined.includes('body has already been used'), false);
    assertEquals(combined.includes('internal server error'), false);
});

Deno.test('POST /api/workflow/batch - valid body returns 401, not 500 "Body has already been used"', async () => {
    const res = await fetchApp('/api/workflow/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requests: [{ id: 'req-1', configuration: { name: 'test', sources: [] } }],
        }),
    });
    assertEquals(res.status, 401);
    const body = await res.json() as { error?: string; message?: string };
    const combined = JSON.stringify(body).toLowerCase();
    assertEquals(combined.includes('body has already been used'), false);
    assertEquals(combined.includes('internal server error'), false);
});

Deno.test('POST /api/workflow/cache-warm - valid body returns 401, not 500 "Body has already been used"', async () => {
    const res = await fetchApp('/api/workflow/cache-warm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    assertEquals(res.status, 401);
    const body = await res.json() as { error?: string; message?: string };
    const combined = JSON.stringify(body).toLowerCase();
    assertEquals(combined.includes('body has already been used'), false);
    assertEquals(combined.includes('internal server error'), false);
});

Deno.test('POST /api/workflow/health-check - valid body returns 401, not 500 "Body has already been used"', async () => {
    const res = await fetchApp('/api/workflow/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertOnFailure: true }),
    });
    assertEquals(res.status, 401);
    const body = await res.json() as { error?: string; message?: string };
    const combined = JSON.stringify(body).toLowerCase();
    assertEquals(combined.includes('body has already been used'), false);
    assertEquals(combined.includes('internal server error'), false);
});

// ============================================================================
// routeWorkflow() — Zod safeParse validation
//
// routeWorkflow() is the legacy (non-OpenAPI) dispatcher.  Before the fix, it
// used type-assertion casts without any Zod validation, so null / wrong-shaped
// JSON could silently reach handler logic.  Now it validates with safeParse and
// returns 400 for malformed payloads.
// ============================================================================

Deno.test('routeWorkflow - /workflow/compile rejects null body with 400', async () => {
    const req = new Request('https://worker.example.com/workflow/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(null),
    });
    const res = await callRouteWorkflow('/workflow/compile', req);
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
});

Deno.test('routeWorkflow - /workflow/compile rejects missing configuration with 400', async () => {
    const req = new Request('https://worker.example.com/workflow/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'high' }),
    });
    const res = await callRouteWorkflow('/workflow/compile', req);
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
});

Deno.test('routeWorkflow - /workflow/batch rejects empty requests array with 400', async () => {
    const req = new Request('https://worker.example.com/workflow/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [] }),
    });
    const res = await callRouteWorkflow('/workflow/batch', req);
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
});

Deno.test('routeWorkflow - /workflow/cache-warm accepts empty body (all fields optional) → 503 no binding', async () => {
    const req = new Request('https://worker.example.com/workflow/cache-warm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    const res = await callRouteWorkflow('/workflow/cache-warm', req);
    // 503 = validated OK but CACHE_WARMING_WORKFLOW binding not configured in test env
    assertEquals(res.status, 503);
});

Deno.test('routeWorkflow - /workflow/health-check accepts empty body (all fields optional) → 503 no binding', async () => {
    const req = new Request('https://worker.example.com/workflow/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    const res = await callRouteWorkflow('/workflow/health-check', req);
    // 503 = validated OK but HEALTH_MONITORING_WORKFLOW binding not configured in test env
    assertEquals(res.status, 503);
});

Deno.test('routeWorkflow - returns 400 for invalid JSON body', async () => {
    const req = new Request('https://worker.example.com/workflow/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'this is not json',
    });
    const res = await callRouteWorkflow('/workflow/compile', req);
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertStringIncludes(body.error, 'Invalid JSON body');
});

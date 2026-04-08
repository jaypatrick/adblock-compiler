/**
 * Tests for the documentation routes.
 *
 * GET /api/docs     — Scalar UI
 * GET /api/swagger  — Swagger UI
 */

import { assertEquals } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';
import { app } from '../hono-app.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── GET /api/docs — Scalar UI ─────────────────────────────────────────────────

Deno.test('GET /api/docs returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/docs');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/docs returns Scalar UI page', async () => {
    const res = await fetchApp('/api/docs');
    const html = await res.text();
    // Scalar UI should contain these markers
    assertEquals(html.includes('Adblock Compiler API'), true);
});

Deno.test('GET /api/docs is publicly accessible (no auth required)', async () => {
    // Should not return 401 for anonymous users
    const res = await fetchApp('/api/docs');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

// ── GET /api/swagger — Swagger UI ─────────────────────────────────────────────

Deno.test('GET /api/swagger returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/swagger');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/swagger returns Swagger UI page', async () => {
    const res = await fetchApp('/api/swagger');
    const html = await res.text();
    // Swagger UI should contain these markers
    assertEquals(html.includes('swagger-ui'), true);
});

Deno.test('GET /api/swagger is publicly accessible (no auth required)', async () => {
    // Should not return 401 for anonymous users
    const res = await fetchApp('/api/swagger');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

// ── Trailing slash and subpath variants ───────────────────────────────────────

Deno.test('GET /api/docs/ (trailing slash) returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/docs/');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/docs/ is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/api/docs/');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

Deno.test('GET /api/swagger/ (trailing slash) returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/swagger/');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/swagger/ is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/api/swagger/');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

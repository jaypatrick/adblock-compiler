/**
 * Tests for the CSP violation reporting route.
 *
 * POST /api/csp-report
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

/** D1 stub that accepts any INSERT and returns a successful run result. */
function makeWritableDb(): D1Database {
    return {
        prepare: (_sql: string) => ({
            bind: (..._args: unknown[]) => ({
                run: async () => ({ success: true, meta: {} }),
                first: async () => null,
            }),
            first: async () => null,
        }),
    } as unknown as D1Database;
}

/** D1 stub whose `.run()` always rejects. */
function makeFailingDb(): D1Database {
    return {
        prepare: (_sql: string) => ({
            bind: (..._args: unknown[]) => ({
                run: async () => {
                    throw new Error('D1 write error');
                },
                first: async () => null,
            }),
            first: async () => null,
        }),
    } as unknown as D1Database;
}

function validReportBody(): string {
    return JSON.stringify({
        'csp-report': {
            'document-uri': 'https://example.com/page',
            'blocked-uri': 'https://evil.example/script.js',
            'violated-directive': 'script-src',
        },
    });
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

// ── POST /api/csp-report — happy path ─────────────────────────────────────────

Deno.test('POST /api/csp-report — valid report returns 204', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/csp-report' },
        body: validReportBody(),
        env,
    });
    assertEquals(res.status, 204);
});

Deno.test('POST /api/csp-report — application/json content-type also accepted (204)', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: validReportBody(),
        env,
    });
    assertEquals(res.status, 204);
});

// ── POST /api/csp-report — malformed input ────────────────────────────────────

Deno.test('POST /api/csp-report — empty body returns 400', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/csp-report' },
        body: '',
        env,
    });
    assertEquals(res.status, 400);
});

Deno.test('POST /api/csp-report — invalid JSON returns 400', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
        env,
    });
    assertEquals(res.status, 400);
});

Deno.test('POST /api/csp-report — missing csp-report key returns 400', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unrelated: 'data' }),
        env,
    });
    assertEquals(res.status, 400);
});

Deno.test('POST /api/csp-report — empty csp-report sub-object (missing required fields) returns 400', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'csp-report': {} }),
        env,
    });
    assertEquals(res.status, 400);
});

// ── POST /api/csp-report — DB unavailable ─────────────────────────────────────

Deno.test('POST /api/csp-report — missing DB binding returns 503', async () => {
    // No DB in env
    const env = makeEnv();
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: validReportBody(),
        env,
    });
    assertEquals(res.status, 503);
});

Deno.test('POST /api/csp-report — D1 write failure returns 503', async () => {
    const env = makeEnv({ DB: makeFailingDb() });
    const res = await fetchApp('/api/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: validReportBody(),
        env,
    });
    assertEquals(res.status, 503);
});

// ── Non-POST methods → 405 ────────────────────────────────────────────────────

Deno.test('GET /api/csp-report — returns 405', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', { method: 'GET', env });
    assertEquals(res.status, 405);
});

Deno.test('DELETE /api/csp-report — returns 405', async () => {
    const env = makeEnv({ DB: makeWritableDb() });
    const res = await fetchApp('/api/csp-report', { method: 'DELETE', env });
    assertEquals(res.status, 405);
});

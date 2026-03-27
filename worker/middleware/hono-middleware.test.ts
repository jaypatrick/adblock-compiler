/**
 * Tests for the Phase 2 Hono middleware factories.
 *
 * Each factory is tested through the Hono app to ensure correct HTTP responses
 * and `next()` propagation behaviour.
 */

import { assertEquals } from '@std/assert';
import { Hono } from 'hono';
import { makeEnv, makeInMemoryKv } from '../test-helpers.ts';
import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware, turnstileMiddleware } from './hono-middleware.ts';
import { ANONYMOUS_AUTH_CONTEXT, type IAuthContext, UserTier } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

/** Minimal analytics stub. */
function makeAnalytics(): AnalyticsService {
    // deno-lint-ignore no-explicit-any
    return new AnalyticsService(undefined as any);
}

/** Build a minimal env with an in-memory KV store. */
function makeTestEnv(overrides: Record<string, unknown> = {}) {
    return makeEnv(overrides);
}

/** Build a minimal Hono context variables setter (injects Variables into context). */
function makeContextMiddleware(vars: {
    authContext?: IAuthContext;
    ip?: string;
    requestId?: string;
    analytics?: AnalyticsService;
}) {
    // deno-lint-ignore no-explicit-any
    return async (c: any, next: () => Promise<void>) => {
        c.set('authContext', vars.authContext ?? ANONYMOUS_AUTH_CONTEXT);
        c.set('ip', vars.ip ?? '127.0.0.1');
        c.set('requestId', vars.requestId ?? 'test-req');
        c.set('analytics', vars.analytics ?? makeAnalytics());
        await next();
    };
}

// ── bodySizeMiddleware ────────────────────────────────────────────────────────

Deno.test('bodySizeMiddleware: passes when body is within limit', async () => {
    const env = makeTestEnv();
    const app = new Hono();
    app.use('*', makeContextMiddleware({}));
    app.post('/', bodySizeMiddleware(), (c) => c.json({ success: true }));

    const req = new Request('http://test/', {
        method: 'POST',
        body: JSON.stringify({ rules: ['||example.com^'] }),
        headers: { 'Content-Type': 'application/json' },
    });
    const res = await app.fetch(req, env, makeCtx());
    assertEquals(res.status, 200);
});

Deno.test('bodySizeMiddleware: returns 413 when body exceeds limit', async () => {
    const env = makeTestEnv({ MAX_REQUEST_BODY_MB: '0.0001' }); // ~100 bytes limit
    const app = new Hono();
    app.use('*', makeContextMiddleware({}));
    app.post('/', bodySizeMiddleware(), (c) => c.json({ success: true }));

    const req = new Request('http://test/', {
        method: 'POST',
        body: 'x'.repeat(1000), // > 100 bytes
        headers: { 'Content-Type': 'text/plain' },
    });
    const res = await app.fetch(req, env, makeCtx());
    assertEquals(res.status, 413);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

// ── rateLimitMiddleware ───────────────────────────────────────────────────────

Deno.test('rateLimitMiddleware: passes when quota is available', async () => {
    const env = makeTestEnv({ RATE_LIMIT: makeInMemoryKv(new Map()) });
    const app = new Hono();
    app.use('*', makeContextMiddleware({ authContext: ANONYMOUS_AUTH_CONTEXT }));
    app.get('/', rateLimitMiddleware(), (c) => c.json({ success: true }));

    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 200);
});

Deno.test('rateLimitMiddleware: returns 429 when quota is exhausted', async () => {
    const store = new Map<string, string>();
    const now = Date.now();
    store.set('ratelimit:ip:127.0.0.1', JSON.stringify({ count: 9999, resetAt: now + 60_000 }));
    const env = makeTestEnv({ RATE_LIMIT: makeInMemoryKv(store) });

    const app = new Hono();
    app.use('*', makeContextMiddleware({ authContext: ANONYMOUS_AUTH_CONTEXT, ip: '127.0.0.1' }));
    app.get('/', rateLimitMiddleware(), (c) => c.json({ success: true }));

    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 429);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

// ── turnstileMiddleware ───────────────────────────────────────────────────────

Deno.test('turnstileMiddleware: skips when TURNSTILE_SECRET_KEY is not set', async () => {
    const env = makeTestEnv({ TURNSTILE_SECRET_KEY: undefined });
    const app = new Hono();
    app.use('*', makeContextMiddleware({}));
    app.post('/', turnstileMiddleware(), (c) => c.json({ success: true }));

    const req = new Request('http://test/', {
        method: 'POST',
        body: JSON.stringify({ turnstileToken: 'ignored' }),
    });
    const res = await app.fetch(req, env, makeCtx());
    assertEquals(res.status, 200);
});

Deno.test('turnstileMiddleware: returns 400 when body is not valid JSON', async () => {
    const env = makeTestEnv({ TURNSTILE_SECRET_KEY: 'secret' });
    const app = new Hono();
    app.use('*', makeContextMiddleware({}));
    app.post('/', turnstileMiddleware(), (c) => c.json({ success: true }));

    const req = new Request('http://test/', {
        method: 'POST',
        body: 'not-json',
    });
    const res = await app.fetch(req, env, makeCtx());
    assertEquals(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

// ── requireAuthMiddleware ─────────────────────────────────────────────────────

Deno.test('requireAuthMiddleware: passes for authenticated user', async () => {
    const env = makeTestEnv();
    const authContext: IAuthContext = {
        ...ANONYMOUS_AUTH_CONTEXT,
        userId: 'user_abc',
        tier: UserTier.Free,
        authMethod: 'better-auth',
    };
    const app = new Hono();
    app.use('*', makeContextMiddleware({ authContext }));
    app.get('/', requireAuthMiddleware(), (c) => c.json({ success: true }));

    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 200);
});

Deno.test('requireAuthMiddleware: returns 401 for anonymous user', async () => {
    const env = makeTestEnv();
    const app = new Hono();
    app.use('*', makeContextMiddleware({ authContext: ANONYMOUS_AUTH_CONTEXT }));
    app.get('/', requireAuthMiddleware(), (c) => c.json({ success: true }));

    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 401);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

// ============================================================================
// Built-in Hono Middleware Tests (compress, logger, cache)
// ============================================================================

import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { cache } from 'hono/cache';
import { assertExists } from '@std/assert';

// ── compress middleware ───────────────────────────────────────────────────

Deno.test('compress middleware: adds Content-Encoding when Accept-Encoding present', async () => {
    const app = new Hono();
    app.use('*', compress());
    app.get('/test', (c) => c.json({ message: 'Hello, world!'.repeat(100) }));

    const req = new Request('http://localhost/test', {
        headers: { 'Accept-Encoding': 'gzip' },
    });
    const res = await app.fetch(req);

    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Encoding'), 'gzip');
});

Deno.test('compress middleware: prefers brotli over gzip when both accepted', async () => {
    const app = new Hono();
    app.use('*', compress());
    app.get('/test', (c) => c.json({ message: 'Hello, world!'.repeat(100) }));

    const req = new Request('http://localhost/test', {
        headers: { 'Accept-Encoding': 'br, gzip, deflate' },
    });
    const res = await app.fetch(req);

    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Encoding'), 'br');
});

Deno.test('compress middleware: no compression when Accept-Encoding not present', async () => {
    const app = new Hono();
    app.use('*', compress());
    app.get('/test', (c) => c.json({ message: 'Hello, world!' }));

    const req = new Request('http://localhost/test');
    const res = await app.fetch(req);

    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Encoding'), null);
});

// ── logger middleware ─────────────────────────────────────────────────────

Deno.test('logger middleware: logs GET request', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
    };

    try {
        const app = new Hono();
        app.use('*', logger());
        app.get('/test', (c) => c.text('OK'));

        const req = new Request('http://localhost/test');
        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(await res.text(), 'OK');

        // Logger should have logged the request
        const logEntry = logs.find((log) => log.includes('GET') && log.includes('/test'));
        assertExists(logEntry, 'Expected logger to output request log');
    } finally {
        console.log = originalLog;
    }
});

Deno.test('logger middleware: logs POST request', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
    };

    try {
        const app = new Hono();
        app.use('*', logger());
        app.post('/test', (c) => c.json({ success: true }));

        const req = new Request('http://localhost/test', {
            method: 'POST',
            body: JSON.stringify({ data: 'test' }),
        });
        const res = await app.fetch(req);

        assertEquals(res.status, 200);

        const logEntry = logs.find((log) => log.includes('POST') && log.includes('/test'));
        assertExists(logEntry, 'Expected logger to output POST request log');
    } finally {
        console.log = originalLog;
    }
});

// ── cache middleware ──────────────────────────────────────────────────────

Deno.test('cache middleware: sets Cache-Control header with max-age', async () => {
    const app = new Hono();
    app.get('/cached', cache({ cacheName: 'test-cache', cacheControl: 'public, max-age=300' }), (c) => c.json({ data: 'cached' }));

    const req = new Request('http://localhost/cached');
    const res = await app.fetch(req);

    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Cache-Control'), 'public, max-age=300');
});

Deno.test('cache middleware: different cache durations for different routes', async () => {
    const app = new Hono();
    app.get('/short', cache({ cacheName: 'short-cache', cacheControl: 'public, max-age=60' }), (c) => c.json({ data: 'short' }));
    app.get('/long', cache({ cacheName: 'long-cache', cacheControl: 'public, max-age=3600' }), (c) => c.json({ data: 'long' }));

    const shortReq = new Request('http://localhost/short');
    const shortRes = await app.fetch(shortReq);
    assertEquals(shortRes.headers.get('Cache-Control'), 'public, max-age=60');

    const longReq = new Request('http://localhost/long');
    const longRes = await app.fetch(longReq);
    assertEquals(longRes.headers.get('Cache-Control'), 'public, max-age=3600');
});

Deno.test('cache middleware: does not cache routes without middleware', async () => {
    const app = new Hono();
    app.get('/cached', cache({ cacheName: 'test-cache', cacheControl: 'public, max-age=300' }), (c) => c.json({ data: 'cached' }));
    app.get('/uncached', (c) => c.json({ data: 'uncached' }));

    const cachedReq = new Request('http://localhost/cached');
    const cachedRes = await app.fetch(cachedReq);
    assertEquals(cachedRes.headers.get('Cache-Control'), 'public, max-age=300');

    const uncachedReq = new Request('http://localhost/uncached');
    const uncachedRes = await app.fetch(uncachedReq);
    assertEquals(uncachedRes.headers.get('Cache-Control'), null);
});

// ── Integration test ──────────────────────────────────────────────────────

Deno.test('integration: compress, logger, and cache work together', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
    };

    try {
        const app = new Hono();
        app.use('*', logger());
        app.use('*', compress());
        app.get('/api/version', cache({ cacheName: 'api-version', cacheControl: 'public, max-age=3600' }), (c) => c.json({ version: '1.0.0' }));

        const req = new Request('http://localhost/api/version', {
            headers: { 'Accept-Encoding': 'gzip' },
        });
        const res = await app.fetch(req);

        assertEquals(res.status, 200);
        assertEquals(res.headers.get('Content-Encoding'), 'gzip');
        assertEquals(res.headers.get('Cache-Control'), 'public, max-age=3600');

        const logEntry = logs.find((log) => log.includes('GET') && log.includes('/api/version'));
        assertExists(logEntry, 'Expected logger to output request log');
    } finally {
        console.log = originalLog;
    }
});

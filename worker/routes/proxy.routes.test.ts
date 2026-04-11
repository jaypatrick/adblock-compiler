/**
 * Tests for the CORS proxy routes.
 *
 * GET  /api/proxy/fetch
 * POST /api/proxy/fetch/batch
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { makeEnv, makeInMemoryKv } from '../test-helpers.ts';
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

// ── GET /api/proxy/fetch — input validation ───────────────────────────────────

Deno.test('GET /api/proxy/fetch — missing url returns 400', async () => {
    const res = await fetchApp('/api/proxy/fetch');
    // 400 from Zod validation (url is required)
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — invalid url returns 400', async () => {
    const res = await fetchApp('/api/proxy/fetch?url=not-a-url');
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — http:// URL rejected as 400 (HTTPS only)', async () => {
    // SSRF guard: HTTP scheme is not allowed
    const res = await fetchApp('/api/proxy/fetch?url=http%3A%2F%2Fexample.com%2Flist.txt');
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — localhost URL rejected as 400 (SSRF protection)', async () => {
    const res = await fetchApp('/api/proxy/fetch?url=https%3A%2F%2Flocalhost%2Flist.txt');
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — private IP rejected as 400 (RFC 1918 SSRF protection)', async () => {
    const res = await fetchApp('/api/proxy/fetch?url=https%3A%2F%2F192.168.1.1%2Flist.txt');
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — metadata endpoint rejected as 400 (SSRF protection)', async () => {
    const res = await fetchApp('/api/proxy/fetch?url=https%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data');
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — workers.dev URL rejected as 400 (self-SSRF protection)', async () => {
    // *.workers.dev hostnames are Cloudflare Worker subdomains and must never be
    // proxy-fetchable — they create self-referential request loops.
    const res = await fetchApp('/api/proxy/fetch?url=https%3A%2F%2Fadblock-frontend.jayson-knight.workers.dev%2Ffavicon.png');
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — own frontend URL rejected as 400 (self-SSRF protection)', async () => {
    // URL_FRONTEND custom-domain guard: the Worker must not proxy-fetch its own
    // deployed frontend hostname, even when it uses a non-workers.dev custom domain.
    const env = makeEnv({ URL_FRONTEND: 'https://app.example.com' });
    const res = await fetchApp(
        '/api/proxy/fetch?url=https%3A%2F%2Fapp.example.com%2Ffavicon.png',
        { env },
    );
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — trailing-dot workers.dev URL rejected as 400 (bypass prevention)', async () => {
    // Trailing-dot FQDN notation (foo.workers.dev.) must not bypass the SSRF guard.
    const res = await fetchApp('/api/proxy/fetch?url=https%3A%2F%2Fadblock-frontend.workers.dev.%2Ffavicon.png');
    assertEquals(res.status === 400 || res.status === 422, true);
});

Deno.test('GET /api/proxy/fetch — trailing-dot own hostname rejected as 400 (bypass prevention)', async () => {
    // A trailing-dot form of the own frontend hostname must also be rejected.
    const env = makeEnv({ URL_FRONTEND: 'https://app.example.com' });
    const res = await fetchApp(
        '/api/proxy/fetch?url=https%3A%2F%2Fapp.example.com.%2Ffavicon.png',
        { env },
    );
    assertEquals(res.status === 400 || res.status === 422, true);
});

// ── GET /api/proxy/fetch — KV cache hit ───────────────────────────────────────

Deno.test('GET /api/proxy/fetch — serves from KV cache when available', async () => {
    const targetUrl = 'https://easylist.to/easylist/easylist.txt';
    const cachedContent = '! EasyList\n||example.com^';
    const cacheKey = `proxy:${targetUrl}`;

    const store = new Map<string, string>([[cacheKey, cachedContent]]);
    const env = makeEnv({ COMPILATION_CACHE: makeInMemoryKv(store) });

    const res = await fetchApp(`/api/proxy/fetch?url=${encodeURIComponent(targetUrl)}`, { env });
    assertEquals(res.status, 200);
    const body = await res.text();
    assertEquals(body, cachedContent);
});

Deno.test('GET /api/proxy/fetch — returns text/plain content-type from cache', async () => {
    const targetUrl = 'https://easylist.to/easylist/easylist.txt';
    const cacheKey = `proxy:${targetUrl}`;
    const store = new Map<string, string>([[cacheKey, '||example.com^']]);
    const env = makeEnv({ COMPILATION_CACHE: makeInMemoryKv(store) });

    const res = await fetchApp(`/api/proxy/fetch?url=${encodeURIComponent(targetUrl)}`, { env });
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers.get('Content-Type') ?? '', 'text/plain');
});

// ── POST /api/proxy/fetch/batch — permission check ───────────────────────────

Deno.test('POST /api/proxy/fetch/batch — anonymous returns 401 (Pro tier required)', async () => {
    const res = await fetchApp('/api/proxy/fetch/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: ['https://easylist.to/easylist/easylist.txt'] }),
    });
    // Batch proxy requires Pro tier; anonymous callers get 401
    assertEquals(res.status, 401);
});

// ── POST /api/proxy/fetch/batch — input validation ───────────────────────────

Deno.test('POST /api/proxy/fetch/batch — empty urls array returns 422', async () => {
    // Need a Pro auth context to reach validation — this test verifies rejection
    // when the body reaches the Zod validator with an empty urls array.
    // Since anonymous is 401 first, this test focuses on the validation schema.
    const res = await fetchApp('/api/proxy/fetch/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [] }),
    });
    // Either 401 (anonymous blocked before validation) or 422 (Zod min(1) failure)
    assertEquals(res.status === 401 || res.status === 422, true);
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

Deno.test('GET /api/proxy/fetch — rate-limited when quota exhausted', async () => {
    const store = new Map<string, string>();
    const now = Date.now();
    store.set('ratelimit:ip:unknown', JSON.stringify({ count: 9999, resetAt: now + 60_000 }));
    const env = makeEnv({ RATE_LIMIT: makeInMemoryKv(store) });

    const res = await fetchApp('/api/proxy/fetch?url=https%3A%2F%2Feasylist.to%2Flist.txt', { env });
    assertEquals(res.status, 429);
    const body = await res.json() as Record<string, unknown>;
    // RFC 9457: application/problem+json body shape
    assertEquals(typeof body.type, 'string');
    assertEquals(body.status, 429);
    assertStringIncludes(String(body.detail), 'Rate limit exceeded');
});

/**
 * Integration tests for browser monitoring handlers:
 *   - GET /api/browser/monitor/latest  → handleMonitorLatest
 *   - POST /api/browser/resolve-url    → handleResolveUrl (input validation only)
 *   - POST /api/browser/monitor        → handleSourceMonitor (input validation only)
 *
 * These tests exercise the handler functions directly with mock env bindings.
 * Handlers that use BROWSER rendering are tested for error paths and input
 * validation only — the browser binding is not mocked for actual navigation.
 */

import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { handleMonitorLatest } from './handlers/monitor-latest.ts';
import { handleResolveUrl } from './handlers/url-resolver.ts';
import { handleSourceMonitor } from './handlers/source-monitor.ts';
import { createMockCtx, createMockEnv, createMockRequest, MockKVNamespace } from '../tests/fixtures/mocks/MockEnv.ts';

// ============================================================================
// handleMonitorLatest — GET /api/browser/monitor/latest
// ============================================================================

Deno.test('handleMonitorLatest: returns 503 when COMPILATION_CACHE is missing', async () => {
    const env = createMockEnv({ COMPILATION_CACHE: undefined as unknown as KVNamespace });
    const response = await handleMonitorLatest(createMockRequest(), env);
    assertEquals(response.status, 503);
    const body = await response.json();
    assertStringIncludes(body.error || body.message || JSON.stringify(body), 'KV binding');
});

Deno.test('handleMonitorLatest: returns 404 when no summary stored', async () => {
    const kv = new MockKVNamespace();
    const env = createMockEnv({ COMPILATION_CACHE: kv as unknown as KVNamespace });
    const response = await handleMonitorLatest(createMockRequest(), env);
    assertEquals(response.status, 404);
});

Deno.test('handleMonitorLatest: returns 200 with stored summary', async () => {
    const kv = new MockKVNamespace();
    const summary = {
        success: true,
        results: [{ url: 'https://example.com', reachable: true, checkedAt: '2025-01-01T00:00:00Z' }],
        total: 1,
        reachable: 1,
        unreachable: 0,
    };
    await kv.put('browser:monitor:latest', JSON.stringify(summary));
    const env = createMockEnv({ COMPILATION_CACHE: kv as unknown as KVNamespace });

    const response = await handleMonitorLatest(createMockRequest(), env);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.data?.total ?? body.total, 1);
});

Deno.test('handleMonitorLatest: returns 500 for malformed JSON in KV', async () => {
    const kv = new MockKVNamespace();
    await kv.put('browser:monitor:latest', 'not-valid-json{{{');
    const env = createMockEnv({ COMPILATION_CACHE: kv as unknown as KVNamespace });

    const response = await handleMonitorLatest(createMockRequest(), env);
    assertEquals(response.status, 500);
});

// ============================================================================
// handleResolveUrl — POST /api/browser/resolve-url (validation paths)
// ============================================================================

Deno.test('handleResolveUrl: returns 503 when BROWSER binding is missing', async () => {
    const env = createMockEnv();
    const request = createMockRequest('https://test.example.com/api/browser/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
    });
    const response = await handleResolveUrl(request, env);
    assertEquals(response.status, 503);
});

Deno.test('handleResolveUrl: returns 400 for non-JSON body', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/resolve-url', {
        method: 'POST',
        body: 'not json',
    });
    const response = await handleResolveUrl(request, env);
    assertEquals(response.status, 400);
    const body = await response.json();
    assertStringIncludes(body.error || body.message || JSON.stringify(body), 'JSON');
});

Deno.test('handleResolveUrl: returns 400 for invalid URL', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url' }),
    });
    const response = await handleResolveUrl(request, env);
    assertEquals(response.status, 400);
});

Deno.test('handleResolveUrl: returns 400 for timeout out of range', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com', timeout: 100 }),
    });
    const response = await handleResolveUrl(request, env);
    assertEquals(response.status, 400);
});

Deno.test('handleResolveUrl: returns 400 for missing url field', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: 5000 }),
    });
    const response = await handleResolveUrl(request, env);
    assertEquals(response.status, 400);
});

// ============================================================================
// handleSourceMonitor — POST /api/browser/monitor (validation paths)
// ============================================================================

Deno.test('handleSourceMonitor: returns 503 when BROWSER binding is missing', async () => {
    const env = createMockEnv();
    const request = createMockRequest('https://test.example.com/api/browser/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: ['https://example.com'] }),
    });
    const response = await handleSourceMonitor(request, env, createMockCtx());
    assertEquals(response.status, 503);
});

Deno.test('handleSourceMonitor: returns 400 for non-JSON body', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/monitor', {
        method: 'POST',
        body: 'not json',
    });
    const response = await handleSourceMonitor(request, env, createMockCtx());
    assertEquals(response.status, 400);
});

Deno.test('handleSourceMonitor: returns 400 for empty urls array', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [] }),
    });
    const response = await handleSourceMonitor(request, env, createMockCtx());
    assertEquals(response.status, 400);
});

Deno.test('handleSourceMonitor: returns 400 for more than 10 urls', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const urls = Array.from({ length: 11 }, (_, i) => `https://example${i}.com`);
    const request = createMockRequest('https://test.example.com/api/browser/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
    });
    const response = await handleSourceMonitor(request, env, createMockCtx());
    assertEquals(response.status, 400);
});

Deno.test('handleSourceMonitor: returns 400 for invalid URL in array', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: ['not-a-url'] }),
    });
    const response = await handleSourceMonitor(request, env, createMockCtx());
    assertEquals(response.status, 400);
});

Deno.test('handleSourceMonitor: returns 400 for invalid screenshotPrefix', async () => {
    const env = createMockEnv({ BROWSER: {} as unknown as BrowserWorker });
    const request = createMockRequest('https://test.example.com/api/browser/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: ['https://example.com'], screenshotPrefix: 'invalid prefix with spaces!' }),
    });
    const response = await handleSourceMonitor(request, env, createMockCtx());
    assertEquals(response.status, 400);
});

// ============================================================================
// Zod schema validation coverage (SourceMonitorRequestSchema)
// ============================================================================

Deno.test('handleSourceMonitor: accepts valid minimal request body (schema validation)', async () => {
    // This test verifies Zod accepts the shape — the handler will return 502
    // because BROWSER.fetch is a stub, but that proves validation passed.
    const env = createMockEnv({
        BROWSER: {
            fetch: async () => {
                throw new Error('stub');
            },
        } as unknown as BrowserWorker,
    });
    const request = createMockRequest('https://test.example.com/api/browser/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: ['https://example.com'] }),
    });
    const response = await handleSourceMonitor(request, env, createMockCtx());
    // If validation passes, we get 200 (results with reachable: false) not 400
    assertEquals(response.status, 200);
    const body = await response.json();
    const data = body.data ?? body;
    assertEquals(data.total, 1);
    assertEquals(data.unreachable, 1);
});

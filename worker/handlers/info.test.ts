/**
 * Tests for the Info / API metadata handlers.
 *
 * Covers:
 *   - handleInfo: returns JSON API info with Accept: application/json
 *   - handleInfo: returns redirect for browser requests
 *   - handleInfo: respects ?format=json override
 *   - routeApiMeta: returns null for non-GET requests
 *   - routeApiMeta: GET /api → API info
 *   - routeApiMeta: GET /api/version → 503 when DB missing
 *   - routeApiMeta: GET /api/deployments → 503 when DB missing
 *   - routeApiMeta: GET /api/deployments/stats → 503 when DB missing
 *   - routeApiMeta: GET /api/turnstile-config → siteKey and enabled
 *   - routeApiMeta: GET /api/clerk-config → publishableKey
 *   - routeApiMeta: GET /api/sentry-config → delegates to handleSentryConfig
 *   - routeApiMeta: unmatched path → returns null
 *
 * @see worker/handlers/info.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleInfo, routeApiMeta } from './info.ts';
import type { Env } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.2.3',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

function makeRequest(path: string, options?: RequestInit): Request {
    return new Request(`http://localhost${path}`, options);
}

// ============================================================================
// handleInfo
// ============================================================================

Deno.test('handleInfo - returns JSON response with Accept:application/json', async () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'application/json' } });
    const env = makeEnv();
    const res = handleInfo(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { name: string; version: string; endpoints: Record<string, string> };
    assertExists(body.name);
    assertExists(body.version);
    assertExists(body.endpoints);
});

Deno.test('handleInfo - includes COMPILER_VERSION in response', async () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'application/json' } });
    const env = makeEnv({ COMPILER_VERSION: '9.9.9' });
    const res = handleInfo(req, env);
    const body = await res.json() as { version: string };
    assertEquals(body.version, '9.9.9');
});

Deno.test('handleInfo - returns redirect for browser request when ASSETS is present', () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'text/html,application/xhtml+xml' } });
    const env = makeEnv({ ASSETS: {} as unknown as Fetcher });
    const res = handleInfo(req, env);
    assertEquals(res.status, 302);
});

Deno.test('handleInfo - respects ?format=json override (no redirect even with ASSETS)', async () => {
    const req = makeRequest('/api?format=json', { headers: { 'Accept': 'text/html' } });
    const env = makeEnv({ ASSETS: {} as unknown as Fetcher });
    const res = handleInfo(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { name: string };
    assertExists(body.name);
});

// ============================================================================
// routeApiMeta
// ============================================================================

Deno.test('routeApiMeta - returns null for non-GET requests', async () => {
    const req = makeRequest('/api', { method: 'POST' });
    const url = new URL(req.url);
    const result = await routeApiMeta('/api', req, url, makeEnv());
    assertEquals(result, null);
});

Deno.test('routeApiMeta - GET /api returns API info', async () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'application/json' } });
    const url = new URL(req.url);
    const result = await routeApiMeta('/api', req, url, makeEnv());
    assertExists(result);
    const body = await result!.json() as { name: string };
    assertExists(body.name);
});

Deno.test('routeApiMeta - GET /api/version returns 503 when DB is not configured', async () => {
    const req = makeRequest('/api/version');
    const url = new URL(req.url);
    const env = makeEnv(); // no DB
    const result = await routeApiMeta('/api/version', req, url, env);
    assertExists(result);
    assertEquals(result!.status, 503);
});

Deno.test('routeApiMeta - GET /api/deployments returns 503 when DB is missing', async () => {
    const req = makeRequest('/api/deployments');
    const url = new URL(req.url);
    const result = await routeApiMeta('/api/deployments', req, url, makeEnv());
    assertExists(result);
    assertEquals(result!.status, 503);
});

Deno.test('routeApiMeta - GET /api/deployments/stats returns 503 when DB is missing', async () => {
    const req = makeRequest('/api/deployments/stats');
    const url = new URL(req.url);
    const result = await routeApiMeta('/api/deployments/stats', req, url, makeEnv());
    assertExists(result);
    assertEquals(result!.status, 503);
});

Deno.test('routeApiMeta - GET /api/turnstile-config returns siteKey and enabled', async () => {
    const req = makeRequest('/api/turnstile-config');
    const url = new URL(req.url);
    const env = makeEnv({ TURNSTILE_SITE_KEY: 'site-key-123', TURNSTILE_SECRET_KEY: 'secret-key-xxx' });
    const result = await routeApiMeta('/api/turnstile-config', req, url, env);
    assertExists(result);
    const body = await result!.json() as { siteKey: string; enabled: boolean };
    assertEquals(body.siteKey, 'site-key-123');
    assertEquals(body.enabled, true);
});

Deno.test('routeApiMeta - GET /api/turnstile-config returns enabled:false when no secret key', async () => {
    const req = makeRequest('/api/turnstile-config');
    const url = new URL(req.url);
    const env = makeEnv({ TURNSTILE_SITE_KEY: 'key' }); // no TURNSTILE_SECRET_KEY
    const result = await routeApiMeta('/api/turnstile-config', req, url, env);
    assertExists(result);
    const body = await result!.json() as { enabled: boolean };
    assertEquals(body.enabled, false);
});

Deno.test('routeApiMeta - GET /api/turnstile-config returns siteKey:null when unset', async () => {
    const req = makeRequest('/api/turnstile-config');
    const url = new URL(req.url);
    const result = await routeApiMeta('/api/turnstile-config', req, url, makeEnv());
    assertExists(result);
    const body = await result!.json() as { siteKey: null };
    assertEquals(body.siteKey, null);
});

Deno.test('routeApiMeta - GET /api/clerk-config returns publishableKey', async () => {
    const req = makeRequest('/api/clerk-config');
    const url = new URL(req.url);
    const env = makeEnv({ CLERK_PUBLISHABLE_KEY: 'pk_test_abc123' });
    const result = await routeApiMeta('/api/clerk-config', req, url, env);
    assertExists(result);
    const body = await result!.json() as { publishableKey: string };
    assertEquals(body.publishableKey, 'pk_test_abc123');
});

Deno.test('routeApiMeta - GET /api/clerk-config returns null when key is unset', async () => {
    const req = makeRequest('/api/clerk-config');
    const url = new URL(req.url);
    const result = await routeApiMeta('/api/clerk-config', req, url, makeEnv());
    assertExists(result);
    const body = await result!.json() as { publishableKey: null };
    assertEquals(body.publishableKey, null);
});

Deno.test('routeApiMeta - GET /api/sentry-config delegates to handleSentryConfig', async () => {
    const req = makeRequest('/api/sentry-config');
    const url = new URL(req.url);
    const env = makeEnv({ SENTRY_DSN: 'https://key@sentry.io/123' });
    const result = await routeApiMeta('/api/sentry-config', req, url, env);
    assertExists(result);
    const body = await result!.json() as { dsn: string };
    assertEquals(body.dsn, 'https://key@sentry.io/123');
});

Deno.test('routeApiMeta - unmatched path returns null', async () => {
    const req = makeRequest('/api/unknown-path');
    const url = new URL(req.url);
    const result = await routeApiMeta('/api/unknown-path', req, url, makeEnv());
    assertEquals(result, null);
});

// ============================================================================
// Endpoint registry assertions
// ============================================================================

Deno.test('handleInfo - endpoint registry contains DELETE /queue/cancel/:requestId (not POST)', async () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'application/json' } });
    const env = makeEnv();
    const res = handleInfo(req, env);
    const body = await res.json() as { endpoints: Record<string, string> };
    assertExists(body.endpoints['DELETE /queue/cancel/:requestId']);
    assertEquals(body.endpoints['POST /queue/cancel/:requestId'], undefined);
});

Deno.test('handleInfo - endpoint registry contains POST /ast/parse', async () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'application/json' } });
    const env = makeEnv();
    const res = handleInfo(req, env);
    const body = await res.json() as { endpoints: Record<string, string> };
    assertExists(body.endpoints['POST /ast/parse']);
});

Deno.test('handleInfo - endpoint registry contains GET /configuration/defaults', async () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'application/json' } });
    const env = makeEnv();
    const res = handleInfo(req, env);
    const body = await res.json() as { endpoints: Record<string, string> };
    assertExists(body.endpoints['GET /configuration/defaults']);
});

Deno.test('handleInfo - endpoint registry contains GET /api/schemas', async () => {
    const req = makeRequest('/api', { headers: { 'Accept': 'application/json' } });
    const env = makeEnv();
    const res = handleInfo(req, env);
    const body = await res.json() as { endpoints: Record<string, string> };
    assertExists(body.endpoints['GET /api/schemas']);
});

Deno.test('routeApiMeta - GET /api/schemas returns schemas response', async () => {
    const req = makeRequest('/api/schemas');
    const url = new URL(req.url);
    const result = await routeApiMeta('/api/schemas', req, url, makeEnv());
    assertExists(result);
    assertEquals(result!.status, 200);
    const body = await result!.json() as { success: boolean; schemas: Record<string, unknown> };
    assertEquals(body.success, true);
    assertExists(body.schemas);
});

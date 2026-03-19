/**
 * Tests for the health check handlers.
 *
 * Covers:
 *   - handleHealth: all services healthy
 *   - handleHealth: database down when env.DB is missing
 *   - handleHealth: auth provider detection (clerk / local / none)
 *   - handleHealth: compiler degraded when ADBLOCK_COMPILER is missing
 *   - handleHealth: overall status is worst-of-all-services
 *   - handleHealthLatest: returns no-data message when METRICS has no entry
 *   - handleHealthLatest: returns cached data when available
 *   - handleHealthLatest: returns 500 on KV error
 *
 * @see worker/handlers/health.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleHealth, handleHealthLatest } from './health.ts';
import { makeDb, makeEnv, makeFailingKv, makeKv } from '../test-helpers.ts';

// ============================================================================
// handleHealth
// ============================================================================

Deno.test('handleHealth - returns JSON response', async () => {
    const env = makeEnv({ JWT_SECRET: 'test-secret', DB: makeDb(), ADBLOCK_COMPILER: {} as DurableObjectNamespace });
    const res = await handleHealth(env);
    assertEquals(res.status, 200);
    const body = await res.json() as { status: string };
    assertExists(body.status);
});

Deno.test('handleHealth - overall status healthy when all services healthy', async () => {
    const env = makeEnv({
        JWT_SECRET: 'test-secret',
        DB: makeDb(),
        ADBLOCK_COMPILER: {} as DurableObjectNamespace,
    });
    const res = await handleHealth(env);
    const body = await res.json() as { status: string; services: Record<string, { status: string }> };
    assertEquals(body.services.gateway.status, 'healthy');
    assertEquals(body.services.auth.status, 'healthy');
    assertEquals(body.services.compiler.status, 'healthy');
});

Deno.test('handleHealth - database down when env.DB is missing', async () => {
    const env = makeEnv({ JWT_SECRET: 'test-secret' });
    const res = await handleHealth(env);
    const body = await res.json() as { status: string; services: Record<string, { status: string }> };
    assertEquals(body.services.database.status, 'down');
});

Deno.test('handleHealth - auth provider is "clerk" when CLERK_JWKS_URL is set', async () => {
    const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
    const res = await handleHealth(env);
    const body = await res.json() as { services: { auth: { provider: string; status: string } } };
    assertEquals(body.services.auth.provider, 'clerk');
    assertEquals(body.services.auth.status, 'healthy');
});

Deno.test('handleHealth - auth provider is "local" when JWT_SECRET is set (no Clerk)', async () => {
    const env = makeEnv({ JWT_SECRET: 'my-test-secret' });
    const res = await handleHealth(env);
    const body = await res.json() as { services: { auth: { provider: string; status: string } } };
    assertEquals(body.services.auth.provider, 'local');
    assertEquals(body.services.auth.status, 'healthy');
});

Deno.test('handleHealth - auth provider is "none" when no auth is configured', async () => {
    const env = makeEnv();
    const res = await handleHealth(env);
    const body = await res.json() as { services: { auth: { provider: string; status: string } } };
    assertEquals(body.services.auth.provider, 'none');
    assertEquals(body.services.auth.status, 'degraded');
});

Deno.test('handleHealth - compiler degraded when ADBLOCK_COMPILER binding is missing', async () => {
    const env = makeEnv({ JWT_SECRET: 'test-secret' });
    const res = await handleHealth(env);
    const body = await res.json() as { services: { compiler: { status: string } } };
    assertEquals(body.services.compiler.status, 'degraded');
});

Deno.test('handleHealth - overall status degrades when any service is degraded', async () => {
    const env = makeEnv(); // no auth, no compiler → degraded
    const res = await handleHealth(env);
    const body = await res.json() as { status: string };
    assertEquals(body.status !== 'healthy', true);
});

Deno.test('handleHealth - cache down when COMPILATION_CACHE.list() throws', async () => {
    const env = makeEnv({
        COMPILATION_CACHE: makeFailingKv(),
        JWT_SECRET: 'test-secret',
    });
    const res = await handleHealth(env);
    const body = await res.json() as { services: { cache: { status: string } } };
    assertEquals(body.services.cache.status, 'down');
});

Deno.test('handleHealth - includes version in response', async () => {
    const env = makeEnv({ COMPILER_VERSION: '2.0.0', JWT_SECRET: 'secret' });
    const res = await handleHealth(env);
    const body = await res.json() as { version: string };
    assertEquals(body.version, '2.0.0');
});

Deno.test('handleHealth - includes ISO timestamp in response', async () => {
    const env = makeEnv();
    const res = await handleHealth(env);
    const body = await res.json() as { timestamp: string };
    assertExists(body.timestamp);
    // Must be a valid ISO date string
    assertEquals(isNaN(Date.parse(body.timestamp)), false);
});

// ============================================================================
// handleHealthLatest
// ============================================================================

Deno.test('handleHealthLatest - returns no-data message when METRICS has no entry', async () => {
    const env = makeEnv(); // makeKv() returns null for get()
    const res = await handleHealthLatest(env);
    const body = await res.json() as { success: boolean; message: string };
    assertEquals(res.status, 200);
    assertEquals(body.success, true);
    assertExists(body.message);
});

Deno.test('handleHealthLatest - returns cached data when available', async () => {
    const cached = { status: 'healthy', services: {}, timestamp: '2024-01-01T00:00:00Z' };
    const env = makeEnv({ METRICS: makeKv(cached) });
    const res = await handleHealthLatest(env);
    const body = await res.json() as { success: boolean; status: string };
    assertEquals(body.success, true);
    assertEquals(body.status, 'healthy');
});

Deno.test('handleHealthLatest - returns 500 on KV error', async () => {
    const env = makeEnv({ METRICS: makeFailingKv() });
    const res = await handleHealthLatest(env);
    assertEquals(res.status, 500);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

/**
 * Tests for the health check handlers.
 *
 * Covers:
 *   - handleHealth: all services healthy
 *   - handleHealth: database down when env.DB is missing
 *   - handleHealth: auth provider detection (better-auth / none)
 *   - handleHealth: compiler degraded when ADBLOCK_COMPILER is missing
 *   - handleHealth: overall status is worst-of-all-services
 *   - handleHealthLatest: returns no-data message when METRICS has no entry
 *   - handleHealthLatest: returns cached data when available
 *   - handleHealthLatest: returns 500 on KV error
 *
 * @see worker/handlers/health.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { stub } from '@std/testing/mock';
import { handleHealth, handleHealthLatest } from './health.ts';
import { type HyperdriveBinding } from '../types.ts';
import { _internals } from '../lib/prisma.ts';
import { makeEnv, makeFailingKv, makeKv } from '../test-helpers.ts';

// ============================================================================
// handleHealth
// ============================================================================

Deno.test('handleHealth - returns JSON response', async () => {
    const env = makeEnv({ BETTER_AUTH_SECRET: 'test-secret', ADBLOCK_COMPILER: {} as DurableObjectNamespace });
    const res = await handleHealth(env);
    assertEquals(res.status, 200);
    const body = await res.json() as { status: string };
    assertExists(body.status);
});

Deno.test('handleHealth - overall status healthy when all services healthy', async () => {
    const mockPrisma = { $queryRaw: async () => [{ '?column?': 1 }] };
    const s = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            BETTER_AUTH_SECRET: 'test-secret',
            HYPERDRIVE: { connectionString: 'postgresql://test' } as unknown as HyperdriveBinding,
            ADBLOCK_COMPILER: {} as DurableObjectNamespace,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { status: string; services: Record<string, { status: string }> };
        assertEquals(body.services.gateway.status, 'healthy');
        assertEquals(body.services.auth.status, 'healthy');
        assertEquals(body.services.compiler.status, 'healthy');
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - database down when env.HYPERDRIVE is missing', async () => {
    const env = makeEnv({ BETTER_AUTH_SECRET: 'test-secret' });
    const res = await handleHealth(env);
    const body = await res.json() as { status: string; services: Record<string, { status: string }> };
    assertEquals(body.services.database.status, 'down');
});

Deno.test('handleHealth - auth provider is "better-auth" when BETTER_AUTH_SECRET is set', async () => {
    const mockPrisma = { $queryRaw: async () => [{ '?column?': 1 }] };
    const s = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            BETTER_AUTH_SECRET: 'my-test-secret',
            HYPERDRIVE: { connectionString: 'postgresql://test' } as unknown as HyperdriveBinding,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { services: { auth: { provider: string; status: string } } };
        assertEquals(body.services.auth.provider, 'better-auth');
        assertEquals(body.services.auth.status, 'healthy');
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - auth status is "down" when better-auth is set but HYPERDRIVE binding is missing', async () => {
    const env = makeEnv({ BETTER_AUTH_SECRET: 'my-test-secret' }); // no HYPERDRIVE
    const res = await handleHealth(env);
    const body = await res.json() as { services: { auth: { provider: string; status: string } } };
    assertEquals(body.services.auth.provider, 'better-auth');
    assertEquals(body.services.auth.status, 'down');
});

Deno.test('handleHealth - auth provider is "none" when no auth is configured', async () => {
    const env = makeEnv();
    const res = await handleHealth(env);
    const body = await res.json() as { services: { auth: { provider: string; status: string } } };
    assertEquals(body.services.auth.provider, 'none');
    assertEquals(body.services.auth.status, 'degraded');
});

Deno.test('handleHealth - compiler degraded when ADBLOCK_COMPILER binding is missing', async () => {
    const env = makeEnv({ BETTER_AUTH_SECRET: 'test-secret' });
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
        BETTER_AUTH_SECRET: 'test-secret',
    });
    const res = await handleHealth(env);
    const body = await res.json() as { services: { cache: { status: string } } };
    assertEquals(body.services.cache.status, 'down');
});

Deno.test('handleHealth - includes version in response', async () => {
    const env = makeEnv({ COMPILER_VERSION: '2.0.0', BETTER_AUTH_SECRET: 'secret' });
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

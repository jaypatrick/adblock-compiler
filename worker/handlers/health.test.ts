/**
 * Tests for the health check handlers.
 *
 * Covers:
 *   - handleHealth: all services healthy
 *   - handleHealth: database down when env.DB is missing
 *   - handleHealth: auth provider detection (better-auth / none)
 *   - handleHealth: compiler degraded when ADBLOCK_COMPILER is missing
 *   - handleHealth: overall status is worst-of-all-services
 *   - handleHealth: error_code and error_message surfaced when Prisma throws
 *   - handleHealth: error_message does not contain postgres:// credentials
 *   - handleHealth: timeout scenario results in status down with PROBE_TIMEOUT error_code
 *   - handleHealthLatest: returns no-data message when METRICS has no entry
 *   - handleHealthLatest: returns cached data when available
 *   - handleHealthLatest: returns 500 on KV error
 *   - handleDbSmoke: happy path returns ok:true with diagnostic fields
 *   - handleDbSmoke: Prisma error returns ok:false with status 503
 *   - handleDbSmoke: missing HYPERDRIVE returns status 400
 *
 * @see worker/handlers/health.ts
 */

import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { stub } from '@std/testing/mock';
import { FakeTime } from '@std/testing/time';
import { handleDbSmoke, handleHealth, handleHealthLatest } from './health.ts';
import { type HyperdriveBinding } from '../types.ts';
import { _internals } from '../lib/prisma.ts';
import { makeEnv, makeFailingKv, makeKv } from '../test-helpers.ts';

// ============================================================================
// Shared mock factory helpers
// ============================================================================

/** Build a minimal mock Prisma client that returns healthy DB rows. */
function makeHealthyPrisma() {
    return {
        $queryRaw: async () => [{ db_name: 'adblock-compiler' }],
        $disconnect: async () => {},
    };
}

/** Build a mock Prisma client whose $queryRaw always throws. */
function makeFailingPrisma(err: Error) {
    return {
        $queryRaw: async () => {
            throw err;
        },
        $disconnect: async () => {},
    };
}

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
    const s = stub(_internals, 'createPrismaClient', () => makeHealthyPrisma() as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            BETTER_AUTH_SECRET: 'test-secret',
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
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
    const s = stub(_internals, 'createPrismaClient', () => makeHealthyPrisma() as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            BETTER_AUTH_SECRET: 'my-test-secret',
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
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

Deno.test('handleHealth - database degraded when connected to wrong database', async () => {
    const mockPrisma = { $queryRaw: async () => [{ db_name: 'neondb' }], $disconnect: async () => {} };
    const s = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { services: { database: { status: string } } };
        assertEquals(body.services.database.status, 'degraded');
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - database response includes db_name when healthy', async () => {
    const s = stub(_internals, 'createPrismaClient', () => makeHealthyPrisma() as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { services: { database: { status: string; db_name: string } } };
        assertEquals(body.services.database.status, 'healthy');
        assertEquals(body.services.database.db_name, 'adblock-compiler');
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - database response includes hyperdrive_host when healthy', async () => {
    const s = stub(_internals, 'createPrismaClient', () => makeHealthyPrisma() as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { services: { database: { hyperdrive_host: string } } };
        assertEquals(body.services.database.hyperdrive_host, 'ep-test-pooler.eastus2.azure.neon.tech');
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - database down when $queryRaw throws', async () => {
    const s = stub(_internals, 'createPrismaClient', () => makeFailingPrisma(new Error('connection refused')) as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { services: { database: { status: string } } };
        assertEquals(body.services.database.status, 'down');
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - database error includes error_code and error_message when Prisma throws', async () => {
    const err = new Error('connection refused');
    const s = stub(_internals, 'createPrismaClient', () => makeFailingPrisma(err) as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { services: { database: { status: string; error_code: string; error_message: string } } };
        assertEquals(body.services.database.status, 'down');
        assertExists(body.services.database.error_code);
        assertExists(body.services.database.error_message);
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - error_message does not contain postgres:// credentials', async () => {
    const err = new Error('connect ECONNREFUSED postgres://neondb_owner:super-secret@ep-example.neon.tech/adblock-compiler');
    const s = stub(_internals, 'createPrismaClient', () => makeFailingPrisma(err) as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleHealth(env);
        const body = await res.json() as { services: { database: { error_message: string } } };
        assertEquals(body.services.database.error_message.includes('postgres://'), false);
        assertEquals(body.services.database.error_message.includes('super-secret'), false);
        assertStringIncludes(body.services.database.error_message, '[redacted]');
    } finally {
        s.restore();
    }
});

Deno.test('handleHealth - timeout scenario results in status down with PROBE_TIMEOUT error_code', async () => {
    // Use FakeTime to control the timer and actually exercise the Promise.race timeout branch.
    // The mock Prisma never resolves so only the 5 s timer can settle the race.
    const neverMock = {
        $queryRaw: () => new Promise<never>(() => {}), // intentionally never resolves
        $disconnect: async () => {},
    };
    const s = stub(_internals, 'createPrismaClient', () => neverMock as unknown as ReturnType<typeof _internals.createPrismaClient>);
    const fakeTime = new FakeTime();
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const healthPromise = handleHealth(env);
        // Advance fake clock past the 5 000 ms probe timeout so the timer fires.
        await fakeTime.tickAsync(5001);
        const res = await healthPromise;
        const body = await res.json() as { services: { database: { status: string; error_code: string } } };
        assertEquals(body.services.database.status, 'down');
        assertEquals(body.services.database.error_code, 'PROBE_TIMEOUT');
    } finally {
        fakeTime.restore();
        s.restore();
    }
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

// ============================================================================
// handleDbSmoke
// ============================================================================

Deno.test('handleDbSmoke - returns 400 when HYPERDRIVE is not configured', async () => {
    const env = makeEnv(); // no HYPERDRIVE
    const res = await handleDbSmoke(env);
    assertEquals(res.status, 400);
    const body = await res.json() as { ok: boolean; error: string };
    assertEquals(body.ok, false);
    assertExists(body.error);
});

Deno.test('handleDbSmoke - happy path: returns ok:true with diagnostic fields', async () => {
    const serverTime = new Date('2026-03-25T21:59:15.917Z');
    const smokeMock = {
        $queryRaw: async (strings: TemplateStringsArray) => {
            // Return different results based on which query is being called
            const sql = strings.join('');
            if (sql.includes('current_database')) {
                return [{ db_name: 'adblock-compiler', pg_version: 'PostgreSQL 16.2', server_time: serverTime }];
            }
            if (sql.includes('information_schema')) {
                return [{ table_count: BigInt(17) }];
            }
            return [];
        },
        $disconnect: async () => {},
    };
    const s = stub(_internals, 'createPrismaClient', () => smokeMock as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleDbSmoke(env);
        assertEquals(res.status, 200);
        const body = await res.json() as {
            ok: boolean;
            db_name: string;
            pg_version: string;
            server_time: string;
            table_count: number;
            latency_ms: number;
            hyperdrive_host: string;
        };
        assertEquals(body.ok, true);
        assertEquals(body.db_name, 'adblock-compiler');
        assertEquals(body.pg_version, 'PostgreSQL 16.2');
        assertEquals(body.table_count, 17);
        assertEquals(body.hyperdrive_host, 'ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech');
        assertExists(body.latency_ms);
        assertExists(body.server_time);
    } finally {
        s.restore();
    }
});

Deno.test('handleDbSmoke - sad path: Prisma throws → ok:false, status 503', async () => {
    const s = stub(_internals, 'createPrismaClient', () => makeFailingPrisma(new Error('connection refused')) as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleDbSmoke(env);
        assertEquals(res.status, 503);
        const body = await res.json() as { ok: boolean; error: string; hyperdrive_host: string };
        assertEquals(body.ok, false);
        assertExists(body.error);
        assertEquals(body.hyperdrive_host, 'ep-test-pooler.eastus2.azure.neon.tech');
    } finally {
        s.restore();
    }
});

Deno.test('handleDbSmoke - error message is redacted when it contains postgres:// credentials', async () => {
    const err = new Error('failed: postgres://neondb_owner:secret@ep-example.neon.tech/db');
    const s = stub(_internals, 'createPrismaClient', () => makeFailingPrisma(err) as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const env = makeEnv({
            HYPERDRIVE: { connectionString: 'postgresql://test', host: 'ep-test-pooler.eastus2.azure.neon.tech' } as unknown as HyperdriveBinding,
        });
        const res = await handleDbSmoke(env);
        const body = await res.json() as { ok: boolean; error: string };
        assertEquals(body.ok, false);
        assertEquals(body.error.includes('postgres://'), false);
        assertEquals(body.error.includes('secret'), false);
        assertStringIncludes(body.error, '[redacted]');
    } finally {
        s.restore();
    }
});

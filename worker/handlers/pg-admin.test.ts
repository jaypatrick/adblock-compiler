/**
 * Tests for the PostgreSQL admin handlers, focusing on backend health status.
 *
 * Covers test plan item: GET /admin/backends
 * These tests run without a live database by mocking D1 and the PgPool factory.
 */

import { assertEquals } from '@std/assert';
import { handleBackendStatus } from './pg-admin.ts';
import type { D1Database, D1ExecResult, D1Result, Env, HyperdriveBinding } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

const MOCK_HYPERDRIVE: HyperdriveBinding = {
    connectionString: 'postgresql://test:test@localhost:5432/testdb',
    host: 'test-pg-host',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'testdb',
};

type MockPgPool = {
    query<T>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

type MockPgFactory = (connectionString: string) => MockPgPool;

/** Creates a healthy D1 mock (SELECT 1 succeeds). */
function createHealthyD1(): D1Database {
    return {
        prepare: (_query: string) => {
            const stmt = {
                bind: () => stmt,
                first: async <T>(): Promise<T | null> => ({ 1: 1 } as T),
                all: async <T>() => ({ results: [] as T[], success: true }),
                run: async () => ({ success: true }),
                raw: async <T>(): Promise<T[]> => [],
            };
            return stmt;
        },
        dump: async (): Promise<ArrayBuffer> => new ArrayBuffer(0),
        batch: async <T>(): Promise<D1Result<T>[]> => [],
        exec: async (): Promise<D1ExecResult> => ({ count: 0, duration: 0 }),
    } as unknown as D1Database;
}

/** Creates a D1 mock that throws on every query. */
function createFaultyD1(message = 'D1 connection failed'): D1Database {
    return {
        prepare: (_query: string) => {
            const stmt = {
                bind: () => stmt,
                first: async (): Promise<never> => {
                    throw new Error(message);
                },
                all: async (): Promise<never> => {
                    throw new Error(message);
                },
                run: async (): Promise<never> => {
                    throw new Error(message);
                },
                raw: async (): Promise<never> => {
                    throw new Error(message);
                },
            };
            return stmt;
        },
        dump: async (): Promise<ArrayBuffer> => new ArrayBuffer(0),
        batch: async <T>(): Promise<D1Result<T>[]> => [],
        exec: async (): Promise<D1ExecResult> => ({ count: 0, duration: 0 }),
    } as unknown as D1Database;
}

/** Builds a minimal Env with optional bindings. */
function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: 'test',
        COMPILATION_CACHE: {} as KVNamespace,
        RATE_LIMIT: {} as KVNamespace,
        METRICS: {} as KVNamespace,
        ASSETS: {} as unknown as Fetcher,
        ...overrides,
    };
}

// ============================================================================
// GET /admin/backends — test plan item
// ============================================================================

Deno.test('handleBackendStatus - both backends unavailable when no bindings', async () => {
    const res = await handleBackendStatus(makeEnv());

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);

    const backends = body.backends as Record<string, { available: boolean }>;
    assertEquals(backends.d1.available, false);
    assertEquals(backends.postgresql.available, false);

    // Without HYPERDRIVE, the primary backend is D1
    assertEquals(body.primary, 'd1');
});

Deno.test('handleBackendStatus - D1 available, no HYPERDRIVE binding', async () => {
    const res = await handleBackendStatus(makeEnv({ DB: createHealthyD1() }));

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;

    const backends = body.backends as Record<string, { available: boolean; latencyMs?: number }>;
    assertEquals(backends.d1.available, true);
    assertEquals(typeof backends.d1.latencyMs, 'number');
    assertEquals(backends.postgresql.available, false);
    assertEquals(body.primary, 'd1');
});

Deno.test('handleBackendStatus - PostgreSQL available via Hyperdrive', async () => {
    const createPool: MockPgFactory = (_cs) => ({
        async query<T>(): Promise<{ rows: T[]; rowCount: number | null }> {
            return { rows: [] as T[], rowCount: 1 };
        },
    });

    const res = await handleBackendStatus(makeEnv({ HYPERDRIVE: MOCK_HYPERDRIVE }), createPool);

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;

    const backends = body.backends as Record<string, { available: boolean; host?: string; latencyMs?: number }>;
    assertEquals(backends.postgresql.available, true);
    assertEquals(backends.postgresql.host, MOCK_HYPERDRIVE.host);
    assertEquals(typeof backends.postgresql.latencyMs, 'number');
    // With HYPERDRIVE, primary is postgresql
    assertEquals(body.primary, 'postgresql');
});

Deno.test('handleBackendStatus - primary is postgresql when HYPERDRIVE is present', async () => {
    const createPool: MockPgFactory = (_cs) => ({
        async query() {
            return { rows: [], rowCount: 0 };
        },
    });

    const res = await handleBackendStatus(makeEnv({ HYPERDRIVE: MOCK_HYPERDRIVE }), createPool);
    const body = await res.json() as Record<string, unknown>;

    assertEquals(body.primary, 'postgresql');
});

Deno.test('handleBackendStatus - both D1 and PostgreSQL available', async () => {
    const createPool: MockPgFactory = (_cs) => ({
        async query<T>(): Promise<{ rows: T[]; rowCount: number | null }> {
            return { rows: [] as T[], rowCount: 1 };
        },
    });

    const res = await handleBackendStatus(
        makeEnv({ DB: createHealthyD1(), HYPERDRIVE: MOCK_HYPERDRIVE }),
        createPool,
    );

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const backends = body.backends as Record<string, { available: boolean }>;
    assertEquals(backends.d1.available, true);
    assertEquals(backends.postgresql.available, true);
    assertEquals(body.primary, 'postgresql');
});

Deno.test('handleBackendStatus - D1 error is captured in response', async () => {
    const res = await handleBackendStatus(makeEnv({ DB: createFaultyD1('disk I/O error') }));

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const backends = body.backends as Record<string, { available: boolean; error?: string }>;
    assertEquals(backends.d1.available, false);
    assertEquals(typeof backends.d1.error, 'string');
});

Deno.test('handleBackendStatus - PostgreSQL error is captured in response', async () => {
    const createPool: MockPgFactory = (_cs) => ({
        async query() {
            throw new Error('PG connection refused');
        },
    });

    const res = await handleBackendStatus(makeEnv({ HYPERDRIVE: MOCK_HYPERDRIVE }), createPool);

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const backends = body.backends as Record<string, { available: boolean; error?: string }>;
    assertEquals(backends.postgresql.available, false);
    assertEquals(typeof backends.postgresql.error, 'string');
});

Deno.test('handleBackendStatus - response includes timestamp', async () => {
    const res = await handleBackendStatus(makeEnv());
    const body = await res.json() as Record<string, unknown>;

    assertEquals(typeof body.timestamp, 'string');
    // Verify it's a valid ISO 8601 date
    const ts = new Date(body.timestamp as string);
    assertEquals(isNaN(ts.getTime()), false);
});

Deno.test('handleBackendStatus - PostgreSQL not checked when createPool not provided', async () => {
    // Even with HYPERDRIVE bound, PostgreSQL status stays unavailable if no pool factory
    const res = await handleBackendStatus(makeEnv({ HYPERDRIVE: MOCK_HYPERDRIVE }));

    const body = await res.json() as Record<string, unknown>;
    const backends = body.backends as Record<string, { available: boolean }>;
    assertEquals(backends.postgresql.available, false);
    // Primary is still postgresql because HYPERDRIVE is set
    assertEquals(body.primary, 'postgresql');
});

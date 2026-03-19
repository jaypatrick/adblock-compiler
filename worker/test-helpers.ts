/**
 * Shared test fixtures for Cloudflare Worker handler tests.
 *
 * Provides reusable KV, D1, and Env stubs so each test file does not need to
 * redeclare the same boilerplate. Import what you need:
 *
 *   import { makeKv, makeInMemoryKv, makeFailingKv, makeDb, makeEnv } from '../test-helpers.ts';
 */

import type { Env } from './types.ts';

// ============================================================================
// KVNamespace stubs
// ============================================================================

/** A KVNamespace stub that returns `getResult` for every `.get()` call. */
export function makeKv(getResult: unknown = null): KVNamespace {
    return {
        list: async () => ({ keys: [], list_complete: true, cursor: '' }),
        get: async <T>() => getResult as T,
        put: async () => {},
        delete: async () => {},
        getWithMetadata: async <T>() => ({ value: getResult as T, metadata: null }),
    } as unknown as KVNamespace;
}

/** A KVNamespace backed by an in-memory Map — supports full read/write/list operations. */
export function makeInMemoryKv(initial: Map<string, string> = new Map()): KVNamespace {
    const store = new Map<string, string>(initial);
    return {
        async put(key: string, value: string) {
            store.set(key, value);
        },
        async get<T>(key: string, type?: string): Promise<T | null> {
            const raw = store.get(key);
            if (raw === undefined) return null;
            if (type === 'json') return JSON.parse(raw) as T;
            return raw as unknown as T;
        },
        async delete(key: string) {
            store.delete(key);
        },
        async list({ prefix, limit: _limit }: { prefix?: string; limit?: number; cursor?: string } = {}) {
            const keys = [...store.keys()]
                .filter((k) => !prefix || k.startsWith(prefix))
                .map((name) => ({ name }));
            return { keys, list_complete: true, cursor: '' };
        },
        getWithMetadata: async <T>(key: string, type?: string) => {
            const raw = store.get(key);
            if (raw === undefined) return { value: null as T, metadata: null };
            if (type === 'json') return { value: JSON.parse(raw) as T, metadata: null };
            return { value: raw as unknown as T, metadata: null };
        },
    } as unknown as KVNamespace;
}

/** A KVNamespace stub that throws on every operation (simulates a KV outage). */
export function makeFailingKv(): KVNamespace {
    const fail = async () => {
        throw new Error('KV error');
    };
    return {
        list: fail,
        get: fail,
        put: fail,
        delete: fail,
        getWithMetadata: fail,
    } as unknown as KVNamespace;
}

// ============================================================================
// D1Database stub
// ============================================================================

/** A D1Database stub that succeeds on a `SELECT 1` health probe. */
export function makeDb(): D1Database {
    return {
        prepare: (_sql: string) => ({
            first: async () => ({ '1': 1 }),
            bind: () => ({ first: async () => ({ '1': 1 }) }),
        }),
    } as unknown as D1Database;
}

// ============================================================================
// Env factory
// ============================================================================

/**
 * Returns a minimal Env with sensible defaults.
 * Override any binding by passing it in `overrides`.
 *
 * @example
 * const env = makeEnv({ JWT_SECRET: 'my-secret', DB: makeDb() });
 */
export function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: makeKv(),
        RATE_LIMIT: makeKv(),
        METRICS: makeKv(),
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

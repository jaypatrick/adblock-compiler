/**
 * Tests for the metrics recording and retrieval functions.
 *
 * Covers:
 *   - recordMetric: stores a new metric to KV on first call
 *   - recordMetric: increments count and totalDuration on subsequent calls
 *   - recordMetric: tracks success/failure split and error map
 *   - recordMetric: silently swallows KV errors (no throw)
 *   - getMetrics: returns empty endpoints when KV has no data
 *   - getMetrics: aggregates data found in the current time window
 *   - handleMetrics: returns 200 JSON with window/endpoints fields
 *   - handleMetrics: sets Cache-Control: no-cache header
 *
 * @see worker/handlers/metrics.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { recordMetric, getMetrics, handleMetrics } from './metrics.ts';
import { WORKER_DEFAULTS } from '../../src/config/defaults.ts';
import type { Env, EndpointMetrics } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

/** KVNamespace backed by a plain Map. Supports get(key, 'json') format. */
function makeTrackedKv(initial: Map<string, string> = new Map()) {
    const store = new Map<string, string>(initial);
    const kv = {
        store,
        list: async () => ({ keys: [], list_complete: true, cursor: '' }),
        get: async (key: string, format?: string) => {
            const val = store.get(key);
            if (val === undefined || val === null) return null;
            return format === 'json' ? JSON.parse(val) : val;
        },
        put: async (key: string, value: string) => { store.set(key, value); },
        delete: async (key: string) => { store.delete(key); },
        getWithMetadata: async (key: string) => ({
            value: store.has(key) ? JSON.parse(store.get(key)!) : null,
            metadata: null,
        }),
    } as unknown as KVNamespace & { store: Map<string, string> };
    return kv;
}

/** KVNamespace stub that throws on every call. */
function makeFailingKv(): KVNamespace {
    const fail = async () => { throw new Error('KV error'); };
    return { list: fail, get: fail, put: fail, delete: fail, getWithMetadata: fail } as unknown as KVNamespace;
}

/** KVNamespace stub that returns the given value for every get(). */
function makeKv(getResult: unknown = null): KVNamespace {
    return {
        list: async () => ({ keys: [], list_complete: true, cursor: '' }),
        get: async <T>() => getResult as T,
        put: async () => {},
        delete: async () => {},
        getWithMetadata: async <T>() => ({ value: getResult as T, metadata: null }),
    } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        METRICS: makeKv(),
        ...overrides,
    } as unknown as Env;
}

/** Compute the current metrics window key (matches handler logic). */
function currentWindowKey(): number {
    return Math.floor(Date.now() / (WORKER_DEFAULTS.METRICS_WINDOW_SECONDS * 1000));
}

// ============================================================================
// recordMetric
// ============================================================================

Deno.test('recordMetric - stores a new metric entry to KV on first call', async () => {
    const tracked = makeTrackedKv();
    const env = makeEnv({ METRICS: tracked });

    const wk = currentWindowKey();
    await recordMetric(env, '/compile', 100, true);

    const stored = tracked.store.get(`metrics:${wk}:/compile`);
    assertExists(stored);
    const parsed = JSON.parse(stored) as EndpointMetrics;
    assertEquals(parsed.count, 1);
    assertEquals(parsed.success, 1);
    assertEquals(parsed.failed, 0);
    assertEquals(parsed.totalDuration, 100);
});

Deno.test('recordMetric - increments count and totalDuration on second call', async () => {
    const tracked = makeTrackedKv();
    const env = makeEnv({ METRICS: tracked });

    await recordMetric(env, '/compile', 80, true);
    await recordMetric(env, '/compile', 60, true);

    const wk = currentWindowKey();
    const stored = tracked.store.get(`metrics:${wk}:/compile`);
    assertExists(stored);
    const parsed = JSON.parse(stored) as EndpointMetrics;
    assertEquals(parsed.count, 2);
    assertEquals(parsed.totalDuration, 140);
    assertEquals(parsed.success, 2);
});

Deno.test('recordMetric - tracks failure count and error map', async () => {
    const tracked = makeTrackedKv();
    const env = makeEnv({ METRICS: tracked });

    await recordMetric(env, '/compile', 200, false, 'timeout');
    await recordMetric(env, '/compile', 150, false, 'timeout');
    await recordMetric(env, '/compile', 50, true);

    const wk = currentWindowKey();
    const stored = tracked.store.get(`metrics:${wk}:/compile`);
    assertExists(stored);
    const parsed = JSON.parse(stored) as EndpointMetrics;
    assertEquals(parsed.count, 3);
    assertEquals(parsed.failed, 2);
    assertEquals(parsed.success, 1);
    assertEquals(parsed.errors['timeout'], 2);
});

Deno.test('recordMetric - silently swallows KV errors without throwing', async () => {
    const env = makeEnv({ METRICS: makeFailingKv() });
    // Must not throw
    await recordMetric(env, '/compile', 100, true);
});

// ============================================================================
// getMetrics
// ============================================================================

Deno.test('getMetrics - returns empty endpoints object when KV has no data', async () => {
    const env = makeEnv({ METRICS: makeKv(null) });
    const result = await getMetrics(env);
    assertEquals(result.window, '30 minutes');
    assertExists(result.timestamp);
    assertEquals(Object.keys(result.endpoints).length, 0);
});

Deno.test('getMetrics - aggregates data found in the current time window', async () => {
    const wk = currentWindowKey();
    const metricData: EndpointMetrics = {
        count: 5,
        success: 4,
        failed: 1,
        totalDuration: 500,
        errors: { 'timeout': 1 },
    };
    const initial = new Map<string, string>([
        [`metrics:${wk}:/compile`, JSON.stringify(metricData)],
    ]);
    const tracked = makeTrackedKv(initial);
    const env = makeEnv({ METRICS: tracked });

    const result = await getMetrics(env);
    assertExists(result.endpoints['/compile']);
    assertEquals(result.endpoints['/compile'].count, 5);
    assertEquals(result.endpoints['/compile'].success, 4);
    assertEquals(result.endpoints['/compile'].failed, 1);
});

// ============================================================================
// handleMetrics
// ============================================================================

Deno.test('handleMetrics - returns 200 JSON with window and endpoints fields', async () => {
    const env = makeEnv({ METRICS: makeKv(null) });
    const res = await handleMetrics(env);
    assertEquals(res.status, 200);
    const body = await res.json() as { window: string; endpoints: Record<string, unknown> };
    assertEquals(body.window, '30 minutes');
    assertExists(body.endpoints);
});

Deno.test('handleMetrics - sets Cache-Control: no-cache header', async () => {
    const env = makeEnv({ METRICS: makeKv(null) });
    const res = await handleMetrics(env);
    assertEquals(res.headers.get('Cache-Control'), 'no-cache');
});

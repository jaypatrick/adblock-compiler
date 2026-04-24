/**
 * Tests for RateLimiterDO Durable Object.
 *
 * Covers:
 *  - First request starts a new window (allowed=true, remaining=limit-1)
 *  - Requests within the window decrement remaining
 *  - Reaching the limit returns allowed=false
 *  - /status returns window state
 *  - /reset clears the counter
 *  - alarm() resets the counter
 *  - Invalid request body → 400
 *  - Unknown path → 404
 */

import { assertEquals, assertExists } from '@std/assert';
import { RateLimiterDO } from './rate-limiter-do.ts';
import type { RateLimitResult } from './rate-limiter-do.ts';

// ============================================================================
// Mock DurableObjectState
// ============================================================================

function createMockState(): DurableObjectState {
    const store = new Map<string, unknown>();
    let alarmTime: number | null = null;

    const storage: DurableObjectStorage = {
        get: async <T>(key: string | string[]) => {
            if (Array.isArray(key)) {
                const result = new Map<string, T>();
                for (const k of key) {
                    const v = store.get(k);
                    if (v !== undefined) result.set(k, v as T);
                }
                return result as unknown as T;
            }
            return store.get(key) as T | undefined;
        },
        put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
            if (typeof keyOrEntries === 'string') {
                store.set(keyOrEntries, value);
            } else {
                for (const [k, v] of Object.entries(keyOrEntries)) {
                    store.set(k, v);
                }
            }
        },
        delete: async (key: string | string[]) => {
            if (Array.isArray(key)) {
                let deleted = 0;
                for (const k of key) {
                    if (store.delete(k)) deleted++;
                }
                return deleted;
            }
            return store.delete(key);
        },
        deleteAll: async () => {
            store.clear();
        },
        list: async <T>(opts?: { prefix?: string; start?: string; end?: string; reverse?: boolean; limit?: number }) => {
            const result = new Map<string, T>();
            for (const [k, v] of store.entries()) {
                if (!opts?.prefix || k.startsWith(opts.prefix)) {
                    result.set(k, v as T);
                }
            }
            return result;
        },
        getAlarm: async () => alarmTime,
        setAlarm: async (time: number | Date) => {
            alarmTime = typeof time === 'number' ? time : time.getTime();
        },
        deleteAlarm: async () => {
            alarmTime = null;
        },
        sync: async () => {},
        transaction: () => {},
        transactionAsync: async (fn: () => Promise<unknown>) => await fn(),
        getCurrentTags: () => [],
        setCurrentTags: () => {},
    } as unknown as DurableObjectStorage;

    return {
        id: {
            toString: () => 'rate-limiter-test-id',
            equals: () => false,
            name: 'rate-limiter-test',
        },
        storage,
        props: {},
        blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
        waitUntil: () => {},
        acceptWebSocket: () => {},
        getWebSockets: () => [],
        getTags: () => [],
        setWebSocketAutoResponse: () => {},
        getWebSocketAutoResponse: () => null,
        getWebSocketAutoResponseTimestamp: () => null,
        setHibernatableWebSocketEventTimeout: () => {},
        getHibernatableWebSocketEventTimeout: () => null,
        abort: () => {},
        facets: {
            get: (): never => {
                throw new Error('facets.get not implemented');
            },
            abort: (_name: string) => {},
            delete: (_name: string) => {},
        } as unknown as DurableObjectFacets,
    } as DurableObjectState;
}

function postIncrement(do_: RateLimiterDO, maxRequests: number, windowSeconds = 60): Promise<Response> {
    return do_.fetch(
        new Request('https://do/increment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxRequests, windowSeconds }),
        }),
    );
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('RateLimiterDO - first request allowed with correct remaining', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    const res = await postIncrement(do_, 5);
    assertEquals(res.status, 200);

    const data = await res.json() as RateLimitResult;
    assertEquals(data.allowed, true);
    assertEquals(data.limit, 5);
    assertEquals(data.remaining, 4);
    assertExists(data.resetAt);
});

Deno.test('RateLimiterDO - second request decrements remaining', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    await postIncrement(do_, 5);
    const res = await postIncrement(do_, 5);

    const data = await res.json() as RateLimitResult;
    assertEquals(data.allowed, true);
    assertEquals(data.remaining, 3);
});

Deno.test('RateLimiterDO - reaching limit blocks further requests', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    for (let i = 0; i < 3; i++) {
        await postIncrement(do_, 3);
    }

    // 4th request should be blocked
    const res = await postIncrement(do_, 3);
    const data = await res.json() as RateLimitResult;
    assertEquals(data.allowed, false);
    assertEquals(data.remaining, 0);
});

Deno.test('RateLimiterDO - /status returns current window state', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    // Initial status — no window active
    const statusRes1 = await do_.fetch(new Request('https://do/status'));
    assertEquals(statusRes1.status, 200);
    const status1 = await statusRes1.json() as {
        count: number;
        limit: number;
        resetAt: number;
        remaining: number;
        windowExpired: boolean;
    };
    assertEquals(status1.count, 0);
    assertEquals(status1.windowExpired, true);

    // After one increment
    await postIncrement(do_, 10);

    const statusRes2 = await do_.fetch(new Request('https://do/status'));
    const status2 = await statusRes2.json() as { count: number; remaining: number; windowExpired: boolean };
    assertEquals(status2.count, 1);
    assertEquals(status2.remaining, 9);
    assertEquals(status2.windowExpired, false);
});

Deno.test('RateLimiterDO - /reset clears the counter', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    // Send 5 requests
    for (let i = 0; i < 5; i++) {
        await postIncrement(do_, 10);
    }

    // Reset
    const resetRes = await do_.fetch(new Request('https://do/reset', { method: 'POST' }));
    assertEquals(resetRes.status, 200);
    const resetData = await resetRes.json() as { success: boolean };
    assertEquals(resetData.success, true);

    // Status should show empty window
    const statusRes = await do_.fetch(new Request('https://do/status'));
    const status = await statusRes.json() as { count: number; windowExpired: boolean };
    assertEquals(status.count, 0);
    assertEquals(status.windowExpired, true);
});

Deno.test('RateLimiterDO - alarm() resets the counter', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    await postIncrement(do_, 5);
    await postIncrement(do_, 5);

    // Fire the alarm (simulates window expiry)
    await do_.alarm();

    // Next request should be the first in a new window
    const res = await postIncrement(do_, 5);
    const data = await res.json() as RateLimitResult;
    assertEquals(data.allowed, true);
    assertEquals(data.remaining, 4);
});

Deno.test('RateLimiterDO - /increment with invalid body returns 400', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    const res = await do_.fetch(
        new Request('https://do/increment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxRequests: -1, windowSeconds: 60 }),
        }),
    );
    assertEquals(res.status, 400);
});

Deno.test('RateLimiterDO - /increment with malformed JSON returns 400', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    const res = await do_.fetch(
        new Request('https://do/increment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not-json{',
        }),
    );
    assertEquals(res.status, 400);
    const data = await res.json() as { success: boolean; error: string };
    assertEquals(data.success, false);
});

Deno.test('RateLimiterDO - unknown path returns 404', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    const res = await do_.fetch(new Request('https://do/unknown'));
    assertEquals(res.status, 404);
});

Deno.test('RateLimiterDO - alarm() handles storage.deleteAll failures gracefully', async () => {
    // Regression: before the try/catch fix, a transient storage error propagated
    // as an unhandled rejection and CF Workers recorded the alarm timestamp as
    // the error message (outcome: "exception", message: "<DATETIME>").
    const state = createMockState();

    // Simulate a transient DO storage failure on deleteAll
    (state.storage as unknown as Record<string, unknown>).deleteAll = async () => {
        throw new Error('Transient storage failure');
    };

    const do_ = new RateLimiterDO(state, {});
    await postIncrement(do_, 5);

    // alarm() must resolve — not throw — even when storage.deleteAll() rejects
    await do_.alarm();
});

Deno.test('RateLimiterDO - resetAt is set and persisted across increments', async () => {
    const state = createMockState();
    const do_ = new RateLimiterDO(state, {});

    const res1 = await postIncrement(do_, 10, 60);
    const data1 = await res1.json() as RateLimitResult;
    const resetAt = data1.resetAt;

    const res2 = await postIncrement(do_, 10, 60);
    const data2 = await res2.json() as RateLimitResult;

    // resetAt should be the same across requests in the same window
    assertEquals(data2.resetAt, resetAt);
});

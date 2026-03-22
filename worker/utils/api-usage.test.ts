/**
 * Tests for Per-User API Usage Tracking.
 *
 * Covers:
 *   - trackApiUsage: skips anonymous, skips when RATE_LIMIT undefined, increments daily, increments total
 *   - getUserApiUsage: returns null when no data, returns total and daily data
 *
 * @see worker/utils/api-usage.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { type DailyUsageBucket, getUserApiUsage, type TotalUsageBucket, trackApiUsage } from './api-usage.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAuthContext(userId: string | null = 'user-001'): IAuthContext {
    return {
        userId,
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
}

function makeAnonContext(): IAuthContext {
    return {
        userId: null,
        tier: UserTier.Anonymous,
        role: 'anonymous',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'anonymous',
    };
}

function createMockKv() {
    const store = new Map<string, string>();
    const kv = {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string, _options?: { expirationTtl?: number }) => {
            store.set(key, value);
        },
        _store: store,
    };
    return kv as unknown as KVNamespace & { _store: Map<string, string> };
}

function makeEnv(kv?: KVNamespace): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: kv ?? (undefined as unknown as KVNamespace),
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
    };
}

// ============================================================================
// trackApiUsage
// ============================================================================

Deno.test('trackApiUsage - skips anonymous user (no userId)', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv as unknown as KVNamespace);
    const ctx = makeAnonContext();

    await trackApiUsage(ctx, '/compile', 'POST', env);

    // Nothing should be written
    assertEquals(kv._store.size, 0);
});

Deno.test('trackApiUsage - skips when RATE_LIMIT is undefined', async () => {
    const env = makeEnv(undefined);
    const ctx = makeAuthContext('user-123');

    // Should not throw
    await trackApiUsage(ctx, '/compile', 'POST', env);
});

Deno.test('trackApiUsage - increments daily bucket on first call', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv as unknown as KVNamespace);
    const ctx = makeAuthContext('user-abc');

    await trackApiUsage(ctx, '/compile', 'POST', env);

    // Find the daily key
    let dailyBucket: DailyUsageBucket | null = null;
    for (const [key, val] of kv._store) {
        if (key.includes('day:')) {
            dailyBucket = JSON.parse(val) as DailyUsageBucket;
            assertEquals(key.startsWith('usage:user:user-abc:day:'), true);
        }
    }
    assertExists(dailyBucket);
    assertEquals(dailyBucket!.count, 1);
    assertEquals(dailyBucket!.routes['/compile'], 1);
});

Deno.test('trackApiUsage - increments total bucket', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv as unknown as KVNamespace);
    const ctx = makeAuthContext('user-total');

    await trackApiUsage(ctx, '/validate', 'GET', env);

    const totalRaw = kv._store.get('usage:user:user-total:total');
    assertExists(totalRaw);
    const total = JSON.parse(totalRaw) as TotalUsageBucket;
    assertEquals(total.count, 1);
    assertEquals(typeof total.firstSeen, 'string');
    assertEquals(typeof total.lastSeen, 'string');
});

Deno.test('trackApiUsage - accumulates on multiple calls', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv as unknown as KVNamespace);
    const ctx = makeAuthContext('user-multi');

    await trackApiUsage(ctx, '/compile', 'POST', env);
    await trackApiUsage(ctx, '/compile', 'POST', env);
    await trackApiUsage(ctx, '/validate', 'GET', env);

    const totalRaw = kv._store.get('usage:user:user-multi:total');
    assertExists(totalRaw);
    const total = JSON.parse(totalRaw) as TotalUsageBucket;
    assertEquals(total.count, 3);

    // Find daily bucket
    for (const [key, val] of kv._store) {
        if (key.includes('day:')) {
            const daily = JSON.parse(val) as DailyUsageBucket;
            assertEquals(daily.count, 3);
            assertEquals(daily.routes['/compile'], 2);
            assertEquals(daily.routes['/validate'], 1);
        }
    }
});

// ============================================================================
// getUserApiUsage
// ============================================================================

Deno.test('getUserApiUsage - returns null total when no data exists', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv as unknown as KVNamespace);

    const result = await getUserApiUsage('user-empty', env, 7);
    assertEquals(result.total, null);
    assertEquals(result.days.length, 0);
});

Deno.test('getUserApiUsage - returns null when RATE_LIMIT not configured', async () => {
    const env = makeEnv(undefined);

    const result = await getUserApiUsage('user-001', env);
    assertEquals(result.total, null);
    assertEquals(result.days.length, 0);
});

Deno.test('getUserApiUsage - returns total and days correctly', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv as unknown as KVNamespace);
    const ctx = makeAuthContext('user-query');

    // Track some usage
    await trackApiUsage(ctx, '/compile', 'POST', env);
    await trackApiUsage(ctx, '/validate', 'GET', env);

    const result = await getUserApiUsage('user-query', env, 7);

    assertExists(result.total);
    assertEquals(result.total!.count, 2);
    assertEquals(result.days.length, 1); // only today has data
    assertEquals(result.days[0].count, 2);
    assertEquals(result.days[0].routes['/compile'], 1);
    assertEquals(result.days[0].routes['/validate'], 1);
});

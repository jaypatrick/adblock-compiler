/**
 * Tests for Admin API Usage Query Handler.
 *
 * Covers:
 *   - Returns 403 for non-admin user
 *   - Returns usage data for admin user
 *   - Handles no usage data (empty response)
 *   - Respects lookbackDays query param
 *
 * @see worker/handlers/admin-usage.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleAdminGetUserUsage } from './admin-usage.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAdminContext(): IAuthContext {
    return {
        userId: 'admin-001',
        tier: UserTier.Admin,
        role: 'admin',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
}

function makeUserContext(): IAuthContext {
    return {
        userId: 'user-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
}

function createMockKv(data: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(data));
    return {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
            store.set(key, value);
        },
    } as unknown as KVNamespace;
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
// Tests
// ============================================================================

Deno.test('handleAdminGetUserUsage - 403 for non-admin user', async () => {
    const req = new Request('http://localhost/admin/usage/user-001');
    const env = makeEnv();

    const res = await handleAdminGetUserUsage(req, env, makeUserContext(), 'user-001');
    assertEquals(res.status, 403);
});

Deno.test('handleAdminGetUserUsage - 200 with empty usage for admin', async () => {
    const kv = createMockKv(); // empty KV
    const env = makeEnv(kv);
    const req = new Request('http://localhost/admin/usage/user-001');

    const res = await handleAdminGetUserUsage(req, env, makeAdminContext(), 'user-001');
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals(body.userId, 'user-001');
    assertEquals(body.total, null);
    assertEquals((body.days as unknown[]).length, 0);
    assertEquals(body.lookbackDays, 30);
});

Deno.test('handleAdminGetUserUsage - 200 with usage data for admin', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const kv = createMockKv({
        [`usage:user:user-002:total`]: JSON.stringify({ count: 42, firstSeen: '2024-01-01', lastSeen: today }),
        [`usage:user:user-002:day:${today}`]: JSON.stringify({ count: 5, routes: { '/compile': 5 } }),
    });
    const env = makeEnv(kv);
    const req = new Request('http://localhost/admin/usage/user-002');

    const res = await handleAdminGetUserUsage(req, env, makeAdminContext(), 'user-002');
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertExists(body.total);
    assertEquals((body.total as Record<string, unknown>).count, 42);
    assertEquals((body.days as unknown[]).length, 1);
});

Deno.test('handleAdminGetUserUsage - respects lookbackDays query param', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv);
    const req = new Request('http://localhost/admin/usage/user-001?days=7');

    const res = await handleAdminGetUserUsage(req, env, makeAdminContext(), 'user-001');
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.lookbackDays, 7);
});

Deno.test('handleAdminGetUserUsage - clamps lookbackDays to maximum of 90', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv);
    const req = new Request('http://localhost/admin/usage/user-001?days=999');

    const res = await handleAdminGetUserUsage(req, env, makeAdminContext(), 'user-001');
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.lookbackDays, 90);
});

Deno.test('handleAdminGetUserUsage - clamps lookbackDays to minimum of 1', async () => {
    const kv = createMockKv();
    const env = makeEnv(kv);
    const req = new Request('http://localhost/admin/usage/user-001?days=0');

    const res = await handleAdminGetUserUsage(req, env, makeAdminContext(), 'user-001');
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.lookbackDays, 1);
});

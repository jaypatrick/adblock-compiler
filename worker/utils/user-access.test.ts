/**
 * Tests for Per-User API Access Control.
 *
 * Covers:
 *   - Anonymous user → null (allowed)
 *   - User not in DB → null (allowed)
 *   - api_disabled = 0 → null (allowed)
 *   - api_disabled = 1 → 403 Response
 *   - DB not configured → null (allowed)
 *
 * @see worker/utils/user-access.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { checkUserApiAccess } from './user-access.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAuthContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user-001',
        clerkUserId: 'clerk-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'local-jwt',
        ...overrides,
    };
}

function makeAnonContext(): IAuthContext {
    return {
        userId: null,
        clerkUserId: null,
        tier: UserTier.Anonymous,
        role: 'anonymous',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'anonymous',
    };
}

function makeEnvWithDb(apiDisabled: number | null): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        DB: {
            prepare: (_sql: string) => ({
                bind: (..._args: unknown[]) => ({
                    first: async <T>() => {
                        if (apiDisabled === null) return null;
                        return { api_disabled: apiDisabled } as T;
                    },
                }),
            }),
        } as unknown as D1Database,
    };
}

function makeEnvNoDb(): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
    };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('checkUserApiAccess - anonymous user returns null (allowed)', async () => {
    const ctx = makeAnonContext();
    const env = makeEnvWithDb(1); // even if DB says disabled
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - user not in DB returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvWithDb(null); // DB returns null row
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - api_disabled = 0 returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvWithDb(0);
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - api_disabled = 1 returns 403 Response', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvWithDb(1);
    const result = await checkUserApiAccess(ctx, env);
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(typeof body.error, 'string');
});

Deno.test('checkUserApiAccess - DB not configured returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvNoDb();
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - DB error returns null (fail-open)', async () => {
    const ctx = makeAuthContext();
    const env = {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        DB: {
            prepare: () => ({
                bind: () => ({
                    first: async () => {
                        throw new Error('DB connection error');
                    },
                }),
            }),
        } as unknown as D1Database,
    };
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null); // fail-open
});

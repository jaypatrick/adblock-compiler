/**
 * Tests for Per-User API Access Control (Better Auth banned check).
 *
 * Covers:
 *   - Anonymous user → null (allowed)
 *   - User not in DB → null (allowed)
 *   - banned = 0 → null (allowed)
 *   - banned = 1 → 403 Response
 *   - banned = 1 with banReason → 403 with reason in message
 *   - DB not configured → null (allowed)
 *   - DB error → null (fail-open)
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
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
        ...overrides,
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

function makeEnvWithDb(banned: number | null, banReason: string | null = null): Env {
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
                        if (banned === null) return null;
                        return { banned, banReason } as T;
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
    const env = makeEnvWithDb(1); // even if DB says banned
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - user not in DB returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvWithDb(null); // DB returns null row
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - banned = 0 returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvWithDb(0);
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - banned = 1 returns 403 Response', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvWithDb(1);
    const result = await checkUserApiAccess(ctx, env);
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(typeof body.error, 'string');
});

Deno.test('checkUserApiAccess - banned = 1 with banReason includes reason in message', async () => {
    const ctx = makeAuthContext();
    const env = makeEnvWithDb(1, 'Spam');
    const result = await checkUserApiAccess(ctx, env);
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as Record<string, unknown>;
    assertEquals((body.error as string).includes('Spam'), true);
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

Deno.test('checkUserApiAccess - api-key authMethod returns null (skipped)', async () => {
    const ctx = makeAuthContext({ authMethod: 'api-key' });
    const env = makeEnvWithDb(1); // banned in DB, but should be skipped
    const result = await checkUserApiAccess(ctx, env);
    assertEquals(result, null);
});

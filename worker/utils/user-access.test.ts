/**
 * Tests for Per-User API Access Control (Better Auth banned check).
 *
 * Covers:
 *   - Anonymous user → null (allowed)
 *   - User not in DB → null (allowed)
 *   - banned = false → null (allowed)
 *   - banned = true → 403 Response
 *   - banned = true with banReason → 403 with reason in message
 *   - Prisma not configured → null (allowed, fail-open)
 *   - Prisma error → null (fail-open)
 *
 * @see worker/utils/user-access.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { checkUserApiAccess } from './user-access.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';
import type { PrismaClientExtended } from '../lib/prisma.ts';

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

function makeEnv(): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
    };
}

/**
 * Creates a minimal Prisma mock that responds to `user.findUnique`.
 * Pass `null` for `banned` to simulate a user not found in the database.
 */
function makePrismaMock(banned: boolean | null, banReason: string | null = null): PrismaClientExtended {
    return {
        user: {
            findUnique: async () => {
                if (banned === null) return null;
                return { banned, banReason };
            },
        },
    } as unknown as PrismaClientExtended;
}

function makePrismaErrorMock(): PrismaClientExtended {
    return {
        user: {
            findUnique: async () => {
                throw new Error('DB connection error');
            },
        },
    } as unknown as PrismaClientExtended;
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('checkUserApiAccess - anonymous user returns null (allowed)', async () => {
    const ctx = makeAnonContext();
    const result = await checkUserApiAccess(ctx, makeEnv(), makePrismaMock(true)); // even if DB says banned
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - user not in DB returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const result = await checkUserApiAccess(ctx, makeEnv(), makePrismaMock(null)); // DB returns null row
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - banned = false returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const result = await checkUserApiAccess(ctx, makeEnv(), makePrismaMock(false));
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - banned = true returns 403 Response', async () => {
    const ctx = makeAuthContext();
    const result = await checkUserApiAccess(ctx, makeEnv(), makePrismaMock(true));
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(typeof body.error, 'string');
});

Deno.test('checkUserApiAccess - banned = true with banReason includes reason in message', async () => {
    const ctx = makeAuthContext();
    const result = await checkUserApiAccess(ctx, makeEnv(), makePrismaMock(true, 'Spam'));
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as Record<string, unknown>;
    assertEquals((body.error as string).includes('Spam'), true);
});

Deno.test('checkUserApiAccess - Prisma not configured returns null (allowed)', async () => {
    const ctx = makeAuthContext();
    const result = await checkUserApiAccess(ctx, makeEnv(), null);
    assertEquals(result, null);
});

Deno.test('checkUserApiAccess - Prisma error returns null (fail-open)', async () => {
    const ctx = makeAuthContext();
    const result = await checkUserApiAccess(ctx, makeEnv(), makePrismaErrorMock());
    assertEquals(result, null); // fail-open
});

Deno.test('checkUserApiAccess - api-key authMethod returns null (skipped)', async () => {
    const ctx = makeAuthContext({ authMethod: 'api-key' });
    const result = await checkUserApiAccess(ctx, makeEnv(), makePrismaMock(true)); // banned in DB, but should be skipped
    assertEquals(result, null);
});

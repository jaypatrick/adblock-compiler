/**
 * Tests for API Key Management Handlers.
 *
 * Covers:
 *   - POST   /api/keys       (handleCreateApiKey)
 *   - GET    /api/keys       (handleListApiKeys)
 *   - DELETE /api/keys/:id   (handleRevokeApiKey)
 *   - PATCH  /api/keys/:id   (handleUpdateApiKey)
 *
 * Uses an in-memory Prisma mock object (no real database).
 */

import { assertEquals } from '@std/assert';
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey, handleUpdateApiKey } from './api-keys.ts';
import { UserTier } from '../types.ts';
import type { IAuthContext } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAuthContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user-uuid-001',
        tier: UserTier.Pro,
        role: 'user',
        apiKeyId: null,
        sessionId: 'sess_001',
        scopes: ['compile', 'rules'],
        authMethod: 'better-auth',
        ...overrides,
    };
}

// ============================================================================
// In-memory Prisma mock for api-keys handlers
// ============================================================================

interface StoredKey {
    id: string;
    userId: string;
    keyHash: string;
    keyPrefix: string;
    name: string;
    scopes: string[];
    rateLimitPerMinute: number;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

// deno-lint-ignore no-explicit-any
function createPrismaMock(): any {
    const store: StoredKey[] = [];

    return {
        apiKey: {
            async count({ where }: { where: { userId: string; revokedAt: null | undefined } }) {
                return store.filter((k) => k.userId === where.userId && k.revokedAt === null).length;
            },

            async create({ data }: { data: Omit<StoredKey, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'revokedAt'> }) {
                const now = new Date();
                const row: StoredKey = {
                    id: crypto.randomUUID(),
                    userId: data.userId,
                    keyHash: data.keyHash,
                    keyPrefix: data.keyPrefix,
                    name: data.name,
                    scopes: data.scopes,
                    rateLimitPerMinute: data.rateLimitPerMinute ?? 60,
                    lastUsedAt: null,
                    expiresAt: data.expiresAt ?? null,
                    revokedAt: null,
                    createdAt: now,
                    updatedAt: now,
                };
                store.push(row);
                return row;
            },

            async findMany({ where, orderBy }: { where: { userId: string }; orderBy?: { createdAt: string } }) {
                let rows = store.filter((k) => k.userId === where.userId);
                if (orderBy?.createdAt === 'desc') {
                    rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                }
                return rows;
            },

            async updateMany({ where, data }: {
                where: { id: string; userId: string; revokedAt: null };
                data: Partial<StoredKey>;
            }) {
                const row = store.find((k) =>
                    k.id === where.id &&
                    k.userId === where.userId &&
                    k.revokedAt === null
                );
                if (!row) return { count: 0 };
                Object.assign(row, data, { updatedAt: new Date() });
                return { count: 1 };
            },

            async findUnique({ where, select }: {
                where: { id: string };
                select?: Record<string, boolean>;
            }) {
                const row = store.find((k) => k.id === where.id);
                if (!row) return null;
                if (!select) return row;
                // deno-lint-ignore no-explicit-any
                const result: any = {};
                for (const key of Object.keys(select)) {
                    // deno-lint-ignore no-explicit-any
                    if (select[key]) result[key] = (row as any)[key];
                }
                return result;
            },
        },
    };
}

// ============================================================================
// handleCreateApiKey
// ============================================================================

Deno.test('handleCreateApiKey - creates key with valid name', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'My API Key' }, makeAuthContext(), prisma);
    assertEquals(res.status, 201);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals(body.name, 'My API Key');
    assertEquals(typeof body.key, 'string');
    assertEquals((body.key as string).startsWith('abc_'), true);
    assertEquals(body.scopes, ['compile']); // default scopes
});

Deno.test('handleCreateApiKey - creates key with custom scopes', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'Admin Key', scopes: ['compile', 'rules', 'admin'] }, makeAuthContext(), prisma);
    assertEquals(res.status, 201);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.scopes, ['compile', 'rules', 'admin']);
});

Deno.test('handleCreateApiKey - creates key with expiry', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'Temp Key', expiresInDays: 30 }, makeAuthContext(), prisma);
    assertEquals(res.status, 201);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.expiresAt !== null, true);
});

Deno.test('handleCreateApiKey - rejects empty name', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: '' }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleCreateApiKey - rejects name exceeding 100 characters', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'x'.repeat(101) }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleCreateApiKey - rejects invalid scopes', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'Bad Scopes', scopes: ['compile', 'hacker'] }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleCreateApiKey - rejects expiresInDays < 1', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'Bad Expiry', expiresInDays: 0 }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleCreateApiKey - rejects expiresInDays > 365', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'Bad Expiry', expiresInDays: 400 }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleCreateApiKey - rejects non-object body', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey('not json', makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleCreateApiKey - enforces per-user key limit', async () => {
    // Mock that always returns 25 for count
    // deno-lint-ignore no-explicit-any
    const prisma: any = {
        apiKey: {
            count: async () => 25,
            create: async () => {
                throw new Error('should not create');
            },
            findMany: async () => [],
            updateMany: async () => {
                throw new Error('should not update');
            },
        },
    };

    const res = await handleCreateApiKey({ name: 'Over Limit' }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assertEquals((body.error as string).includes('25'), true);
});

Deno.test('handleCreateApiKey - returns 503 when prisma is null', async () => {
    const res = await handleCreateApiKey({ name: 'Test' }, makeAuthContext(), null);
    assertEquals(res.status, 503);
});

Deno.test('handleCreateApiKey - rejects request when auth context has no userId', async () => {
    const prisma = createPrismaMock();

    const res = await handleCreateApiKey({ name: 'No User' }, makeAuthContext({ userId: null }), prisma);
    assertEquals(res.status, 403);
});

// ============================================================================
// handleListApiKeys
// ============================================================================

Deno.test('handleListApiKeys - returns empty array for user with no keys', async () => {
    const prisma = createPrismaMock();
    const res = await handleListApiKeys(makeAuthContext(), prisma);

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals((body.keys as unknown[]).length, 0);
    assertEquals(body.total, 0);
});

Deno.test('handleListApiKeys - returns keys created by the user', async () => {
    const prisma = createPrismaMock();
    const ctx = makeAuthContext();

    // Create two keys
    for (const name of ['Key A', 'Key B']) {
        await handleCreateApiKey({ name }, ctx, prisma);
    }

    const res = await handleListApiKeys(ctx, prisma);
    assertEquals(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.total, 2);
});

Deno.test('handleListApiKeys - does not return keys from other users', async () => {
    const prisma = createPrismaMock();

    // Create a key for user A
    await handleCreateApiKey({ name: 'Key A' }, makeAuthContext({ userId: 'user-A' }), prisma);

    // List for user B should be empty
    const res = await handleListApiKeys(makeAuthContext({ userId: 'user-B' }), prisma);
    assertEquals(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.total, 0);
});

Deno.test('handleListApiKeys - returns 503 when prisma is null', async () => {
    const res = await handleListApiKeys(makeAuthContext(), null);
    assertEquals(res.status, 503);
});

Deno.test('handleListApiKeys - rejects request when auth context has no userId', async () => {
    const prisma = createPrismaMock();
    const res = await handleListApiKeys(makeAuthContext({ userId: null }), prisma);
    assertEquals(res.status, 403);
});

// ============================================================================
// handleRevokeApiKey
// ============================================================================

Deno.test('handleRevokeApiKey - revokes an existing key', async () => {
    const prisma = createPrismaMock();
    const ctx = makeAuthContext();

    // Create a key first
    const createRes = await handleCreateApiKey({ name: 'Temp Key' }, ctx, prisma);
    const createBody = await createRes.json() as Record<string, unknown>;
    const keyId = createBody.id as string;

    // Revoke
    const res = await handleRevokeApiKey(keyId, ctx, prisma);
    assertEquals(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.message, 'API key revoked');
});

Deno.test('handleRevokeApiKey - returns 404 for non-existent key', async () => {
    const prisma = createPrismaMock();
    const res = await handleRevokeApiKey('non-existent-id', makeAuthContext(), prisma);
    assertEquals(res.status, 404);
});

Deno.test("handleRevokeApiKey - prevents revoking another user's key", async () => {
    const prisma = createPrismaMock();

    // Create a key for user A
    const createRes = await handleCreateApiKey({ name: 'User A Key' }, makeAuthContext({ userId: 'user-A' }), prisma);
    const createBody = await createRes.json() as Record<string, unknown>;
    const keyId = createBody.id as string;

    // User B tries to revoke
    const res = await handleRevokeApiKey(keyId, makeAuthContext({ userId: 'user-B' }), prisma);
    assertEquals(res.status, 404);
});

Deno.test('handleRevokeApiKey - returns 503 when prisma is null', async () => {
    const res = await handleRevokeApiKey('key-123', makeAuthContext(), null);
    assertEquals(res.status, 503);
});

Deno.test('handleRevokeApiKey - rejects request when auth context has no userId', async () => {
    const prisma = createPrismaMock();
    const res = await handleRevokeApiKey('key-123', makeAuthContext({ userId: null }), prisma);
    assertEquals(res.status, 403);
});

// ============================================================================
// handleUpdateApiKey
// ============================================================================

Deno.test('handleUpdateApiKey - updates key name', async () => {
    const prisma = createPrismaMock();
    const ctx = makeAuthContext();

    // Create
    const createRes = await handleCreateApiKey({ name: 'Original' }, ctx, prisma);
    const createBody = await createRes.json() as Record<string, unknown>;
    const keyId = createBody.id as string;

    // Update name
    const res = await handleUpdateApiKey(keyId, { name: 'Renamed' }, ctx, prisma);
    assertEquals(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.name, 'Renamed');
});

Deno.test('handleUpdateApiKey - updates key scopes', async () => {
    const prisma = createPrismaMock();
    const ctx = makeAuthContext();

    const createRes = await handleCreateApiKey({ name: 'Scope Test', scopes: ['compile'] }, ctx, prisma);
    const createBody = await createRes.json() as Record<string, unknown>;
    const keyId = createBody.id as string;

    const res = await handleUpdateApiKey(keyId, { scopes: ['compile', 'rules'] }, ctx, prisma);
    assertEquals(res.status, 200);
});

Deno.test('handleUpdateApiKey - rejects empty update body', async () => {
    const prisma = createPrismaMock();

    const res = await handleUpdateApiKey('123', {}, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleUpdateApiKey - rejects invalid scopes in update', async () => {
    const prisma = createPrismaMock();

    const res = await handleUpdateApiKey('123', { scopes: ['invalid'] }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleUpdateApiKey - rejects name exceeding max length', async () => {
    const prisma = createPrismaMock();

    const res = await handleUpdateApiKey('123', { name: 'x'.repeat(101) }, makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleUpdateApiKey - returns 404 for non-existent key', async () => {
    const prisma = createPrismaMock();

    const res = await handleUpdateApiKey('non-existent', { name: 'New Name' }, makeAuthContext(), prisma);
    assertEquals(res.status, 404);
});

Deno.test('handleUpdateApiKey - rejects non-object body', async () => {
    const prisma = createPrismaMock();

    const res = await handleUpdateApiKey('123', 'not json', makeAuthContext(), prisma);
    assertEquals(res.status, 400);
});

Deno.test('handleUpdateApiKey - returns 503 when prisma is null', async () => {
    const res = await handleUpdateApiKey('123', { name: 'Renamed' }, makeAuthContext(), null);
    assertEquals(res.status, 503);
});

Deno.test('handleUpdateApiKey - rejects request when auth context has no userId', async () => {
    const prisma = createPrismaMock();

    const res = await handleUpdateApiKey('123', { name: 'Renamed' }, makeAuthContext({ userId: null }), prisma);
    assertEquals(res.status, 403);
});

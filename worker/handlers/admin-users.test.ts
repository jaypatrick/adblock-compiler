/**
 * Tests for admin user management handlers (Better Auth).
 *
 * Covers:
 *   GET    /admin/users          (handleAdminListUsers)
 *   GET    /admin/users/:id      (handleAdminGetUser)
 *   PATCH  /admin/users/:id      (handleAdminUpdateUser)
 *   DELETE /admin/users/:id      (handleAdminDeleteUser)
 *   POST   /admin/users/:id/ban  (handleAdminBanUser)
 *   POST   /admin/users/:id/unban (handleAdminUnbanUser)
 *
 * Uses in-memory D1 mock and admin auth context — no real network I/O.
 *
 * @see worker/handlers/admin-users.ts
 */

import { assertEquals } from '@std/assert';
import { handleAdminDeleteUser, handleAdminGetUser, handleAdminListUsers, handleAdminUpdateUser, handleAdminBanUser, handleAdminUnbanUser } from './admin-users.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAdminContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'admin-001',
        clerkUserId: 'admin-001',
        tier: UserTier.Admin,
        role: 'admin',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
        ...overrides,
    };
}

function makeUserContext(): IAuthContext {
    return {
        userId: 'user-001',
        clerkUserId: 'user-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
}

// ============================================================================
// In-memory D1 mock (Better Auth `user` table)
// ============================================================================

interface UserRecord {
    id: string;
    email: string;
    name: string | null;
    emailVerified: number;
    image: string | null;
    role: string;
    tier: string;
    banned: number;
    banReason: string | null;
    banExpires: string | null;
    createdAt: string;
    updatedAt: string;
}

function createMockDb(initialUsers: UserRecord[] = []) {
    const users: UserRecord[] = [...initialUsers];
    const sessions: { id: string; userId: string }[] = [];
    const accounts: { id: string; userId: string }[] = [];

    const makeStatement = (sql: string) => {
        let boundValues: unknown[] = [];
        const stmt = {
            bind(...args: unknown[]) {
                boundValues = args;
                return stmt;
            },
            async first<T>(): Promise<T | null> {
                const lower = sql.toLowerCase();
                if (lower.includes('where id =') && lower.includes('"user"')) {
                    const id = boundValues[boundValues.length - 1] as string;
                    return (users.find((u) => u.id === id) ?? null) as T | null;
                }
                if (lower.includes('count(*)')) {
                    return ({ total: users.length }) as T;
                }
                return null;
            },
            async all<T>() {
                const lower = sql.toLowerCase();
                if (lower.includes('select') && lower.includes('"user"')) {
                    const limit = boundValues[boundValues.length - 2] as number ?? 50;
                    const offset = boundValues[boundValues.length - 1] as number ?? 0;
                    return {
                        results: users.slice(offset, offset + limit) as T[],
                        success: true,
                    };
                }
                return { results: [] as T[], success: true };
            },
            async run() {
                const lower = sql.toLowerCase();
                if (lower.includes('update "user"')) {
                    const id = boundValues[boundValues.length - 1] as string;
                    const idx = users.findIndex((u) => u.id === id);
                    if (idx >= 0) {
                        if (lower.includes('banned = 1')) {
                            users[idx].banned = 1;
                        }
                        if (lower.includes('banned = 0')) {
                            users[idx].banned = 0;
                            users[idx].banReason = null;
                            users[idx].banExpires = null;
                        }
                        if (lower.includes('tier = ?')) {
                            let vIdx = 0;
                            users[idx].tier = boundValues[vIdx++] as string;
                            if (lower.includes('role = ?')) {
                                // role comes after tier in SET clause when both present
                            }
                        }
                        if (lower.includes('role = ?') && !lower.includes('tier = ?')) {
                            users[idx].role = boundValues[0] as string;
                        }
                        users[idx].updatedAt = new Date().toISOString();
                        return { success: true, meta: { changes: 1 } };
                    }
                    return { success: true, meta: { changes: 0 } };
                }
                if (lower.includes('delete from "user"')) {
                    const id = boundValues[0] as string;
                    const idx = users.findIndex((u) => u.id === id);
                    if (idx >= 0) {
                        users.splice(idx, 1);
                        return { success: true, meta: { changes: 1 } };
                    }
                    return { success: true, meta: { changes: 0 } };
                }
                if (lower.includes('delete from "session"') || lower.includes('delete from "account"')) {
                    return { success: true, meta: { changes: 0 } };
                }
                return { success: true, meta: { changes: 0 } };
            },
        };
        return stmt;
    };

    return { prepare: (sql: string) => makeStatement(sql), _users: users };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: {
            get: async () => null,
            put: async () => undefined,
        } as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
        ...overrides,
    };
}

function makeUserRecord(email = 'test@example.com'): UserRecord {
    return {
        id: crypto.randomUUID(),
        email,
        name: email.split('@')[0],
        emailVerified: 1,
        image: null,
        role: 'user',
        tier: 'free',
        banned: 0,
        banReason: null,
        banExpires: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

// ============================================================================
// GET /admin/users
// ============================================================================

Deno.test('handleAdminListUsers - 200 with empty list', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users');

    const res = await handleAdminListUsers(req, env, makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals((body.users as unknown[]).length, 0);
    assertEquals(body.total, 0);
});

Deno.test('handleAdminListUsers - 200 lists existing users', async () => {
    const user = makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users');

    const res = await handleAdminListUsers(req, env, makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const users = body.users as Record<string, unknown>[];
    assertEquals(users.length, 1);
    assertEquals(users[0].email, 'test@example.com');
});

Deno.test('handleAdminListUsers - 403 for non-admin role', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users');

    const res = await handleAdminListUsers(req, env, makeUserContext());
    assertEquals(res.status, 403);
});

// ============================================================================
// GET /admin/users/:id
// ============================================================================

Deno.test('handleAdminGetUser - 200 returns user', async () => {
    const user = makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/users/${user.id}`);

    const res = await handleAdminGetUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals((body.user as Record<string, unknown>).id, user.id);
});

Deno.test('handleAdminGetUser - 404 for nonexistent id', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/nonexistent-id');

    const res = await handleAdminGetUser(req, env, makeAdminContext(), 'nonexistent-id');
    assertEquals(res.status, 404);
});

Deno.test('handleAdminGetUser - 403 for non-admin', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/some-id');

    const res = await handleAdminGetUser(req, env, makeUserContext(), 'some-id');
    assertEquals(res.status, 403);
});

// ============================================================================
// PATCH /admin/users/:id
// ============================================================================

Deno.test('handleAdminUpdateUser - 200 updates tier', async () => {
    const user = makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tier: UserTier.Admin }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
});

Deno.test('handleAdminUpdateUser - 400 when no fields provided', async () => {
    const user = makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 400);
});

Deno.test('handleAdminUpdateUser - 404 for nonexistent user', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateUser(req, env, makeAdminContext(), 'nonexistent');
    assertEquals(res.status, 404);
});

Deno.test('handleAdminUpdateUser - 403 for non-admin', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/some-id', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateUser(req, env, makeUserContext(), 'some-id');
    assertEquals(res.status, 403);
});

// ============================================================================
// DELETE /admin/users/:id
// ============================================================================

Deno.test('handleAdminDeleteUser - 200 deletes existing user', async () => {
    const user = makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/users/${user.id}`, { method: 'DELETE' });

    const res = await handleAdminDeleteUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
    assertEquals(db._users.length, 0);
});

Deno.test('handleAdminDeleteUser - 404 for nonexistent user', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/nonexistent', { method: 'DELETE' });

    const res = await handleAdminDeleteUser(req, env, makeAdminContext(), 'nonexistent');
    assertEquals(res.status, 404);
});

Deno.test('handleAdminDeleteUser - 403 for non-admin', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/some-id', { method: 'DELETE' });

    const res = await handleAdminDeleteUser(req, env, makeUserContext(), 'some-id');
    assertEquals(res.status, 403);
});

// ============================================================================
// POST /admin/users/:id/ban
// ============================================================================

Deno.test('handleAdminBanUser - 200 bans existing user', async () => {
    const user = makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/users/${user.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Spam' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminBanUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
});

Deno.test('handleAdminBanUser - 404 for nonexistent user', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/nonexistent/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminBanUser(req, env, makeAdminContext(), 'nonexistent');
    assertEquals(res.status, 404);
});

// ============================================================================
// POST /admin/users/:id/unban
// ============================================================================

Deno.test('handleAdminUnbanUser - 200 unbans existing user', async () => {
    const user = makeUserRecord();
    user.banned = 1;
    user.banReason = 'Spam';
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/users/${user.id}/unban`, { method: 'POST' });

    const res = await handleAdminUnbanUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
});

Deno.test('handleAdminUnbanUser - 404 for nonexistent user', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/users/nonexistent/unban', { method: 'POST' });

    const res = await handleAdminUnbanUser(req, env, makeAdminContext(), 'nonexistent');
    assertEquals(res.status, 404);
});

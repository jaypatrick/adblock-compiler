/**
 * Tests for admin local user management handlers.
 *
 * Covers:
 *   GET    /admin/local-users        (handleAdminListLocalUsers)
 *   GET    /admin/local-users/:id    (handleAdminGetLocalUser)
 *   POST   /admin/local-users        (handleAdminCreateLocalUser)
 *   PATCH  /admin/local-users/:id    (handleAdminUpdateLocalUser)
 *   DELETE /admin/local-users/:id    (handleAdminDeleteLocalUser)
 *
 * Uses in-memory D1 mock and admin auth context — no real network I/O.
 *
 * @see worker/handlers/admin-users.ts
 */

import { assertEquals } from '@std/assert';
import {
    handleAdminCreateLocalUser,
    handleAdminDeleteLocalUser,
    handleAdminGetLocalUser,
    handleAdminListLocalUsers,
    handleAdminUpdateLocalUser,
} from './admin-users.ts';
import { hashPassword } from '../utils/password.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

const TEST_JWT_SECRET = 'test-secret-at-least-32-characters-long!!';

function makeAdminContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'admin-001',
        clerkUserId: 'admin-001',
        tier: UserTier.Admin,
        role: 'admin',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'local-jwt',
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
        authMethod: 'local-jwt',
    };
}

// ============================================================================
// In-memory D1 mock
// ============================================================================

interface UserRecord {
    id: string;
    identifier: string;
    identifier_type: 'email' | 'phone';
    password_hash: string;
    role: string;
    tier: UserTier;
    created_at: string;
    updated_at: string;
}

function createMockDb(initialUsers: UserRecord[] = []) {
    const users: UserRecord[] = [...initialUsers];

    const makeStatement = (sql: string) => {
        let boundValues: unknown[] = [];
        const stmt = {
            bind(...args: unknown[]) {
                boundValues = args;
                return stmt;
            },
            async first<T>(): Promise<T | null> {
                const lower = sql.toLowerCase();
                if (lower.includes('where identifier =')) {
                    const identifier = boundValues[0] as string;
                    return (users.find((u) => u.identifier === identifier) ?? null) as T | null;
                }
                if (lower.includes('where id =') || lower.includes('where id=')) {
                    const id = boundValues[0] as string;
                    return (users.find((u) => u.id === id) ?? null) as T | null;
                }
                if (lower.includes('count(*)')) {
                    return ({ total: users.length }) as T;
                }
                return null;
            },
            async all<T>() {
                const lower = sql.toLowerCase();
                if (lower.includes('select') && lower.includes('from local_auth_users')) {
                    const limit = boundValues[0] as number ?? 50;
                    const offset = boundValues[1] as number ?? 0;
                    const sliced = users.slice(offset, offset + limit);
                    return {
                        results: sliced.map(({ password_hash: _ph, ...rest }) => rest) as T[],
                        success: true,
                    };
                }
                return { results: [] as T[], success: true };
            },
            async run() {
                const lower = sql.toLowerCase();
                if (lower.includes('insert into local_auth_users')) {
                    const [id, identifier, identifier_type, password_hash, role, tier] = boundValues;
                    users.push({
                        id: id as string,
                        identifier: identifier as string,
                        identifier_type: identifier_type as 'email' | 'phone',
                        password_hash: password_hash as string,
                        role: role as string,
                        tier: tier as UserTier,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    });
                    return { success: true, meta: { changes: 1 } };
                }
                if (lower.includes('update local_auth_users set role')) {
                    const [newRole, newTier, id] = boundValues;
                    const idx = users.findIndex((u) => u.id === id);
                    if (idx >= 0) {
                        if (newRole !== null) users[idx].role = newRole as string;
                        if (newTier !== null) users[idx].tier = newTier as UserTier;
                        users[idx].updated_at = new Date().toISOString();
                        return { success: true, meta: { changes: 1 } };
                    }
                    return { success: true, meta: { changes: 0 } };
                }
                if (lower.includes('delete from local_auth_users')) {
                    const id = boundValues[0] as string;
                    const idx = users.findIndex((u) => u.id === id);
                    if (idx >= 0) {
                        users.splice(idx, 1);
                        return { success: true, meta: { changes: 1 } };
                    }
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
        JWT_SECRET: TEST_JWT_SECRET,
        ...overrides,
    };
}

async function makeUserRecord(identifier = 'test@example.com'): Promise<UserRecord> {
    return {
        id: crypto.randomUUID(),
        identifier,
        identifier_type: 'email',
        password_hash: await hashPassword('password123'),
        role: 'user',
        tier: UserTier.Free,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
}

// ============================================================================
// GET /admin/local-users
// ============================================================================

Deno.test('handleAdminListLocalUsers - 200 with empty list', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users');

    const res = await handleAdminListLocalUsers(req, env, makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals((body.users as unknown[]).length, 0);
    assertEquals(body.total, 0);
});

Deno.test('handleAdminListLocalUsers - 200 lists existing users without password_hash', async () => {
    const user = await makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users');

    const res = await handleAdminListLocalUsers(req, env, makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const users = body.users as Record<string, unknown>[];
    assertEquals(users.length, 1);
    assertEquals(users[0].identifier, 'test@example.com');
    // password_hash must never appear
    assertEquals('password_hash' in users[0], false);
});

Deno.test('handleAdminListLocalUsers - 403 for non-admin role', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users');

    const res = await handleAdminListLocalUsers(req, env, makeUserContext());
    assertEquals(res.status, 403);
});

Deno.test('handleAdminListLocalUsers - respects limit/offset params', async () => {
    const users = await Promise.all([
        makeUserRecord('a@example.com'),
        makeUserRecord('b@example.com'),
        makeUserRecord('c@example.com'),
    ]);
    const db = createMockDb(users);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users?limit=2&offset=1');

    const res = await handleAdminListLocalUsers(req, env, makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals((body.users as unknown[]).length, 2);
    assertEquals(body.limit, 2);
    assertEquals(body.offset, 1);
});

// ============================================================================
// GET /admin/local-users/:id
// ============================================================================

Deno.test('handleAdminGetLocalUser - 200 returns user', async () => {
    const user = await makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/local-users/${user.id}`);

    const res = await handleAdminGetLocalUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals((body.user as Record<string, unknown>).id, user.id);
    assertEquals('password_hash' in (body.user as Record<string, unknown>), false);
});

Deno.test('handleAdminGetLocalUser - 404 for nonexistent id', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users/nonexistent-id');

    const res = await handleAdminGetLocalUser(req, env, makeAdminContext(), 'nonexistent-id');
    assertEquals(res.status, 404);
});

Deno.test('handleAdminGetLocalUser - 403 for non-admin', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users/some-id');

    const res = await handleAdminGetLocalUser(req, env, makeUserContext(), 'some-id');
    assertEquals(res.status, 403);
});

// ============================================================================
// POST /admin/local-users
// ============================================================================

Deno.test('handleAdminCreateLocalUser - 201 creates user with default user role', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'new@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminCreateLocalUser(req, env, makeAdminContext());
    assertEquals(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals((body.user as Record<string, unknown>).role, 'user');
});

Deno.test('handleAdminCreateLocalUser - 201 creates user with explicit admin role', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'admin@example.com', password: 'password123', role: 'admin' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminCreateLocalUser(req, env, makeAdminContext());
    assertEquals(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assertEquals((body.user as Record<string, unknown>).role, 'admin');
    assertEquals((body.user as Record<string, unknown>).tier, UserTier.Admin);
});

Deno.test('handleAdminCreateLocalUser - 409 on duplicate identifier', async () => {
    const user = await makeUserRecord('taken@example.com');
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'taken@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminCreateLocalUser(req, env, makeAdminContext());
    assertEquals(res.status, 409);
});

Deno.test('handleAdminCreateLocalUser - 400 on invalid role', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'new@example.com', password: 'password123', role: 'superuser' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminCreateLocalUser(req, env, makeAdminContext());
    assertEquals(res.status, 400);
});

Deno.test('handleAdminCreateLocalUser - 403 for non-admin', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'new@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminCreateLocalUser(req, env, makeUserContext());
    assertEquals(res.status, 403);
});

// ============================================================================
// PATCH /admin/local-users/:id
// ============================================================================

Deno.test('handleAdminUpdateLocalUser - 200 updates role and tier independently', async () => {
    const user = await makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/local-users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin', tier: UserTier.Admin }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateLocalUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const updated = body.user as Record<string, unknown>;
    assertEquals(updated.role, 'admin');
    assertEquals(updated.tier, UserTier.Admin);
});

Deno.test('handleAdminUpdateLocalUser - 200 role change auto-updates tier', async () => {
    const user = await makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/local-users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }), // no explicit tier
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateLocalUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    const updated = body.user as Record<string, unknown>;
    assertEquals(updated.role, 'admin');
    // tier auto-derives from role when not explicitly set
    assertEquals(updated.tier, UserTier.Admin);
});

Deno.test('handleAdminUpdateLocalUser - 400 on invalid role', async () => {
    const user = await makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/local-users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'superuser' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateLocalUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 400);
});

Deno.test('handleAdminUpdateLocalUser - 400 when no fields provided', async () => {
    const user = await makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/local-users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateLocalUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 400);
});

Deno.test('handleAdminUpdateLocalUser - 404 for nonexistent user', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateLocalUser(req, env, makeAdminContext(), 'nonexistent');
    assertEquals(res.status, 404);
});

Deno.test('handleAdminUpdateLocalUser - 403 for non-admin', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users/some-id', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleAdminUpdateLocalUser(req, env, makeUserContext(), 'some-id');
    assertEquals(res.status, 403);
});

// ============================================================================
// DELETE /admin/local-users/:id
// ============================================================================

Deno.test('handleAdminDeleteLocalUser - 200 deletes existing user', async () => {
    const user = await makeUserRecord();
    const db = createMockDb([user]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request(`http://localhost/admin/local-users/${user.id}`, { method: 'DELETE' });

    const res = await handleAdminDeleteLocalUser(req, env, makeAdminContext(), user.id);
    assertEquals(res.status, 200);
    assertEquals(db._users.length, 0);
});

Deno.test('handleAdminDeleteLocalUser - 404 for nonexistent user', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users/nonexistent', { method: 'DELETE' });

    const res = await handleAdminDeleteLocalUser(req, env, makeAdminContext(), 'nonexistent');
    assertEquals(res.status, 404);
});

Deno.test('handleAdminDeleteLocalUser - 403 for non-admin', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/admin/local-users/some-id', { method: 'DELETE' });

    const res = await handleAdminDeleteLocalUser(req, env, makeUserContext(), 'some-id');
    assertEquals(res.status, 403);
});

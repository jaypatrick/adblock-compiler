/**
 * Tests for local JWT auth handlers.
 *
 * Covers:
 *   POST /auth/signup          (handleLocalSignup)
 *   POST /auth/login           (handleLocalLogin)
 *   GET  /auth/me              (handleLocalMe)
 *   POST /auth/change-password (handleLocalChangePassword)
 *
 * Uses in-memory D1 mock and stub AnalyticsService — no real network I/O.
 *
 * @see worker/handlers/local-auth.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleLocalBootstrapAdmin, handleLocalChangePassword, handleLocalLogin, handleLocalMe, handleLocalSignup, handleLocalUpdateProfile } from './local-auth.ts';
import { hashPassword } from '../utils/password.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';

// ============================================================================
// Fixtures
// ============================================================================

const TEST_JWT_SECRET = 'test-secret-at-least-32-characters-long!!';
const TEST_IP = '127.0.0.1';

/** Stub analytics — no-op for tests. */
const analytics = new AnalyticsService(undefined);

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

function makeAuthContext(userId: string): IAuthContext {
    return {
        userId: null,
        clerkUserId: userId,
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
    api_disabled: number;
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
                // Duplicate-email check: WHERE identifier = ? AND id != ?
                if (lower.includes('where identifier =') && lower.includes('and id !=')) {
                    const identifier = boundValues[0] as string;
                    const excludeId = boundValues[1] as string;
                    const user = users.find((u) => u.identifier === identifier && u.id !== excludeId);
                    return (user ?? null) as T | null;
                }
                if (lower.includes('where identifier =')) {
                    const identifier = boundValues[0] as string;
                    const user = users.find((u) => u.identifier === identifier);
                    return (user ?? null) as T | null;
                }
                if (lower.includes('where id =')) {
                    const id = boundValues[0] as string;
                    const user = users.find((u) => u.id === id);
                    return (user ?? null) as T | null;
                }
                // COUNT(*) by role: SELECT COUNT(*) as count FROM local_auth_users WHERE role = ?
                if (lower.includes('select count(*)') && lower.includes('where role =')) {
                    const role = boundValues[0] as string;
                    return { count: users.filter((u) => u.role === role).length } as T;
                }
                return null;
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
                        api_disabled: 0,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    });
                    return { success: true, meta: { changes: 1 } };
                }
                if (lower.includes('update local_auth_users set password_hash')) {
                    const [newHash, id] = boundValues;
                    const idx = users.findIndex((u) => u.id === id);
                    if (idx >= 0) {
                        users[idx] = { ...users[idx], password_hash: newHash as string };
                    }
                    return { success: true, meta: { changes: 1 } };
                }
                // UPDATE role = 'admin' / tier
                if (lower.includes("set role = 'admin'") || lower.includes('set role =')) {
                    const [newTier, id] = boundValues;
                    const idx = users.findIndex((u) => u.id === id);
                    if (idx >= 0) {
                        users[idx] = { ...users[idx], role: 'admin', tier: newTier as UserTier };
                    }
                    return { success: true, meta: { changes: 1 } };
                }
                // UPDATE identifier / identifier_type
                if (lower.includes('set identifier =')) {
                    const [newIdentifier, newIdentifierType, id] = boundValues;
                    const idx = users.findIndex((u) => u.id === id);
                    if (idx >= 0) {
                        users[idx] = {
                            ...users[idx],
                            identifier: newIdentifier as string,
                            identifier_type: newIdentifierType as 'email' | 'phone',
                        };
                    }
                    return { success: true, meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 0 } };
            },
        };
        return stmt;
    };

    return {
        prepare: (sql: string) => makeStatement(sql),
        /** Expose internal store for assertions */
        _users: users,
    };
}

/** Build a minimal Env with controllable DB and JWT_SECRET. */
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

// ============================================================================
// Signup tests
// ============================================================================

Deno.test('handleLocalSignup - 201 + token on valid email', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'user@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalSignup(req, env, analytics, TEST_IP);
    assertEquals(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertExists(body.token);
});

Deno.test('handleLocalSignup - 201 + token on valid phone number', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ identifier: '+12025551234', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalSignup(req, env, analytics, TEST_IP);
    assertEquals(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertExists(body.token);
    const user = body.user as Record<string, unknown>;
    assertEquals(user.identifier_type, 'phone');
});

Deno.test('handleLocalSignup - 400 on invalid identifier', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'not-an-email-or-phone', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalSignup(req, env, analytics, TEST_IP);
    assertEquals(res.status, 400);
});

Deno.test('handleLocalSignup - 400 on short password', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'user@example.com', password: 'short' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalSignup(req, env, analytics, TEST_IP);
    assertEquals(res.status, 400);
});

Deno.test('handleLocalSignup - 409 on duplicate identifier', async () => {
    const passwordHash = await hashPassword('password123');
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000001',
        identifier: 'taken@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'taken@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalSignup(req, env, analytics, TEST_IP);
    assertEquals(res.status, 409);
});

Deno.test('handleLocalSignup - 503 on missing JWT_SECRET', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database, JWT_SECRET: undefined });
    const req = new Request('http://localhost/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'user@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalSignup(req, env, analytics, TEST_IP);
    assertEquals(res.status, 503);
});

Deno.test('handleLocalSignup - registered user has user role', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'newuser@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalSignup(req, env, analytics, TEST_IP);
    assertEquals(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    const user = body.user as Record<string, unknown>;
    assertEquals(user.role, 'user');
    assertEquals(user.tier, 'free');
});

// ============================================================================
// Login tests
// ============================================================================

Deno.test('handleLocalLogin - 200 + token on valid credentials', async () => {
    const passwordHash = await hashPassword('correctpassword');
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000002',
        identifier: 'login@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'login@example.com', password: 'correctpassword' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalLogin(req, env, analytics, TEST_IP);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertExists(body.token);
});

Deno.test('handleLocalLogin - 401 on wrong password', async () => {
    const passwordHash = await hashPassword('correctpassword');
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000003',
        identifier: 'login2@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'login2@example.com', password: 'wrongpassword' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalLogin(req, env, analytics, TEST_IP);
    assertEquals(res.status, 401);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.error, 'Invalid credentials');
});

Deno.test('handleLocalLogin - 401 on unknown identifier (no user enumeration)', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'nobody@example.com', password: 'password123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalLogin(req, env, analytics, TEST_IP);
    assertEquals(res.status, 401);
    const body = await res.json() as Record<string, unknown>;
    // Same generic error — does not reveal whether the user exists
    assertEquals(body.error, 'Invalid credentials');
});

Deno.test('handleLocalLogin - 400 on invalid body', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'not-valid', password: 'pw' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalLogin(req, env, analytics, TEST_IP);
    assertEquals(res.status, 400);
});

Deno.test('handleLocalLogin - 200 with phone identifier', async () => {
    const passwordHash = await hashPassword('phonepass1');
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000004',
        identifier: '+12025551234',
        identifier_type: 'phone',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: '+12025551234', password: 'phonepass1' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalLogin(req, env, analytics, TEST_IP);
    assertEquals(res.status, 200);
    assertExists((await res.json() as Record<string, unknown>).token);
});

// ============================================================================
// /auth/me tests
// ============================================================================

Deno.test('handleLocalMe - 200 with valid auth context', async () => {
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000005',
        identifier: 'me@example.com',
        identifier_type: 'email',
        password_hash: 'irrelevant',
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/me');
    const ctx = makeAuthContext('10000000-0000-4000-8000-000000000005');

    const res = await handleLocalMe(req, env, ctx);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    const user = body.user as Record<string, unknown>;
    assertEquals(user.identifier, 'me@example.com');
});

Deno.test('handleLocalMe - 401 when anonymous', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/auth/me');

    const res = await handleLocalMe(req, env, makeAnonContext());
    assertEquals(res.status, 401);
});

Deno.test('handleLocalMe - 404 when user not in DB', async () => {
    const db = createMockDb(); // empty DB
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/me');
    const ctx = makeAuthContext('nonexistent-user-id');

    const res = await handleLocalMe(req, env, ctx);
    assertEquals(res.status, 404);
});

// ============================================================================
// /auth/change-password tests
// ============================================================================

Deno.test('handleLocalChangePassword - 200 on successful change', async () => {
    const passwordHash = await hashPassword('oldpassword');
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000006',
        identifier: 'chpw@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const ctx = makeAuthContext('10000000-0000-4000-8000-000000000006');
    const req = new Request('http://localhost/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'oldpassword', newPassword: 'newpassword123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalChangePassword(req, env, ctx, analytics, TEST_IP);
    assertEquals(res.status, 200);
});

Deno.test('handleLocalChangePassword - 401 on wrong current password', async () => {
    const passwordHash = await hashPassword('correctpassword');
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000007',
        identifier: 'chpw2@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const ctx = makeAuthContext('10000000-0000-4000-8000-000000000007');
    const req = new Request('http://localhost/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'wrongpassword', newPassword: 'newpassword123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalChangePassword(req, env, ctx, analytics, TEST_IP);
    assertEquals(res.status, 401);
});

Deno.test('handleLocalChangePassword - 401 when anonymous', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'old', newPassword: 'newpassword123' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalChangePassword(req, env, makeAnonContext(), analytics, TEST_IP);
    assertEquals(res.status, 401);
});

Deno.test('handleLocalChangePassword - 400 on short new password', async () => {
    const passwordHash = await hashPassword('currentpw');
    const db = createMockDb([{
        id: '10000000-0000-4000-8000-000000000008',
        identifier: 'chpw3@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const ctx = makeAuthContext('10000000-0000-4000-8000-000000000008');
    const req = new Request('http://localhost/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'currentpw', newPassword: 'short' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalChangePassword(req, env, ctx, analytics, TEST_IP);
    assertEquals(res.status, 400);
});

// ============================================================================
// handleLocalBootstrapAdmin tests
// ============================================================================

Deno.test('handleLocalBootstrapAdmin - 401 when anonymous', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAnonContext(), analytics, TEST_IP);
    assertEquals(res.status, 401);
});

Deno.test('handleLocalBootstrapAdmin - 403 when INITIAL_ADMIN_EMAIL not configured', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('any-user-id'), analytics, TEST_IP);
    assertEquals(res.status, 403);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(typeof body.error, 'string');
    assertEquals((body.error as string).includes('INITIAL_ADMIN_EMAIL'), true);
});

Deno.test('handleLocalBootstrapAdmin - 503 when DB not configured', async () => {
    const env = makeEnv({
        DB: undefined as unknown as D1Database,
        INITIAL_ADMIN_EMAIL: 'admin@example.com',
    } as unknown as Env);
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('any-user-id'), analytics, TEST_IP);
    assertEquals(res.status, 503);
});

Deno.test('handleLocalBootstrapAdmin - 503 when JWT_SECRET not configured', async () => {
    const db = createMockDb();
    const env = makeEnv({
        DB: db as unknown as D1Database,
        JWT_SECRET: undefined,
        INITIAL_ADMIN_EMAIL: 'admin@example.com',
    } as unknown as Env);
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('any-user-id'), analytics, TEST_IP);
    assertEquals(res.status, 503);
});

Deno.test('handleLocalBootstrapAdmin - 404 when user not found in DB', async () => {
    const db = createMockDb(); // empty DB
    const env = makeEnv({
        DB: db as unknown as D1Database,
        INITIAL_ADMIN_EMAIL: 'admin@example.com',
    } as unknown as Env);
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('nonexistent-id'), analytics, TEST_IP);
    assertEquals(res.status, 404);
});

Deno.test("handleLocalBootstrapAdmin - 403 when user's identifier doesn't match INITIAL_ADMIN_EMAIL", async () => {
    const passwordHash = await hashPassword('password123');
    const db = createMockDb([{
        id: '20000000-0000-4000-8000-000000000001',
        identifier: 'user@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({
        DB: db as unknown as D1Database,
        INITIAL_ADMIN_EMAIL: 'differentadmin@example.com',
    } as unknown as Env);
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('20000000-0000-4000-8000-000000000001'), analytics, TEST_IP);
    assertEquals(res.status, 403);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.error, 'This account is not designated as the initial admin');
});

Deno.test('handleLocalBootstrapAdmin - 403 when admin already exists (bootstrap already used)', async () => {
    const passwordHash = await hashPassword('password123');
    const db = createMockDb([
        {
            id: '20000000-0000-4000-8000-000000000002',
            identifier: 'newadmin@example.com',
            identifier_type: 'email',
            password_hash: passwordHash,
            role: 'user',
            tier: UserTier.Free,
            api_disabled: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        {
            id: '20000000-0000-4000-8000-000000000099',
            identifier: 'existing-admin@example.com',
            identifier_type: 'email',
            password_hash: passwordHash,
            role: 'admin',
            tier: UserTier.Admin,
            api_disabled: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
    ]);
    const env = makeEnv({
        DB: db as unknown as D1Database,
        INITIAL_ADMIN_EMAIL: 'newadmin@example.com',
    } as unknown as Env);
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('20000000-0000-4000-8000-000000000002'), analytics, TEST_IP);
    assertEquals(res.status, 403);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(typeof body.error, 'string');
    assertEquals((body.error as string).includes('already been used'), true);
});

Deno.test('handleLocalBootstrapAdmin - 200 with already-admin message when user is already admin', async () => {
    const passwordHash = await hashPassword('password123');
    const db = createMockDb([{
        id: '20000000-0000-4000-8000-000000000003',
        identifier: 'admin@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'admin',
        tier: UserTier.Admin,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({
        DB: db as unknown as D1Database,
        INITIAL_ADMIN_EMAIL: 'admin@example.com',
    } as unknown as Env);
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('20000000-0000-4000-8000-000000000003'), analytics, TEST_IP);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals(body.message, 'Account is already an admin');
});

Deno.test('handleLocalBootstrapAdmin - 200 and promotes user to admin (happy path)', async () => {
    const passwordHash = await hashPassword('password123');
    const db = createMockDb([{
        id: '20000000-0000-4000-8000-000000000004',
        identifier: 'newadmin@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({
        DB: db as unknown as D1Database,
        INITIAL_ADMIN_EMAIL: 'newadmin@example.com',
    } as unknown as Env);
    const req = new Request('http://localhost/auth/bootstrap-admin', { method: 'POST' });

    const res = await handleLocalBootstrapAdmin(req, env, makeAuthContext('20000000-0000-4000-8000-000000000004'), analytics, TEST_IP);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals(body.message, 'Account promoted to admin');
    assertExists(body.token);
    const user = body.user as Record<string, unknown>;
    assertEquals(user.role, 'admin');
});

// ============================================================================
// handleLocalUpdateProfile tests
// ============================================================================

Deno.test('handleLocalUpdateProfile - 401 when anonymous', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ identifier: 'new@example.com' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalUpdateProfile(req, env, makeAnonContext(), analytics, TEST_IP);
    assertEquals(res.status, 401);
});

Deno.test('handleLocalUpdateProfile - 503 when DB not configured', async () => {
    const env = makeEnv({ DB: undefined as unknown as D1Database });
    const req = new Request('http://localhost/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ identifier: 'new@example.com' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalUpdateProfile(req, env, makeAuthContext('any-user-id'), analytics, TEST_IP);
    assertEquals(res.status, 503);
});

Deno.test('handleLocalUpdateProfile - 400 on invalid JSON body', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/profile', {
        method: 'PATCH',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalUpdateProfile(req, env, makeAuthContext('any-user-id'), analytics, TEST_IP);
    assertEquals(res.status, 400);
});

Deno.test('handleLocalUpdateProfile - 400 on invalid email format', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ identifier: 'not-a-valid-email' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalUpdateProfile(req, env, makeAuthContext('any-user-id'), analytics, TEST_IP);
    assertEquals(res.status, 400);
});

Deno.test('handleLocalUpdateProfile - 200 "No changes made" when identifier is omitted', async () => {
    const db = createMockDb();
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalUpdateProfile(req, env, makeAuthContext('any-user-id'), analytics, TEST_IP);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    assertEquals(body.message, 'No changes made');
});

Deno.test('handleLocalUpdateProfile - 409 when email already taken by another user', async () => {
    const passwordHash = await hashPassword('password123');
    const db = createMockDb([
        {
            id: '30000000-0000-4000-8000-000000000001',
            identifier: 'taken@example.com',
            identifier_type: 'email',
            password_hash: passwordHash,
            role: 'user',
            tier: UserTier.Free,
            api_disabled: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        {
            id: '30000000-0000-4000-8000-000000000002',
            identifier: 'current@example.com',
            identifier_type: 'email',
            password_hash: passwordHash,
            role: 'user',
            tier: UserTier.Free,
            api_disabled: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
    ]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ identifier: 'taken@example.com' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalUpdateProfile(req, env, makeAuthContext('30000000-0000-4000-8000-000000000002'), analytics, TEST_IP);
    assertEquals(res.status, 409);
});

Deno.test('handleLocalUpdateProfile - 200 and updates profile successfully (happy path)', async () => {
    const passwordHash = await hashPassword('password123');
    const db = createMockDb([{
        id: '30000000-0000-4000-8000-000000000003',
        identifier: 'old@example.com',
        identifier_type: 'email',
        password_hash: passwordHash,
        role: 'user',
        tier: UserTier.Free,
        api_disabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }]);
    const env = makeEnv({ DB: db as unknown as D1Database });
    const req = new Request('http://localhost/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ identifier: 'new@example.com' }),
        headers: { 'Content-Type': 'application/json' },
    });

    const res = await handleLocalUpdateProfile(req, env, makeAuthContext('30000000-0000-4000-8000-000000000003'), analytics, TEST_IP);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, true);
    // The updated user returned in body should reflect the new identifier
    const user = body.user as Record<string, unknown>;
    assertEquals(user.identifier, 'new@example.com');
});

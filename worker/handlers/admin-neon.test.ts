/**
 * Tests for Admin Neon Reporting Handlers.
 *
 * Each test creates lightweight mocks for Env and IAuthContext and calls
 * the handler directly (no Hono router involved). The NeonApiService is
 * stubbed via the createNeonApiService factory import which the handlers
 * use internally; here we simply set env.NEON_API_KEY to trigger
 * service creation and control responses through fetch mocking.
 *
 * Because the handlers call `createNeonApiService` internally and that
 * factory immediately makes HTTP calls, we mock at a higher level:
 * we test the handler's own guard-rails (missing env, missing projectId,
 * invalid body, permission denied) directly, and for the "happy path"
 * we ensure the handler plumbs the right args through by intercepting
 * globalThis.fetch.
 */

import { assertEquals } from '@std/assert';
import {
    handleAdminNeonCreateBranch,
    handleAdminNeonDeleteBranch,
    handleAdminNeonGetBranch,
    handleAdminNeonGetProject,
    handleAdminNeonListBranches,
    handleAdminNeonListDatabases,
    handleAdminNeonListEndpoints,
    handleAdminNeonQuery,
} from './admin-neon.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';
import { makeAppContext } from '../test-helpers.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeAdminContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'admin-001',
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
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: {} as unknown as KVNamespace,
        RATE_LIMIT: {
            get: async () => null,
            put: async () => undefined,
        } as unknown as KVNamespace,
        METRICS: {} as unknown as KVNamespace,
        ASSETS: {} as unknown as Fetcher,
        HYPERDRIVE: {} as unknown as Hyperdrive,
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
        NEON_API_KEY: 'napi_test_key',
        NEON_PROJECT_ID: 'test-project-id',
        ...overrides,
    } as Env;
}

function jsonRequest(url: string, body?: unknown, method = 'POST'): Request {
    if (body !== undefined) {
        return new Request(url, {
            method,
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }
    return new Request(url, { method });
}

// ── Helper to intercept fetch for Neon API calls ────────────────────────────

type FetchFn = typeof globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchFn {
    return ((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return Promise.resolve(handler(url, init));
    }) as FetchFn;
}

// ============================================================================
// Guard-rail tests (no external calls needed)
// ============================================================================

// ── Missing NEON_API_KEY ─────────────────────────────────────────────────────

Deno.test('handleAdminNeonGetProject — 503 when NEON_API_KEY missing', async () => {
    const req = new Request('http://localhost/admin/neon/project');
    const env = makeEnv({ NEON_API_KEY: undefined });
    const res = await handleAdminNeonGetProject(makeAppContext(req, env, makeAdminContext()));
    assertEquals(res.status, 503);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

// ── Missing projectId ────────────────────────────────────────────────────────

Deno.test('handleAdminNeonGetProject — 400 when projectId missing', async () => {
    const req = new Request('http://localhost/admin/neon/project');
    const env = makeEnv({ NEON_PROJECT_ID: undefined });
    const res = await handleAdminNeonGetProject(makeAppContext(req, env, makeAdminContext()));
    assertEquals(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

// ── Permission denied (non-admin user) ───────────────────────────────────────

Deno.test('handleAdminNeonGetProject — 403 for non-admin user', async () => {
    const req = new Request('http://localhost/admin/neon/project');
    const res = await handleAdminNeonGetProject(makeAppContext(req, makeEnv(), makeUserContext()));
    assertEquals(res.status, 403);
});

Deno.test('handleAdminNeonListBranches — 403 for non-admin user', async () => {
    const req = new Request('http://localhost/admin/neon/branches');
    const res = await handleAdminNeonListBranches(makeAppContext(req, makeEnv(), makeUserContext()));
    assertEquals(res.status, 403);
});

Deno.test('handleAdminNeonQuery — 403 for non-admin user', async () => {
    const req = jsonRequest('http://localhost/admin/neon/query', {
        connectionString: 'postgres://test',
        sql: 'SELECT 1',
    });
    const res = await handleAdminNeonQuery(makeAppContext(req, makeEnv(), makeUserContext()));
    assertEquals(res.status, 403);
});

// ── Validation failures ──────────────────────────────────────────────────────

Deno.test('handleAdminNeonCreateBranch — 400 on invalid JSON', async () => {
    const req = new Request('http://localhost/admin/neon/branches', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
    });
    const res = await handleAdminNeonCreateBranch(makeAppContext(req, makeEnv(), makeAdminContext()));
    assertEquals(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

Deno.test('handleAdminNeonQuery — 400 when sql is empty', async () => {
    const req = jsonRequest('http://localhost/admin/neon/query', {
        connectionString: 'postgres://test',
        sql: '',
    });
    const res = await handleAdminNeonQuery(makeAppContext(req, makeEnv(), makeAdminContext()));
    assertEquals(res.status, 400);
});

Deno.test('handleAdminNeonQuery — 400 when connectionString missing', async () => {
    const req = jsonRequest('http://localhost/admin/neon/query', {
        sql: 'SELECT 1',
    });
    const res = await handleAdminNeonQuery(makeAppContext(req, makeEnv(), makeAdminContext()));
    assertEquals(res.status, 400);
});

// ── projectId from query param overrides env ─────────────────────────────────

Deno.test('handleAdminNeonListBranches — uses projectId from query param', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    globalThis.fetch = mockFetch((url) => {
        capturedUrl = url;
        return Response.json({
            branches: [{
                id: 'br-1',
                name: 'main',
                project_id: 'override-id',
                parent_id: null,
                current_state: 'ready',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-06-15T12:00:00Z',
            }],
        });
    });
    try {
        const req = new Request('http://localhost/admin/neon/branches?projectId=override-id');
        const res = await handleAdminNeonListBranches(makeAppContext(req, makeEnv(), makeAdminContext()));
        assertEquals(res.status, 200);
        assertEquals(capturedUrl.includes('override-id'), true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// ============================================================================
// Happy-path tests (mock globalThis.fetch)
// ============================================================================

Deno.test('handleAdminNeonGetProject — 200 with project data', async () => {
    const originalFetch = globalThis.fetch;
    const fakeProject = {
        id: 'proj-1',
        name: 'test-proj',
        region_id: 'aws-us-east-2',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-06-15T12:00:00Z',
    };
    globalThis.fetch = mockFetch(() => Response.json({ project: fakeProject }));
    try {
        const req = new Request('http://localhost/admin/neon/project');
        const res = await handleAdminNeonGetProject(makeAppContext(req, makeEnv(), makeAdminContext()));
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body.project as Record<string, unknown>).id, 'proj-1');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleAdminNeonListBranches — 200 with branches', async () => {
    const originalFetch = globalThis.fetch;
    const fakeBranches = [{
        id: 'br-1',
        name: 'main',
        project_id: 'test-project-id',
        parent_id: null,
        current_state: 'ready',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-06-15T12:00:00Z',
    }];
    globalThis.fetch = mockFetch(() => Response.json({ branches: fakeBranches }));
    try {
        const req = new Request('http://localhost/admin/neon/branches');
        const res = await handleAdminNeonListBranches(makeAppContext(req, makeEnv(), makeAdminContext()));
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body.branches as unknown[]).length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleAdminNeonGetBranch — 200 with single branch', async () => {
    const originalFetch = globalThis.fetch;
    const fakeBranch = {
        id: 'br-1',
        name: 'main',
        project_id: 'test-project-id',
        parent_id: null,
        current_state: 'ready',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-06-15T12:00:00Z',
    };
    globalThis.fetch = mockFetch(() => Response.json({ branch: fakeBranch }));
    try {
        const req = new Request('http://localhost/admin/neon/branches/br-1');
        const res = await handleAdminNeonGetBranch(makeAppContext(req, makeEnv(), makeAdminContext()), 'br-1');
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body.branch as Record<string, unknown>).id, 'br-1');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleAdminNeonCreateBranch — 201 on success', async () => {
    const originalFetch = globalThis.fetch;
    const fakeResult = {
        branch: {
            id: 'br-new',
            name: 'feature-branch',
            project_id: 'test-project-id',
            parent_id: 'br-1',
            current_state: 'init',
            created_at: '2024-06-20T00:00:00Z',
            updated_at: '2024-06-20T00:00:00Z',
        },
        operations: [{
            id: 'op-1',
            project_id: 'test-project-id',
            branch_id: 'br-new',
            action: 'create_branch',
            status: 'running',
            created_at: '2024-06-20T00:00:00Z',
            updated_at: '2024-06-20T00:00:00Z',
        }],
    };
    globalThis.fetch = mockFetch(() => Response.json(fakeResult));
    try {
        const req = jsonRequest('http://localhost/admin/neon/branches', { name: 'feature-branch' });
        const res = await handleAdminNeonCreateBranch(makeAppContext(req, makeEnv(), makeAdminContext()));
        assertEquals(res.status, 201);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body.branch as Record<string, unknown>).name, 'feature-branch');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleAdminNeonDeleteBranch — 200 on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(() =>
        Response.json({
            branch: {
                id: 'br-1',
                name: 'main',
                project_id: 'test-project-id',
                parent_id: null,
                current_state: 'ready',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-06-20T00:00:00Z',
            },
            operations: [],
        })
    );
    try {
        const req = new Request('http://localhost/admin/neon/branches/br-1', { method: 'DELETE' });
        const res = await handleAdminNeonDeleteBranch(makeAppContext(req, makeEnv(), makeAdminContext()), 'br-1');
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleAdminNeonListEndpoints — 200 with endpoints', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(() =>
        Response.json({
            endpoints: [{
                id: 'ep-1',
                host: 'ep-1.us-east-2.aws.neon.tech',
                branch_id: 'br-1',
                type: 'read_write',
                current_state: 'active',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-06-15T12:00:00Z',
            }],
        })
    );
    try {
        const req = new Request('http://localhost/admin/neon/endpoints');
        const res = await handleAdminNeonListEndpoints(makeAppContext(req, makeEnv(), makeAdminContext()));
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body.endpoints as unknown[]).length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleAdminNeonListDatabases — 200 with databases', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(() =>
        Response.json({
            databases: [{
                id: 1,
                name: 'neondb',
                branch_id: 'br-1',
                owner_name: 'neondb_owner',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-06-15T12:00:00Z',
            }],
        })
    );
    try {
        const req = new Request('http://localhost/admin/neon/databases/br-1');
        const res = await handleAdminNeonListDatabases(makeAppContext(req, makeEnv(), makeAdminContext()), 'br-1');
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body.databases as unknown[]).length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// ── NeonApiError mapping ─────────────────────────────────────────────────────

Deno.test('handleAdminNeonGetProject — maps Neon 404 to 404 response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(() => new Response(JSON.stringify({ message: 'project not found' }), { status: 404 }));
    try {
        const req = new Request('http://localhost/admin/neon/project');
        const res = await handleAdminNeonGetProject(makeAppContext(req, makeEnv(), makeAdminContext()));
        assertEquals(res.status, 404);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleAdminNeonCreateBranch — empty body treated as valid (all fields optional)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(() =>
        Response.json({
            branch: {
                id: 'br-auto',
                name: 'auto-name',
                project_id: 'test-project-id',
                parent_id: 'br-1',
                current_state: 'init',
                created_at: '2024-06-20T00:00:00Z',
                updated_at: '2024-06-20T00:00:00Z',
            },
            operations: [],
        })
    );
    try {
        const req = jsonRequest('http://localhost/admin/neon/branches', {});
        const res = await handleAdminNeonCreateBranch(makeAppContext(req, makeEnv(), makeAdminContext()));
        assertEquals(res.status, 201);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// ── Missing env for all endpoints returns 503 ────────────────────────────────

for (
    const [name, handler, makeReq] of [
        ['ListBranches', handleAdminNeonListBranches, () => new Request('http://localhost/admin/neon/branches')],
        ['GetBranch', handleAdminNeonGetBranch, () => new Request('http://localhost/admin/neon/branches/br-1')],
        ['ListEndpoints', handleAdminNeonListEndpoints, () => new Request('http://localhost/admin/neon/endpoints')],
        ['ListDatabases', handleAdminNeonListDatabases, () => new Request('http://localhost/admin/neon/databases/br-1')],
    ] as const
) {
    Deno.test(`${name} — 503 when NEON_API_KEY missing`, async () => {
        const env = makeEnv({ NEON_API_KEY: undefined });
        const req = (makeReq as () => Request)();
        const res = await (handler as any)(makeAppContext(req, env, makeAdminContext()), 'br-1');
        assertEquals(res.status, 503);
    });
}

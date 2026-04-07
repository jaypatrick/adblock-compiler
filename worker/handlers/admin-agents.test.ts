/**
 * Tests for admin agent data handlers.
 *
 * Covers:
 *   GET    /admin/agents/sessions        (handleAdminListAgentSessions)
 *   GET    /admin/agents/sessions/:id    (handleAdminGetAgentSession)
 *   GET    /admin/agents/audit           (handleAdminListAgentAuditLog)
 *   DELETE /admin/agents/sessions/:id    (handleAdminTerminateAgentSession)
 *
 * Prisma is stubbed at the createPrismaClient boundary — no real DB I/O.
 *
 * @see worker/handlers/admin-agents.ts
 */

import { assertEquals } from '@std/assert';
import { stub } from '@std/testing/mock';
import { handleAdminGetAgentSession, handleAdminListAgentAuditLog, handleAdminListAgentSessions, handleAdminTerminateAgentSession } from './admin-agents.ts';
import { type Env, type HyperdriveBinding, type IAuthContext, UserTier } from '../types.ts';
import { _internals } from '../lib/prisma.ts';

// ============================================================================
// Fixtures
// ============================================================================

const VALID_UUID = '00000000-0000-0000-0000-000000000001';

function makeAdminContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'admin-user-id',
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
        HYPERDRIVE: { connectionString: 'postgres://test' } as unknown as HyperdriveBinding,
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
        ...overrides,
    } as Env;
}

function makeEnvNoHyperdrive(): Env {
    return makeEnv({ HYPERDRIVE: undefined });
}

/** Minimal mock PrismaClient matching the shape used by admin-agents. */
function makeMockPrisma(overrides: Record<string, unknown> = {}) {
    const defaults = {
        agentSession: {
            findMany: async () => [],
            findUnique: async () => null,
            count: async () => 0,
            update: async (args: { data: unknown; where: unknown }) => ({ id: VALID_UUID, ...(args.data as Record<string, unknown>) }),
        },
        agentAuditLog: {
            findMany: async () => [],
            count: async () => 0,
            create: async () => ({}),
        },
    };
    return { ...defaults, ...overrides };
}

// ============================================================================
// GET /admin/agents/sessions
// ============================================================================

Deno.test('handleAdminListAgentSessions — 403 for non-admin user', async () => {
    const req = new Request('http://localhost/admin/agents/sessions');
    const res = await handleAdminListAgentSessions(req, makeEnv(), makeUserContext());
    assertEquals(res.status, 403);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

Deno.test('handleAdminListAgentSessions — 503 when Hyperdrive missing', async () => {
    const req = new Request('http://localhost/admin/agents/sessions');
    const res = await handleAdminListAgentSessions(req, makeEnvNoHyperdrive(), makeAdminContext());
    assertEquals(res.status, 503);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

Deno.test('handleAdminListAgentSessions — 400 on invalid pagination params', async () => {
    const req = new Request('http://localhost/admin/agents/sessions?limit=0');
    const prismaStub = stub(_internals, 'createPrismaClient', () => makeMockPrisma() as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const res = await handleAdminListAgentSessions(req, makeEnv(), makeAdminContext());
        assertEquals(res.status, 400);
    } finally {
        prismaStub.restore();
    }
});

Deno.test('handleAdminListAgentSessions — 200 returns items and total', async () => {
    const fakeSessions = [{ id: VALID_UUID, agentSlug: 'mcp-agent', startedAt: new Date() }];
    const mockPrisma = makeMockPrisma({
        agentSession: {
            findMany: async () => fakeSessions,
            count: async () => 1,
        },
    });
    const prismaStub = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const req = new Request('http://localhost/admin/agents/sessions');
        const res = await handleAdminListAgentSessions(req, makeEnv(), makeAdminContext());
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body as Record<string, unknown>).total, 1);
        assertEquals(((body as Record<string, unknown>).items as unknown[]).length, 1);
    } finally {
        prismaStub.restore();
    }
});

// ============================================================================
// GET /admin/agents/sessions/:sessionId
// ============================================================================

Deno.test('handleAdminGetAgentSession — 403 for non-admin user', async () => {
    const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`);
    const res = await handleAdminGetAgentSession(req, makeEnv(), makeUserContext(), VALID_UUID);
    assertEquals(res.status, 403);
});

Deno.test('handleAdminGetAgentSession — 400 on invalid UUID', async () => {
    const req = new Request('http://localhost/admin/agents/sessions/not-a-uuid');
    const res = await handleAdminGetAgentSession(req, makeEnv(), makeAdminContext(), 'not-a-uuid');
    assertEquals(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

Deno.test('handleAdminGetAgentSession — 503 when Hyperdrive missing', async () => {
    const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`);
    const res = await handleAdminGetAgentSession(req, makeEnvNoHyperdrive(), makeAdminContext(), VALID_UUID);
    assertEquals(res.status, 503);
});

Deno.test('handleAdminGetAgentSession — 404 when session not found', async () => {
    const mockPrisma = makeMockPrisma();
    const prismaStub = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`);
        const res = await handleAdminGetAgentSession(req, makeEnv(), makeAdminContext(), VALID_UUID);
        assertEquals(res.status, 404);
    } finally {
        prismaStub.restore();
    }
});

Deno.test('handleAdminGetAgentSession — 200 returns session with invocations', async () => {
    const fakeSession = { id: VALID_UUID, agentSlug: 'mcp-agent', invocations: [] };
    const mockPrisma = makeMockPrisma({
        agentSession: {
            findUnique: async () => fakeSession,
        },
    });
    const prismaStub = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`);
        const res = await handleAdminGetAgentSession(req, makeEnv(), makeAdminContext(), VALID_UUID);
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body as Record<string, unknown>).id, VALID_UUID);
    } finally {
        prismaStub.restore();
    }
});

// ============================================================================
// GET /admin/agents/audit
// ============================================================================

Deno.test('handleAdminListAgentAuditLog — 403 for non-admin user', async () => {
    const req = new Request('http://localhost/admin/agents/audit');
    const res = await handleAdminListAgentAuditLog(req, makeEnv(), makeUserContext());
    assertEquals(res.status, 403);
});

Deno.test('handleAdminListAgentAuditLog — 503 when Hyperdrive missing', async () => {
    const req = new Request('http://localhost/admin/agents/audit');
    const res = await handleAdminListAgentAuditLog(req, makeEnvNoHyperdrive(), makeAdminContext());
    assertEquals(res.status, 503);
});

Deno.test('handleAdminListAgentAuditLog — 200 returns audit entries', async () => {
    const fakeEntries = [{ id: VALID_UUID, action: 'session.started', status: 'success' }];
    const mockPrisma = makeMockPrisma({
        agentAuditLog: {
            findMany: async () => fakeEntries,
            count: async () => 1,
        },
    });
    const prismaStub = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const req = new Request('http://localhost/admin/agents/audit');
        const res = await handleAdminListAgentAuditLog(req, makeEnv(), makeAdminContext());
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals((body as Record<string, unknown>).total, 1);
    } finally {
        prismaStub.restore();
    }
});

// ============================================================================
// DELETE /admin/agents/sessions/:sessionId
// ============================================================================

Deno.test('handleAdminTerminateAgentSession — 403 for non-admin user', async () => {
    const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`, { method: 'DELETE' });
    const res = await handleAdminTerminateAgentSession(req, makeEnv(), makeUserContext(), VALID_UUID);
    assertEquals(res.status, 403);
});

Deno.test('handleAdminTerminateAgentSession — 400 on invalid UUID', async () => {
    const req = new Request('http://localhost/admin/agents/sessions/bad-id', { method: 'DELETE' });
    const res = await handleAdminTerminateAgentSession(req, makeEnv(), makeAdminContext(), 'bad-id');
    assertEquals(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});

Deno.test('handleAdminTerminateAgentSession — 503 when Hyperdrive missing', async () => {
    const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`, { method: 'DELETE' });
    const res = await handleAdminTerminateAgentSession(req, makeEnvNoHyperdrive(), makeAdminContext(), VALID_UUID);
    assertEquals(res.status, 503);
});

Deno.test('handleAdminTerminateAgentSession — 404 when session not found', async () => {
    const mockPrisma = makeMockPrisma();
    const prismaStub = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`, { method: 'DELETE' });
        const res = await handleAdminTerminateAgentSession(req, makeEnv(), makeAdminContext(), VALID_UUID);
        assertEquals(res.status, 404);
    } finally {
        prismaStub.restore();
    }
});

Deno.test('handleAdminTerminateAgentSession — 409 when session already ended', async () => {
    const endedSession = {
        id: VALID_UUID,
        agentSlug: 'mcp-agent',
        instanceId: 'default',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        endedAt: new Date('2026-01-01T01:00:00Z'), // already ended
    };
    const mockPrisma = makeMockPrisma({
        agentSession: {
            findUnique: async () => endedSession,
        },
    });
    const prismaStub = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`, { method: 'DELETE' });
        const res = await handleAdminTerminateAgentSession(req, makeEnv(), makeAdminContext(), VALID_UUID);
        assertEquals(res.status, 409);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, false);
    } finally {
        prismaStub.restore();
    }
});

Deno.test('handleAdminTerminateAgentSession — 200 terminates active session', async () => {
    const activeSession = {
        id: VALID_UUID,
        agentSlug: 'mcp-agent',
        instanceId: 'default',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        endedAt: null, // active
    };
    let auditCreated = false;
    const mockPrisma = makeMockPrisma({
        agentSession: {
            findUnique: async () => activeSession,
            update: async (args: { data: unknown }) => ({ ...activeSession, ...(args.data as Record<string, unknown>) }),
        },
        agentAuditLog: {
            create: async () => {
                auditCreated = true;
                return {};
            },
        },
    });
    const prismaStub = stub(_internals, 'createPrismaClient', () => mockPrisma as unknown as ReturnType<typeof _internals.createPrismaClient>);
    try {
        const req = new Request(`http://localhost/admin/agents/sessions/${VALID_UUID}`, { method: 'DELETE' });
        const res = await handleAdminTerminateAgentSession(req, makeEnv(), makeAdminContext(), VALID_UUID);
        assertEquals(res.status, 200);
        const body = await res.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals(auditCreated, true);
        // Ensure endedAt is set on the returned session
        const data = body as Record<string, unknown>;
        assertEquals(data.endReason, 'admin_terminate');
    } finally {
        prismaStub.restore();
    }
});

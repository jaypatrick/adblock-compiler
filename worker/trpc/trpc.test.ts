/**
 * Unit tests for the tRPC v1 router.
 *
 * Uses `createCallerFactory` to invoke procedures directly (no HTTP overhead).
 */

import { assertEquals, assertRejects } from '@std/assert';
import { TRPCError } from '@trpc/server';
import { UserTier } from '../types.ts';
import { createCallerFactory } from './init.ts';
import { appRouter } from './router.ts';
import { makeEnv } from '../test-helpers.ts';
import type { TrpcContext } from './context.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const env = makeEnv({ COMPILER_VERSION: 'test-1.0.0' });

/** Anonymous context (no authenticated user). */
const anonCtx: TrpcContext = {
    env,
    authContext: {
        userId: null,
        tier: UserTier.Anonymous,
        role: 'anonymous',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'anonymous',
        email: null,
        displayName: null,
        apiKeyRateLimit: null,
    },
    requestId: 'test-request-id',
    ip: '127.0.0.1',
    analytics: {
        trackSecurityEvent: () => {},
        trackApiUsage: () => {},
        trackError: () => {},
        // deno-lint-ignore no-explicit-any
    } as any,
};

/** Authenticated (free-tier) user context. */
const authedCtx: TrpcContext = {
    ...anonCtx,
    authContext: {
        ...anonCtx.authContext,
        userId: 'user-123',
        tier: UserTier.Free,
        role: 'user',
        authMethod: 'better-auth',
    },
};

/** Admin context. */
const adminCtx: TrpcContext = {
    ...authedCtx,
    authContext: {
        ...authedCtx.authContext,
        userId: 'admin-456',
        role: 'admin',
    },
};

const createCaller = createCallerFactory(appRouter);

// ── v1.health.get ──────────────────────────────────────────────────────────────

Deno.test('v1.health.get — returns parsed health JSON for anonymous callers', async () => {
    const caller = createCaller(anonCtx);
    // handleHealth reaches out to KV / Hyperdrive; with mock env it returns a
    // degraded-but-valid JSON response.
    // deno-lint-ignore no-explicit-any
    const result = await caller.v1.health.get() as any;
    // Must be an object with at least a `status` key.
    assertEquals(typeof result, 'object');
    assertEquals(typeof result.status, 'string');
});

// ── v1.version.get ─────────────────────────────────────────────────────────────

Deno.test('v1.version.get — returns version and apiVersion', async () => {
    const caller = createCaller(anonCtx);
    const result = await caller.v1.version.get();
    assertEquals(result.version, 'test-1.0.0');
    assertEquals(result.apiVersion, 'v1');
});

Deno.test('v1.version.get — returns "unknown" when COMPILER_VERSION is absent', async () => {
    const ctxNoVersion: TrpcContext = { ...anonCtx, env: makeEnv({ COMPILER_VERSION: '' }) };
    const caller = createCaller(ctxNoVersion);
    const result = await caller.v1.version.get();
    // Empty string is falsy — the router uses `||` so it falls back to 'unknown'
    assertEquals(result.version, 'unknown');
    assertEquals(result.apiVersion, 'v1');
});

// ── v1.compile.json ─────────────────────────────────────────────────────────────

Deno.test('v1.compile.json — rejects anonymous callers with UNAUTHORIZED', async () => {
    const caller = createCaller(anonCtx);
    // deno-lint-ignore no-explicit-any
    await assertRejects(
        // deno-lint-ignore no-explicit-any
        () => caller.v1.compile.json({} as any),
        TRPCError,
        'Authentication required.',
    );
});

Deno.test('v1.compile.json — authenticated caller receives compile response', async () => {
    const caller = createCaller(authedCtx);
    // The CompileRequestSchema requires a `configuration.sources` field. Passing
    // an empty object triggers a schema validation error (BAD_REQUEST) — not
    // UNAUTHORIZED. This confirms auth passed and the handler was reached.
    // deno-lint-ignore no-explicit-any
    const err = await caller.v1.compile.json({} as any).catch((e) => e);
    assertEquals(err instanceof TRPCError, true);
    assertEquals((err as TRPCError).code, 'BAD_REQUEST');
});

// ── protectedProcedure auth enforcement ────────────────────────────────────────

Deno.test('protectedProcedure — throws UNAUTHORIZED when userId is null', async () => {
    const caller = createCaller(anonCtx);
    // deno-lint-ignore no-explicit-any
    const err = await caller.v1.compile.json({} as any).catch((e) => e);
    assertEquals(err instanceof TRPCError, true);
    assertEquals((err as TRPCError).code, 'UNAUTHORIZED');
});

Deno.test('protectedProcedure — allows request when userId is set', async () => {
    const caller = createCaller(authedCtx);
    // Should not throw UNAUTHORIZED. A BAD_REQUEST (schema validation) is expected
    // because we're passing an empty object, not a valid CompileRequestSchema.
    // deno-lint-ignore no-explicit-any
    const err = await caller.v1.compile.json({} as any).catch((e) => e);
    if (err instanceof TRPCError) {
        assertEquals(err.code !== 'UNAUTHORIZED', true);
    }
});

// ── adminProcedure auth enforcement ────────────────────────────────────────────

Deno.test('adminProcedure — enforces admin role requirement', async () => {
    // Import the init primitives directly to test adminProcedure in isolation.
    const { router: r, adminProcedure } = await import('./init.ts');
    const testRouter = r({
        ping: adminProcedure.query(() => 'pong'),
    });
    const testCreate = createCallerFactory(testRouter);

    // Anonymous → UNAUTHORIZED
    const anonCaller = testCreate(anonCtx);
    const err1 = await anonCaller.ping().catch((e) => e);
    assertEquals(err1 instanceof TRPCError, true);
    assertEquals((err1 as TRPCError).code, 'UNAUTHORIZED');

    // Authenticated non-admin → FORBIDDEN
    const userCaller = testCreate(authedCtx);
    const err2 = await userCaller.ping().catch((e) => e);
    assertEquals(err2 instanceof TRPCError, true);
    assertEquals((err2 as TRPCError).code, 'FORBIDDEN');

    // Admin → success
    const adminCaller = testCreate(adminCtx);
    const result = await adminCaller.ping();
    assertEquals(result, 'pong');
});

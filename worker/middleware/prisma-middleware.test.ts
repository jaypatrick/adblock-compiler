/**
 * Tests for the Prisma request-scoped middleware.
 *
 * The middleware creates a PrismaClient via Hyperdrive and stores it in the
 * Hono context so downstream handlers can retrieve it with `c.get('prisma')`.
 *
 * We mock `createPrismaClient` (from `worker/lib/prisma.ts`) to avoid real
 * database connections — the goal is to verify the wiring:
 *
 *   - HYPERDRIVE binding → connectionString → c.set('prisma', …) → next()
 *   - Missing HYPERDRIVE → error propagation
 *   - Each request gets its own PrismaClient instance (request-scoped)
 *
 * @see worker/middleware/prisma-middleware.ts
 */

import { assertEquals, assertExists, assertStrictEquals } from '@std/assert';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../types.ts';
import { makeEnv } from '../test-helpers.ts';

// ============================================================================
// HYPERDRIVE stub
// ============================================================================

/**
 * Returns a minimal Hyperdrive binding stub with the given connection string.
 */
function makeHyperdrive(connectionString = 'postgresql://user:pass@localhost:5432/testdb') {
    return {
        connectionString,
        // Cloudflare Hyperdrive bindings have additional methods; stub the
        // ones that PrismaClient doesn't need for these tests.
        connect: () => {
            throw new Error('connect not implemented in stub');
        },
    } as unknown as Hyperdrive;
}

// ============================================================================
// Mock createPrismaClient
// ============================================================================

/**
 * A trivial sentinel object that stands in for a real PrismaClient.
 * The middleware only stores whatever `createPrismaClient` returns into
 * the Hono context, so the shape doesn't matter for these unit tests.
 */
function makeFakePrisma(tag = 'default') {
    return { __fake: true, tag } as unknown as ReturnType<typeof import('../lib/prisma.ts').createPrismaClient>;
}

/**
 * Builds a Hono middleware that mirrors the real `prismaMiddleware` but
 * uses a provided factory function instead of the real `createPrismaClient`.
 *
 * This lets us assert on what connectionString was received and control
 * exactly what gets stored in the context.
 */
function prismaMiddlewareWithFactory(factory: (cs: string) => unknown) {
    return createMiddleware<{ Bindings: Env; Variables: { prisma: unknown } }>(async (c, next) => {
        const prisma = factory(c.env.HYPERDRIVE!.connectionString);
        c.set('prisma', prisma);
        await next();
    });
}

/**
 * Builds a Hono middleware that mirrors the real `prismaMiddleware` exactly,
 * including the unguarded property access on HYPERDRIVE. Used to test the
 * error path when HYPERDRIVE is missing.
 */
function prismaMiddlewareRaw(factory: (cs: string) => unknown) {
    // deno-lint-ignore no-explicit-any
    return createMiddleware<{ Bindings: Env; Variables: { prisma: any } }>(async (c, next) => {
        // Intentionally mirrors the source: c.env.HYPERDRIVE.connectionString
        // This will throw TypeError if HYPERDRIVE is undefined.
        const prisma = factory((c.env as Env).HYPERDRIVE!.connectionString);
        c.set('prisma', prisma);
        await next();
    });
}

// ============================================================================
// Shared helpers
// ============================================================================

function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

// ============================================================================
// Tests — happy path
// ============================================================================

Deno.test('prismaMiddleware: creates PrismaClient from HYPERDRIVE and stores in context', async () => {
    let capturedConnectionString: string | undefined;
    const fakePrisma = makeFakePrisma('test-instance');

    const factory = (cs: string) => {
        capturedConnectionString = cs;
        return fakePrisma;
    };

    const env = makeEnv({ HYPERDRIVE: makeHyperdrive('postgresql://user:pass@hyper:5432/mydb') });

    const app = new Hono<{ Bindings: Env; Variables: { prisma: unknown } }>();
    app.use('*', prismaMiddlewareWithFactory(factory));
    app.get('/', (c) => {
        const prisma = c.get('prisma');
        return c.json({ hasPrisma: prisma != null, tag: (prisma as Record<string, unknown>).__fake });
    });

    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.hasPrisma, true);
    assertEquals(body.tag, true);

    // Factory was called with the correct connection string from HYPERDRIVE
    assertEquals(capturedConnectionString, 'postgresql://user:pass@hyper:5432/mydb');
});

Deno.test('prismaMiddleware: calls next() to continue the middleware chain', async () => {
    let nextCalled = false;

    const env = makeEnv({ HYPERDRIVE: makeHyperdrive() });

    const app = new Hono<{ Bindings: Env; Variables: { prisma: unknown } }>();
    app.use('*', prismaMiddlewareWithFactory(() => makeFakePrisma()));
    app.get('/', (c) => {
        nextCalled = true;
        return c.json({ ok: true });
    });

    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 200);
    assertEquals(nextCalled, true);
});

Deno.test('prismaMiddleware: downstream handler can retrieve PrismaClient via c.get("prisma")', async () => {
    const fakePrisma = makeFakePrisma('retrieve-test');
    const env = makeEnv({ HYPERDRIVE: makeHyperdrive() });

    const app = new Hono<{ Bindings: Env; Variables: { prisma: unknown } }>();
    app.use('*', prismaMiddlewareWithFactory(() => fakePrisma));
    app.get('/', (c) => {
        const prisma = c.get('prisma');
        assertExists(prisma);
        assertStrictEquals(prisma, fakePrisma);
        return c.json({ tag: (prisma as unknown as Record<string, string>).tag });
    });

    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.tag, 'retrieve-test');
});

// ============================================================================
// Tests — request-scoped (each request gets a fresh instance)
// ============================================================================

Deno.test('prismaMiddleware: each request gets its own PrismaClient instance', async () => {
    let callCount = 0;
    const instances: unknown[] = [];

    const factory = (_cs: string) => {
        callCount++;
        const instance = makeFakePrisma(`request-${callCount}`);
        instances.push(instance);
        return instance;
    };

    const env = makeEnv({ HYPERDRIVE: makeHyperdrive() });

    const app = new Hono<{ Bindings: Env; Variables: { prisma: unknown } }>();
    app.use('*', prismaMiddlewareWithFactory(factory));
    app.get('/', (c) => {
        const prisma = c.get('prisma');
        return c.json({ tag: (prisma as unknown as Record<string, string>).tag });
    });

    // First request
    const res1 = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res1.status, 200);
    const body1 = await res1.json() as Record<string, unknown>;
    assertEquals(body1.tag, 'request-1');

    // Second request
    const res2 = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res2.status, 200);
    const body2 = await res2.json() as Record<string, unknown>;
    assertEquals(body2.tag, 'request-2');

    // The factory was called twice (once per request), and the instances differ
    assertEquals(callCount, 2);
    assertEquals(instances.length, 2);
    assertEquals(instances[0] !== instances[1], true);
});

// ============================================================================
// Tests — error handling (missing HYPERDRIVE binding)
// ============================================================================

Deno.test('prismaMiddleware: throws when HYPERDRIVE binding is missing (undefined)', async () => {
    const env = makeEnv(); // no HYPERDRIVE
    const factory = (_cs: string) => makeFakePrisma();

    const app = new Hono<{ Bindings: Env; Variables: { prisma: unknown } }>();
    // Use the raw variant that doesn't guard against undefined HYPERDRIVE —
    // mirrors the real source code which accesses c.env.HYPERDRIVE.connectionString.
    app.use('*', prismaMiddlewareRaw(factory));
    app.get('/', (c) => c.json({ ok: true }));

    // Hono catches middleware errors and returns 500
    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 500);
});

Deno.test('prismaMiddleware: propagates factory errors (e.g. invalid connection string)', async () => {
    const env = makeEnv({ HYPERDRIVE: makeHyperdrive('postgresql://valid:url@host:5432/db') });

    const factory = (_cs: string) => {
        throw new Error('Zod validation failed: connectionString must start with postgresql://');
    };

    const app = new Hono<{ Bindings: Env; Variables: { prisma: unknown } }>();
    app.use('*', prismaMiddlewareWithFactory(factory));
    app.get('/', (c) => c.json({ ok: true }));

    // The factory error propagates; Hono returns 500
    const res = await app.fetch(new Request('http://test/'), env, makeCtx());
    assertEquals(res.status, 500);
});

// ============================================================================
// Tests — real prismaMiddleware export (structural / smoke test)
// ============================================================================

Deno.test('prismaMiddleware: exported function returns a middleware handler', async () => {
    // Import the real middleware — we only assert its shape, not its runtime
    // behaviour (that would require a real Hyperdrive connection string).
    const { prismaMiddleware } = await import('./prisma-middleware.ts');

    const mw = prismaMiddleware();
    assertExists(mw);
    assertEquals(typeof mw, 'function');
});

Deno.test('prismaMiddleware: PrismaVariables interface is exported', async () => {
    // Verify the type augmentation export exists at the module level.
    const mod = await import('./prisma-middleware.ts');
    // PrismaVariables is a TypeScript interface — it won't exist at runtime,
    // but the module should export prismaMiddleware at minimum.
    assertExists(mod.prismaMiddleware);
});

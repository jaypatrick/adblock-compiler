/**
 * Unit tests for `dispatchToDynamicWorker`, `isDynamicWorkerAvailable`,
 * `runAstParseInDynamicWorker`, `runValidateInDynamicWorker`, and
 * `getOrCreateUserAgent`.
 *
 * These tests run directly under `deno test` — no Cloudflare Workers runtime
 * is required because all loader / fetch calls are stubbed.
 */

import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import type { Env } from '../types.ts';
import type { DynamicWorkerTask } from './types.ts';
import { dispatchToDynamicWorker, getOrCreateUserAgent, isDynamicWorkerAvailable, runAstParseInDynamicWorker, runValidateInDynamicWorker } from './loader.ts';

// ============================================================================
// Helpers
// ============================================================================

type PartialEnv = Partial<Env> & Record<string, unknown>;

function makeFetchHandle(response: Response) {
    return {
        fetch: (_req: Request) => Promise.resolve(response),
    };
}

function makeLoader(handle: { fetch: (req: Request) => Promise<Response> }) {
    return {
        load: (_source: string, _opts?: unknown) => Promise.resolve(handle),
    };
}

const minimalTask: DynamicWorkerTask = {
    type: 'ast-parse',
    payload: { rules: ['||example.com^'] },
    requestId: 'test-req-1',
};

// ============================================================================
// dispatchToDynamicWorker
// ============================================================================

Deno.test('dispatchToDynamicWorker - throws when DYNAMIC_WORKER_LOADER binding is missing', async () => {
    const env: PartialEnv = {
        COMPILATION_CACHE: {} as unknown as KVNamespace,
        RATE_LIMIT: {} as unknown as KVNamespace,
        COMPILER_VERSION: '1.0.0',
    };

    await assertRejects(
        () => dispatchToDynamicWorker(env as Env, 'export default {}', minimalTask),
        Error,
        'DYNAMIC_WORKER_LOADER binding is not configured',
    );
});

Deno.test('dispatchToDynamicWorker - throws when source is empty string', async () => {
    const env: PartialEnv = {
        DYNAMIC_WORKER_LOADER: makeLoader(makeFetchHandle(new Response('', { status: 200 }))),
    };

    await assertRejects(
        () => dispatchToDynamicWorker(env as Env, '', minimalTask),
        Error,
        'Dynamic Worker source must be a non-empty string',
    );
});

Deno.test('dispatchToDynamicWorker - throws when source is only whitespace', async () => {
    const env: PartialEnv = {
        DYNAMIC_WORKER_LOADER: makeLoader(makeFetchHandle(new Response('', { status: 200 }))),
    };

    await assertRejects(
        () => dispatchToDynamicWorker(env as Env, '   ', minimalTask),
        Error,
        'Dynamic Worker source must be a non-empty string',
    );
});

Deno.test('dispatchToDynamicWorker - throws with status when dynamic worker returns non-2xx', async () => {
    const env: PartialEnv = {
        DYNAMIC_WORKER_LOADER: makeLoader(makeFetchHandle(new Response('boom', { status: 500 }))),
        COMPILATION_CACHE: {} as unknown as KVNamespace,
        RATE_LIMIT: {} as unknown as KVNamespace,
        COMPILER_VERSION: '1.0.0',
    };

    const err = await assertRejects(
        () => dispatchToDynamicWorker(env as Env, 'export default {}', minimalTask),
        Error,
    );
    assertStringIncludes(err.message, 'Dynamic Worker returned 500');
    assertStringIncludes(err.message, 'boom');
});

Deno.test('dispatchToDynamicWorker - returns parsed JSON on success', async () => {
    const payload = { parsedRules: [], summary: { total: 0, successful: 0, failed: 0, byCategory: {}, byType: {} } };
    const env: PartialEnv = {
        DYNAMIC_WORKER_LOADER: makeLoader(
            makeFetchHandle(
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            ),
        ),
        COMPILATION_CACHE: {} as unknown as KVNamespace,
        RATE_LIMIT: {} as unknown as KVNamespace,
        COMPILER_VERSION: '2.0.0',
    };

    const result = await dispatchToDynamicWorker<typeof payload>(env as Env, 'export default {}', minimalTask);
    assertEquals(result, payload);
});

Deno.test('dispatchToDynamicWorker - forwards only intended bindings (not full env)', async () => {
    let capturedBindings: Record<string, unknown> | undefined;

    const fakeLoader = {
        load: (
            _source: string,
            opts?: { bindings?: Record<string, unknown> },
        ) => {
            capturedBindings = opts?.bindings;
            return Promise.resolve(
                makeFetchHandle(
                    new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
                ),
            );
        },
    };

    const env: PartialEnv = {
        DYNAMIC_WORKER_LOADER: fakeLoader,
        COMPILATION_CACHE: { id: 'cache' } as unknown as KVNamespace,
        RATE_LIMIT: { id: 'rl' } as unknown as KVNamespace,
        COMPILER_VERSION: '3.0.0',
        // Bindings that must NOT be forwarded:
        ADMIN_DB: {} as unknown as D1Database,
        BETTER_AUTH_SECRET: 'super-secret',
    };

    await dispatchToDynamicWorker(env as Env, 'export default {}', minimalTask);

    assertEquals(capturedBindings?.COMPILER_VERSION, '3.0.0');
    assertEquals(Object.prototype.hasOwnProperty.call(capturedBindings, 'ADMIN_DB'), false);
    assertEquals(Object.prototype.hasOwnProperty.call(capturedBindings, 'BETTER_AUTH_SECRET'), false);
});

// ============================================================================
// isDynamicWorkerAvailable
// ============================================================================

Deno.test('isDynamicWorkerAvailable - returns false when DYNAMIC_WORKER_LOADER is absent', () => {
    const env: PartialEnv = {};
    assertEquals(isDynamicWorkerAvailable(env as Env), false);
});

Deno.test('isDynamicWorkerAvailable - returns false when DYNAMIC_WORKER_LOADER is undefined', () => {
    const env: PartialEnv = { DYNAMIC_WORKER_LOADER: undefined };
    assertEquals(isDynamicWorkerAvailable(env as Env), false);
});

Deno.test('isDynamicWorkerAvailable - returns true when DYNAMIC_WORKER_LOADER is present', () => {
    const env: PartialEnv = {
        DYNAMIC_WORKER_LOADER: makeLoader(makeFetchHandle(new Response('', { status: 200 }))),
    };
    assertEquals(isDynamicWorkerAvailable(env as Env), true);
});

// ============================================================================
// Model B helpers — LOADER (DynamicDispatchNamespace)
// ============================================================================

/**
 * Builds a mock DynamicDispatchNamespace that always resolves to `entrypoint`
 * for both `load()` and `get()`. `isLoaderAvailable()` requires both functions
 * to be present, so the mock must implement both.
 */
function makeLoaderNamespace(response: Response) {
    const entrypoint = { fetch: (_req: Request) => Promise.resolve(response.clone()) };
    return {
        load: (_opts: unknown) => Promise.resolve(entrypoint),
        get: (_id: string, _factory: unknown) => Promise.resolve(entrypoint),
    };
}

// ── runAstParseInDynamicWorker ───────────────────────────────────────────────

Deno.test('runAstParseInDynamicWorker - returns null when LOADER is absent', async () => {
    const env: PartialEnv = {};
    const result = await runAstParseInDynamicWorker({ rules: ['||example.com^'] }, env as Env);
    assertEquals(result, null);
});

Deno.test('runAstParseInDynamicWorker - returns null when LOADER has no load() or get()', async () => {
    const env: PartialEnv = { LOADER: {} as unknown as typeof env.LOADER };
    const result = await runAstParseInDynamicWorker({ rules: [] }, env as Env);
    assertEquals(result, null);
});

Deno.test('runAstParseInDynamicWorker - returns success result with data on 200', async () => {
    const payload = { success: true, parsedRules: [{ ruleText: '||example.com^', success: true }], summary: { total: 1 } };
    const env: PartialEnv = {
        LOADER: makeLoaderNamespace(
            new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        ),
    };
    const result = await runAstParseInDynamicWorker({ rules: ['||example.com^'] }, env as Env);
    assertEquals(result?.success, true);
    assertEquals(result?.status, 200);
    assertEquals(result?.data, payload);
});

Deno.test('runAstParseInDynamicWorker - propagates non-2xx status on isolate failure', async () => {
    const errorPayload = { error: 'Rate limited by isolate' };
    const env: PartialEnv = {
        LOADER: makeLoaderNamespace(
            new Response(JSON.stringify(errorPayload), {
                status: 429,
                headers: { 'Content-Type': 'application/json' },
            }),
        ),
    };
    const result = await runAstParseInDynamicWorker({ rules: ['||example.com^'] }, env as Env);
    assertEquals(result?.success, false);
    assertEquals(result?.status, 429);
    assertEquals(result?.error, 'Rate limited by isolate');
});

Deno.test('runAstParseInDynamicWorker - parses message field from JSON error body', async () => {
    const env: PartialEnv = {
        LOADER: makeLoaderNamespace(
            new Response(JSON.stringify({ message: 'Internal isolate error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }),
        ),
    };
    const result = await runAstParseInDynamicWorker({}, env as Env);
    assertEquals(result?.success, false);
    assertEquals(result?.error, 'Internal isolate error');
});

Deno.test('runAstParseInDynamicWorker - returns failure result when loader.load throws', async () => {
    const env: PartialEnv = {
        LOADER: {
            load: () => Promise.reject(new Error('Isolate spawn failed')),
            get: () => Promise.reject(new Error('Isolate spawn failed')),
        } as unknown as typeof env.LOADER,
    };
    const result = await runAstParseInDynamicWorker({}, env as Env);
    assertEquals(result?.success, false);
    assertStringIncludes(result?.error ?? '', 'Isolate spawn failed');
});

Deno.test('runAstParseInDynamicWorker - isolate receives no bindings', async () => {
    let capturedOptions: unknown;
    const fakeLoader = {
        load: (opts: unknown) => {
            capturedOptions = opts;
            return Promise.resolve({
                fetch: (_req: Request) => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
            });
        },
        get: (_id: string, _factory: unknown) => Promise.reject(new Error('not used')),
    };
    const env: PartialEnv = {
        LOADER: fakeLoader as unknown as typeof env.LOADER,
        COMPILATION_CACHE: { id: 'cache' } as unknown as KVNamespace,
    };
    await runAstParseInDynamicWorker({ rules: ['||example.com^'] }, env as Env);
    // AST/validate isolates must receive empty bindings — no KV/secrets granted.
    assertEquals((capturedOptions as { bindings?: Record<string, unknown> })?.bindings, {});
});

// ── runValidateInDynamicWorker ───────────────────────────────────────────────

Deno.test('runValidateInDynamicWorker - returns null when LOADER is absent', async () => {
    const env: PartialEnv = {};
    const result = await runValidateInDynamicWorker({ rules: [] }, env as Env);
    assertEquals(result, null);
});

Deno.test('runValidateInDynamicWorker - returns success result on 200', async () => {
    const payload = { success: true, valid: true, totalRules: 1, validRules: 1, invalidRules: 0 };
    const env: PartialEnv = {
        LOADER: makeLoaderNamespace(
            new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        ),
    };
    const result = await runValidateInDynamicWorker({ rules: ['||example.com^'] }, env as Env);
    assertEquals(result?.success, true);
    assertEquals(result?.status, 200);
    assertEquals(result?.data, payload);
});

Deno.test('runValidateInDynamicWorker - propagates non-2xx status', async () => {
    const env: PartialEnv = {
        LOADER: makeLoaderNamespace(
            new Response(JSON.stringify({ message: 'Bad input' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            }),
        ),
    };
    const result = await runValidateInDynamicWorker({ rules: ['bad rule'] }, env as Env);
    assertEquals(result?.success, false);
    assertEquals(result?.status, 400);
    assertEquals(result?.error, 'Bad input');
});

Deno.test('runValidateInDynamicWorker - returns failure result when loader throws', async () => {
    const env: PartialEnv = {
        LOADER: {
            load: () => Promise.reject(new Error('Validate isolate failed')),
            get: () => Promise.reject(new Error('not used')),
        } as unknown as typeof env.LOADER,
    };
    const result = await runValidateInDynamicWorker({ rules: ['||example.com^'] }, env as Env);
    assertEquals(result?.success, false);
    assertStringIncludes(result?.error ?? '', 'Validate isolate failed');
});

// ── getOrCreateUserAgent ─────────────────────────────────────────────────────

Deno.test('getOrCreateUserAgent - returns null when LOADER is absent', async () => {
    const env: PartialEnv = {};
    const req = new Request('https://example.com/agents/mcp-agent/user-123');
    const result = await getOrCreateUserAgent('user-123', req, env as Env);
    assertEquals(result, null);
});

Deno.test('getOrCreateUserAgent - returns response from agent Worker on success', async () => {
    const agentResp = new Response(JSON.stringify({ message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
    const env: PartialEnv = {
        LOADER: makeLoaderNamespace(agentResp),
        COMPILATION_CACHE: { id: 'cache' } as unknown as KVNamespace,
    };
    const req = new Request('https://example.com/agents/mcp-agent/user-123');
    const result = await getOrCreateUserAgent('user-123', req, env as Env);
    assertEquals(result?.status, 200);
});

Deno.test('getOrCreateUserAgent - returns null when loader.get throws', async () => {
    const env: PartialEnv = {
        LOADER: {
            load: () => Promise.reject(new Error('not used')),
            get: () => Promise.reject(new Error('Agent spawn failed')),
        } as unknown as typeof env.LOADER,
    };
    const req = new Request('https://example.com/agents/mcp-agent/user-123');
    const result = await getOrCreateUserAgent('user-123', req, env as Env);
    assertEquals(result, null);
});

Deno.test('getOrCreateUserAgent - forwards only COMPILATION_CACHE and METRICS bindings', async () => {
    let capturedBindings: Record<string, unknown> | undefined;
    const fakeLoader = {
        load: () => Promise.reject(new Error('not used')),
        get: (_id: string, factory: (id: string) => { bindings?: Record<string, unknown> }) => {
            const opts = factory(_id);
            capturedBindings = opts.bindings;
            return Promise.resolve({
                fetch: (_req: Request) => Promise.resolve(new Response('ok', { status: 200 })),
            });
        },
    };
    const env: PartialEnv = {
        LOADER: fakeLoader as unknown as typeof env.LOADER,
        COMPILATION_CACHE: { id: 'cache' } as unknown as KVNamespace,
        METRICS: { id: 'metrics' } as unknown as KVNamespace,
        ADMIN_DB: {} as unknown as D1Database,
        BETTER_AUTH_SECRET: 'super-secret',
    };
    const req = new Request('https://example.com/agents/mcp-agent/user-123');
    await getOrCreateUserAgent('user-123', req, env as Env);
    assertEquals(Object.prototype.hasOwnProperty.call(capturedBindings, 'COMPILATION_CACHE'), true);
    assertEquals(Object.prototype.hasOwnProperty.call(capturedBindings, 'METRICS'), true);
    assertEquals(Object.prototype.hasOwnProperty.call(capturedBindings, 'ADMIN_DB'), false);
    assertEquals(Object.prototype.hasOwnProperty.call(capturedBindings, 'BETTER_AUTH_SECRET'), false);
});

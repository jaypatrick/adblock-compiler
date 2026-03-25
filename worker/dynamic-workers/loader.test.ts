/**
 * Unit tests for `dispatchToDynamicWorker` and `isDynamicWorkerAvailable`.
 *
 * These tests run directly under `deno test` — no Cloudflare Workers runtime
 * is required because all loader / fetch calls are stubbed.
 */

import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import type { Env } from '../types.ts';
import type { DynamicWorkerTask } from './types.ts';
import { dispatchToDynamicWorker, isDynamicWorkerAvailable } from './loader.ts';

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

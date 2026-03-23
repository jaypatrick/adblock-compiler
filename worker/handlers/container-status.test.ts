/**
 * Tests for the container status handler.
 *
 * Covers:
 *   - handleContainerStatus: returns 'unavailable' when ADBLOCK_COMPILER binding is missing
 *   - handleContainerStatus: returns 'running' when container /health responds 200
 *   - handleContainerStatus: extracts version from /health body
 *   - handleContainerStatus: returns 'error' when container /health responds non-200
 *   - handleContainerStatus: returns 'starting' on AbortError (3s timeout)
 *   - handleContainerStatus: returns 'error' for unexpected fetch failure
 *   - handleContainerStatus: returns valid ISO checkedAt timestamp in all cases
 *   - Route: GET /container/status returns 200 with Cache-Control header
 *
 * @see worker/handlers/container-status.ts
 */

import { assertEquals, assertExists, assertMatch } from '@std/assert';
import { app } from '../hono-app.ts';
import { makeEnv } from '../test-helpers.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

async function fetchStatus(env: ReturnType<typeof makeEnv>): Promise<Response> {
    const req = new Request('https://worker.example.com/container/status');
    return app.fetch(req, env, makeCtx());
}

/** Minimal DurableObjectNamespace stub whose stub.fetch returns the given Response. */
function makeDOWithFetch(stubFetch: (req: Request) => Promise<Response>): DurableObjectNamespace {
    const stub = {
        fetch: stubFetch,
    };
    return {
        idFromName: (_name: string) => ({ toString: () => 'fake-id' } as DurableObjectId),
        get: (_id: DurableObjectId) => stub,
    } as unknown as DurableObjectNamespace;
}

/** Stub that returns a healthy /health response with optional version. */
function makeHealthyDO(version?: string): DurableObjectNamespace {
    return makeDOWithFetch(async (_req) => {
        const body = version ? JSON.stringify({ version }) : JSON.stringify({ ok: true });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
}

/** Stub that returns a non-200 response. */
function makeErrorDO(): DurableObjectNamespace {
    return makeDOWithFetch(async (_req) => new Response('Service Unavailable', { status: 503 }));
}

/** Stub that throws an AbortError (simulating the 3s timeout). */
function makeTimeoutDO(): DurableObjectNamespace {
    return makeDOWithFetch(async (_req) => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        throw err;
    });
}

/** Stub that throws an unexpected non-AbortError. */
function makeUnexpectedErrorDO(): DurableObjectNamespace {
    return makeDOWithFetch(async (_req) => {
        throw new Error('Unexpected internal error');
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('GET /container/status — 200 with Cache-Control header', async () => {
    const env = makeEnv(); // no ADBLOCK_COMPILER
    const res = await fetchStatus(env);
    assertEquals(res.status, 200);
    assertExists(res.headers.get('Cache-Control'));
});

Deno.test('handleContainerStatus — unavailable when ADBLOCK_COMPILER binding is missing', async () => {
    const env = makeEnv(); // no ADBLOCK_COMPILER
    const res = await fetchStatus(env);
    const body = await res.json() as { status: string; checkedAt: string };
    assertEquals(body.status, 'unavailable');
    assertMatch(body.checkedAt, /^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
});

Deno.test('handleContainerStatus — running when container /health responds 200', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: makeHealthyDO() });
    const res = await fetchStatus(env);
    const body = await res.json() as { status: string; latencyMs: number; checkedAt: string };
    assertEquals(body.status, 'running');
    assertExists(body.latencyMs);
    assertMatch(body.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test('handleContainerStatus — version is extracted from /health body', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: makeHealthyDO('1.2.3') });
    const res = await fetchStatus(env);
    const body = await res.json() as { status: string; version: string };
    assertEquals(body.status, 'running');
    assertEquals(body.version, '1.2.3');
});

Deno.test('handleContainerStatus — error when container /health responds non-200', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: makeErrorDO() });
    const res = await fetchStatus(env);
    const body = await res.json() as { status: string };
    assertEquals(body.status, 'error');
});

Deno.test('handleContainerStatus — starting on AbortError (3s timeout)', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: makeTimeoutDO() });
    const res = await fetchStatus(env);
    const body = await res.json() as { status: string };
    assertEquals(body.status, 'starting');
});

Deno.test('handleContainerStatus — error for unexpected non-AbortError fetch failure', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: makeUnexpectedErrorDO() });
    const res = await fetchStatus(env);
    const body = await res.json() as { status: string };
    assertEquals(body.status, 'error');
});

Deno.test('handleContainerStatus — checkedAt is always a valid ISO timestamp', async () => {
    const env = makeEnv(); // unavailable path
    const res = await fetchStatus(env);
    const body = await res.json() as { checkedAt: string };
    assertEquals(isNaN(Date.parse(body.checkedAt)), false);
});

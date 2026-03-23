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
 *   - handleContainerStatus: includes valid ISO checkedAt timestamp in all responses
 *   - handleContainerStatus: includes latencyMs in responses from container paths
 *
 * Note: the `containerFetch` parameter is used to inject a stub for the
 * container's /health endpoint, bypassing @cloudflare/containers (which cannot
 * be resolved in Deno's test environment due to CJS-style internal imports).
 *
 * @see worker/handlers/container-status.ts
 */

import { assertEquals, assertExists, assertMatch } from '@std/assert';
import { handleContainerStatus } from './container-status.ts';
import { makeEnv } from '../test-helpers.ts';

// ── Stub helpers ──────────────────────────────────────────────────────────────

/** Container fetch stub that returns a healthy 200 response with optional version. */
function healthyFetch(version?: string): (req: Request) => Promise<Response> {
    return async (_req) => {
        const body = version ? JSON.stringify({ version }) : JSON.stringify({ ok: true });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
}

/** Container fetch stub that returns a non-200 response. */
const errorFetch = async (_req: Request): Promise<Response> =>
    new Response('Service Unavailable', { status: 503 });

/** Container fetch stub that throws an AbortError (simulating the 3s timeout). */
const timeoutFetch = async (_req: Request): Promise<Response> => {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    throw err;
};

/** Container fetch stub that throws an unexpected non-AbortError. */
const unexpectedErrorFetch = async (_req: Request): Promise<Response> => {
    throw new Error('Unexpected internal error');
};

/** Minimal DurableObjectNamespace stub — sufficient for env type satisfaction. */
const stubNs = {} as DurableObjectNamespace;

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('handleContainerStatus — unavailable when ADBLOCK_COMPILER binding is missing', async () => {
    const env = makeEnv(); // no ADBLOCK_COMPILER
    const res = await handleContainerStatus(env);
    const body = await res.json() as { status: string; checkedAt: string };
    assertEquals(body.status, 'unavailable');
    assertMatch(body.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test('handleContainerStatus — running when container /health responds 200', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: stubNs });
    const res = await handleContainerStatus(env, healthyFetch());
    const body = await res.json() as { status: string; latencyMs: number; checkedAt: string };
    assertEquals(body.status, 'running');
    assertExists(body.latencyMs);
    assertMatch(body.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test('handleContainerStatus — version is extracted from /health body', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: stubNs });
    const res = await handleContainerStatus(env, healthyFetch('1.2.3'));
    const body = await res.json() as { status: string; version: string };
    assertEquals(body.status, 'running');
    assertEquals(body.version, '1.2.3');
});

Deno.test('handleContainerStatus — error when container /health responds non-200', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: stubNs });
    const res = await handleContainerStatus(env, errorFetch);
    const body = await res.json() as { status: string };
    assertEquals(body.status, 'error');
});

Deno.test('handleContainerStatus — starting on AbortError (3s timeout)', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: stubNs });
    const res = await handleContainerStatus(env, timeoutFetch);
    const body = await res.json() as { status: string };
    assertEquals(body.status, 'starting');
});

Deno.test('handleContainerStatus — error for unexpected non-AbortError fetch failure', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: stubNs });
    const res = await handleContainerStatus(env, unexpectedErrorFetch);
    const body = await res.json() as { status: string };
    assertEquals(body.status, 'error');
});

Deno.test('handleContainerStatus — checkedAt is always a valid ISO timestamp', async () => {
    const env = makeEnv(); // unavailable path (no import of @cloudflare/containers)
    const res = await handleContainerStatus(env);
    const body = await res.json() as { checkedAt: string };
    assertEquals(isNaN(Date.parse(body.checkedAt)), false);
});

Deno.test('handleContainerStatus — latencyMs present in running response', async () => {
    const env = makeEnv({ ADBLOCK_COMPILER: stubNs });
    const res = await handleContainerStatus(env, healthyFetch());
    const body = await res.json() as { status: string; latencyMs: number };
    assertEquals(body.status, 'running');
    assertEquals(typeof body.latencyMs, 'number');
});

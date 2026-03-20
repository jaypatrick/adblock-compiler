/**
 * Comprehensive unit tests for handleQueueCancel
 *
 * The cancel handler is best-effort and idempotent: it writes a
 * `queue:cancel:<requestId>` signal to METRICS for queue consumers to
 * check, and always returns 200 for authenticated requests with a valid
 * requestId. No 404/409 are returned because no `queue:job:*` records
 * are written by enqueue paths.
 *
 * Tests:
 *   - Returns 401 when called anonymously (no auth)
 *   - Returns 400 for an invalid requestId format (contains `..`)
 *   - Returns 400 for an empty requestId
 *   - Returns 400 for a requestId with spaces
 *   - Returns 200 { cancelled: true, requestId } for any valid authenticated request
 *   - Writes a `queue:cancel:<requestId>` KV record on success
 *   - Emits an analytics security event on success
 */

import { assertEquals, assertExists } from '@std/assert';
import { makeEnv, makeInMemoryKv } from '../test-helpers.ts';
import { handleQueueCancel } from './queue.ts';
import type { IAuthContext } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';

// ============================================================================
// Fixtures
// ============================================================================

const ANONYMOUS_CTX: IAuthContext = { authMethod: 'anonymous', tier: 'anonymous' } as unknown as IAuthContext;
const AUTH_CTX: IAuthContext = { authMethod: 'clerk-jwt', tier: 'free', userId: 'user-test' } as unknown as IAuthContext;

function makeRequest(requestId: string): Request {
    return new Request(`http://localhost/api/queue/cancel/${requestId}`, { method: 'DELETE' });
}

function makeAnalytics(): { events: unknown[]; service: AnalyticsService } {
    const events: unknown[] = [];
    const service = {
        trackSecurityEvent: (event: unknown) => {
            events.push(event);
        },
    } as unknown as AnalyticsService;
    return { events, service };
}

// ============================================================================
// Auth
// ============================================================================

Deno.test('handleQueueCancel - returns 401 when called anonymously', async () => {
    const env = makeEnv();
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-001'), env, ANONYMOUS_CTX, service, 'req-001');
    assertEquals(res.status, 401);
});

// ============================================================================
// Validation
// ============================================================================

Deno.test('handleQueueCancel - returns 400 for requestId with invalid chars (..)', async () => {
    const env = makeEnv();
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('bad..id'), env, AUTH_CTX, service, 'bad..id');
    assertEquals(res.status, 400);
});

Deno.test('handleQueueCancel - returns 400 for empty requestId', async () => {
    const env = makeEnv();
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest(''), env, AUTH_CTX, service, '');
    assertEquals(res.status, 400);
});

Deno.test('handleQueueCancel - returns 400 for requestId with spaces', async () => {
    const env = makeEnv();
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('bad id'), env, AUTH_CTX, service, 'bad id');
    assertEquals(res.status, 400);
});

// ============================================================================
// Happy path — best-effort signal (no 404/409)
// ============================================================================

Deno.test('handleQueueCancel - returns 200 with cancelled:true for any valid authenticated request', async () => {
    const kv = makeInMemoryKv();
    const env = makeEnv({ METRICS: kv });
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-pending'), env, AUTH_CTX, service, 'req-pending');
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; cancelled: boolean; requestId: string };
    assertEquals(body.success, true);
    assertEquals(body.cancelled, true);
    assertEquals(body.requestId, 'req-pending');
});

Deno.test('handleQueueCancel - returns 200 even when no job record exists (best-effort)', async () => {
    const env = makeEnv({ METRICS: makeInMemoryKv() });
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-nonexistent'), env, AUTH_CTX, service, 'req-nonexistent');
    assertEquals(res.status, 200);
    const body = await res.json() as { cancelled: boolean };
    assertEquals(body.cancelled, true);
});

Deno.test('handleQueueCancel - writes queue:cancel:<requestId> signal to KV', async () => {
    const kv = makeInMemoryKv();
    const env = makeEnv({ METRICS: kv });
    const { service } = makeAnalytics();
    await handleQueueCancel(makeRequest('req-signal'), env, AUTH_CTX, service, 'req-signal');
    const signal = await kv.get('queue:cancel:req-signal', 'json') as { status: string; requestId: string } | null;
    assertExists(signal);
    assertEquals(signal!.status, 'cancelled');
    assertEquals(signal!.requestId, 'req-signal');
});

Deno.test('handleQueueCancel - emits analytics audit event on success', async () => {
    const kv = makeInMemoryKv();
    const env = makeEnv({ METRICS: kv });
    const { events, service } = makeAnalytics();
    await handleQueueCancel(makeRequest('req-audit'), env, AUTH_CTX, service, 'req-audit');
    assertEquals(events.length > 0, true);
    const event = events[0] as { reason: string };
    assertEquals(event.reason, 'queue_job_cancelled');
});

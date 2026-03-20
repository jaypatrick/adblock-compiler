/**
 * Comprehensive unit tests for handleQueueCancel
 *
 * Tests:
 *   - Returns 401 when called anonymously
 *   - Returns 400 for an invalid requestId format
 *   - Returns 404 when the job key is not found in KV
 *   - Returns 409 when job exists but status is 'completed'
 *   - Returns 409 when job exists but status is 'failed'
 *   - Returns 200 { cancelled: true, requestId } when job is 'pending'
 *   - Verifies updateQueueStats is called (via KV mutation)
 *   - Verifies analytics security event is emitted
 */

import { assertEquals, assertExists } from '@std/assert';
import { makeEnv, makeInMemoryKv, makeKv } from '../test-helpers.ts';
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
        trackSecurityEvent: (event: unknown) => { events.push(event); },
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
// KV lookup — not found
// ============================================================================

Deno.test('handleQueueCancel - returns 404 when job key not found in KV', async () => {
    const env = makeEnv({ METRICS: makeKv(null) });
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-notfound'), env, AUTH_CTX, service, 'req-notfound');
    assertEquals(res.status, 404);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

// ============================================================================
// KV lookup — non-pending status
// ============================================================================

Deno.test('handleQueueCancel - returns 409 when job status is completed', async () => {
    const job = { status: 'completed', requestId: 'req-done' };
    const kv = makeInMemoryKv(new Map([['queue:job:req-done', JSON.stringify(job)]]));
    const env = makeEnv({ METRICS: kv });
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-done'), env, AUTH_CTX, service, 'req-done');
    assertEquals(res.status, 409);
    const body = await res.json() as { success: boolean; status: string };
    assertEquals(body.success, false);
    assertEquals(body.status, 'completed');
});

Deno.test('handleQueueCancel - returns 409 when job status is failed', async () => {
    const job = { status: 'failed', requestId: 'req-fail' };
    const kv = makeInMemoryKv(new Map([['queue:job:req-fail', JSON.stringify(job)]]));
    const env = makeEnv({ METRICS: kv });
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-fail'), env, AUTH_CTX, service, 'req-fail');
    assertEquals(res.status, 409);
    const body = await res.json() as { success: boolean; status: string };
    assertEquals(body.status, 'failed');
});

Deno.test('handleQueueCancel - returns 409 when job already cancelled', async () => {
    const job = { status: 'cancelled', requestId: 'req-already' };
    const kv = makeInMemoryKv(new Map([['queue:job:req-already', JSON.stringify(job)]]));
    const env = makeEnv({ METRICS: kv });
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-already'), env, AUTH_CTX, service, 'req-already');
    assertEquals(res.status, 409);
});

// ============================================================================
// Happy path
// ============================================================================

Deno.test('handleQueueCancel - returns 200 with cancelled:true for pending job', async () => {
    const job = { status: 'pending', requestId: 'req-pending' };
    const kv = makeInMemoryKv(new Map([
        ['queue:job:req-pending', JSON.stringify(job)],
        ['queue:stats', JSON.stringify({ pending: 1, completed: 0, failed: 0, cancelled: 0, history: [], depthHistory: [], totalProcessingTime: 0, averageProcessingTime: 0, processingRate: 0, queueLag: 0, lastUpdate: '' })],
    ]));
    const env = makeEnv({ METRICS: kv });
    const { service } = makeAnalytics();
    const res = await handleQueueCancel(makeRequest('req-pending'), env, AUTH_CTX, service, 'req-pending');
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; cancelled: boolean; requestId: string };
    assertEquals(body.success, true);
    assertEquals(body.cancelled, true);
    assertEquals(body.requestId, 'req-pending');
});

Deno.test('handleQueueCancel - updates KV job status to cancelled', async () => {
    const job = { status: 'pending', requestId: 'req-kv-check' };
    const kv = makeInMemoryKv(new Map([
        ['queue:job:req-kv-check', JSON.stringify(job)],
        ['queue:stats', JSON.stringify({ pending: 1, completed: 0, failed: 0, cancelled: 0, history: [], depthHistory: [], totalProcessingTime: 0, averageProcessingTime: 0, processingRate: 0, queueLag: 0, lastUpdate: '' })],
    ]));
    const env = makeEnv({ METRICS: kv });
    const { service } = makeAnalytics();
    await handleQueueCancel(makeRequest('req-kv-check'), env, AUTH_CTX, service, 'req-kv-check');
    const updated = await kv.get('queue:job:req-kv-check', 'json') as { status: string } | null;
    assertExists(updated);
    assertEquals(updated!.status, 'cancelled');
});

Deno.test('handleQueueCancel - emits analytics security event on success', async () => {
    const job = { status: 'pending', requestId: 'req-audit' };
    const kv = makeInMemoryKv(new Map([
        ['queue:job:req-audit', JSON.stringify(job)],
        ['queue:stats', JSON.stringify({ pending: 1, completed: 0, failed: 0, cancelled: 0, history: [], depthHistory: [], totalProcessingTime: 0, averageProcessingTime: 0, processingRate: 0, queueLag: 0, lastUpdate: '' })],
    ]));
    const env = makeEnv({ METRICS: kv });
    const { events, service } = makeAnalytics();
    await handleQueueCancel(makeRequest('req-audit'), env, AUTH_CTX, service, 'req-audit');
    assertEquals(events.length > 0, true);
    const event = events[0] as { eventType: string | undefined; reason: string };
    assertEquals(event.reason, 'queue_job_cancelled');
});

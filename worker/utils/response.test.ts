/**
 * Tests for the centralized JSON response utility.
 *
 * Covers:
 *  - JsonResponse.success — 200 with { success: true }
 *  - JsonResponse.error — configurable status with { success: false }
 *  - JsonResponse.badRequest — 400
 *  - JsonResponse.unauthorized — 401, no WWW-Authenticate header (X-Admin-Key removed in ZTA cleanup)
 *  - JsonResponse.forbidden — 403
 *  - JsonResponse.notFound — 404
 *  - JsonResponse.rateLimited — 429 + Retry-After header
 *  - JsonResponse.serverError — 500
 *  - JsonResponse.serviceUnavailable — 503
 *  - JsonResponse.accepted — 202
 *  - JsonResponse.cached — 200 with Cache-Control
 *  - JsonResponse.noCache — 200 with Cache-Control: no-cache
 *  - Custom headers are forwarded
 */

import { assertEquals, assertExists } from '@std/assert';
import { JsonResponse } from './response.ts';

// ─── success ────────────────────────────────────────────────────────────────

Deno.test('JsonResponse.success — returns 200 with success:true', async () => {
    const res = JsonResponse.success({ data: 'hello' });
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; data: string };
    assertEquals(body.success, true);
    assertEquals(body.data, 'hello');
});

Deno.test('JsonResponse.success — accepts custom status', async () => {
    const res = JsonResponse.success({ foo: 1 }, { status: 201 });
    assertEquals(res.status, 201);
});

Deno.test('JsonResponse.success — merges data with success flag', async () => {
    const res = JsonResponse.success({ count: 42 });
    const body = await res.json() as { success: boolean; count: number };
    assertEquals(body.count, 42);
    assertEquals(body.success, true);
});

// ─── error ──────────────────────────────────────────────────────────────────

Deno.test('JsonResponse.error — defaults to 500 with success:false', async () => {
    const res = JsonResponse.error('Something went wrong');
    assertEquals(res.status, 500);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('JsonResponse.error — uses provided status code', async () => {
    const res = JsonResponse.error('bad input', 422);
    assertEquals(res.status, 422);
});

Deno.test('JsonResponse.error — extracts message from Error object', async () => {
    const res = JsonResponse.error(new Error('typed error'));
    const body = await res.json() as { error: string };
    assertEquals(body.error, 'typed error');
});

// ─── badRequest ─────────────────────────────────────────────────────────────

Deno.test('JsonResponse.badRequest — returns 400', async () => {
    const res = JsonResponse.badRequest('invalid param');
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

// ─── unauthorized ────────────────────────────────────────────────────────────

Deno.test('JsonResponse.unauthorized — returns 401 with default message', async () => {
    const res = JsonResponse.unauthorized();
    assertEquals(res.status, 401);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertEquals(body.error, 'Unauthorized');
});

Deno.test('JsonResponse.unauthorized — accepts custom error message', async () => {
    const res = JsonResponse.unauthorized('Token expired');
    const body = await res.json() as { error: string };
    assertEquals(body.error, 'Token expired');
});

Deno.test('JsonResponse.unauthorized — does NOT set WWW-Authenticate header (ZTA: X-Admin-Key removed)', () => {
    const res = JsonResponse.unauthorized();
    // ZTA cleanup: the legacy WWW-Authenticate: X-Admin-Key header was removed
    // to prevent leaking auth scheme details and to align with JWT/token-based auth.
    assertEquals(res.headers.get('WWW-Authenticate'), null);
});

// ─── forbidden ──────────────────────────────────────────────────────────────

Deno.test('JsonResponse.forbidden — returns 403', async () => {
    const res = JsonResponse.forbidden('Insufficient permissions');
    assertEquals(res.status, 403);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

// ─── notFound ───────────────────────────────────────────────────────────────

Deno.test('JsonResponse.notFound — returns 404 with default message', async () => {
    const res = JsonResponse.notFound();
    assertEquals(res.status, 404);
    const body = await res.json() as { error: string };
    assertEquals(body.error, 'Not found');
});

Deno.test('JsonResponse.notFound — accepts custom message', async () => {
    const res = JsonResponse.notFound('Resource not found');
    const body = await res.json() as { error: string };
    assertEquals(body.error, 'Resource not found');
});

// ─── rateLimited ─────────────────────────────────────────────────────────────

Deno.test('JsonResponse.rateLimited — returns 429 with Retry-After header', () => {
    const res = JsonResponse.rateLimited(30);
    assertEquals(res.status, 429);
    assertEquals(res.headers.get('Retry-After'), '30');
});

Deno.test('JsonResponse.rateLimited — defaults Retry-After to 60 seconds', () => {
    const res = JsonResponse.rateLimited();
    assertEquals(res.headers.get('Retry-After'), '60');
});

Deno.test('JsonResponse.rateLimited — body has success:false', async () => {
    const res = JsonResponse.rateLimited();
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

// ─── serverError ─────────────────────────────────────────────────────────────

Deno.test('JsonResponse.serverError — returns 500', async () => {
    const res = JsonResponse.serverError('Internal error');
    assertEquals(res.status, 500);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

// ─── serviceUnavailable ──────────────────────────────────────────────────────

Deno.test('JsonResponse.serviceUnavailable — returns 503', async () => {
    const res = JsonResponse.serviceUnavailable('DB unavailable');
    assertEquals(res.status, 503);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

// ─── accepted ────────────────────────────────────────────────────────────────

Deno.test('JsonResponse.accepted — returns 202 with success:true', async () => {
    const res = JsonResponse.accepted({ jobId: 'abc' });
    assertEquals(res.status, 202);
    const body = await res.json() as { success: boolean; jobId: string };
    assertEquals(body.success, true);
    assertEquals(body.jobId, 'abc');
});

// ─── cached ──────────────────────────────────────────────────────────────────

Deno.test('JsonResponse.cached — returns 200 with public Cache-Control', () => {
    const res = JsonResponse.cached({ data: 'x' }, 300);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Cache-Control'), 'public, max-age=300');
});

// ─── noCache ─────────────────────────────────────────────────────────────────

Deno.test('JsonResponse.noCache — returns 200 with no-cache Cache-Control', () => {
    const res = JsonResponse.noCache({ data: 'x' });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Cache-Control'), 'no-cache');
});

// ─── custom headers ──────────────────────────────────────────────────────────

Deno.test('JsonResponse.success — forwards custom headers from options', () => {
    const res = JsonResponse.success({ ok: true }, {
        headers: { 'X-Custom': 'value' },
    });
    assertEquals(res.headers.get('X-Custom'), 'value');
});

Deno.test('JsonResponse.error — forwards custom headers from options', () => {
    const res = JsonResponse.error('err', 500, {
        headers: { 'X-Request-Id': 'req-1' },
    });
    assertEquals(res.headers.get('X-Request-Id'), 'req-1');
});

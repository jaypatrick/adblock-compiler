/**
 * Tests for the RFC 9457 Problem Details response factory.
 *
 * Covers:
 *  - Content-Type is always `application/problem+json`
 *  - Each named factory method returns the correct HTTP status
 *  - Body conforms to the ProblemDetails interface (type, title, status, detail, instance)
 *  - ProblemResponse.rateLimited — sets `Retry-After` header
 *  - ProblemResponse.internalServerError — includes `requestId` extension field
 *  - ProblemResponse.create — low-level factory passes through arbitrary extensions
 *  - ProblemResponse.turnstileRejection — returns 403 with dedicated problem type
 *  - ProblemResponse.adblockDetected — returns 403 with adblock-detected type
 *  - Custom headers are forwarded via options
 */

import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPE_BASE, PROBLEM_TYPES, ProblemResponse } from './problem-details.ts';
import type { ProblemDetails } from './problem-details.ts';

// ── helpers ──────────────────────────────────────────────────────────────────

async function parseBody(res: Response): Promise<ProblemDetails> {
    return await res.json() as ProblemDetails;
}

// ── Content-Type contract ────────────────────────────────────────────────────

Deno.test('ProblemResponse — Content-Type is application/problem+json on all methods', async () => {
    const cases: Response[] = [
        ProblemResponse.badRequest('/foo'),
        ProblemResponse.unauthorized('/foo'),
        ProblemResponse.forbidden('/foo'),
        ProblemResponse.notFound('/foo'),
        ProblemResponse.payloadTooLarge('/foo'),
        ProblemResponse.rateLimited('/foo', 30),
        ProblemResponse.internalServerError('/foo'),
        ProblemResponse.serviceUnavailable('/foo'),
        ProblemResponse.turnstileRejection('/foo'),
        ProblemResponse.adblockDetected('/foo'),
    ];

    for (const res of cases) {
        const ct = res.headers.get('Content-Type') ?? '';
        assertStringIncludes(ct, PROBLEM_CONTENT_TYPE, `Expected ${PROBLEM_CONTENT_TYPE} but got "${ct}"`);
        // Drain body to avoid leaking
        await res.text();
    }
});

// ── badRequest ───────────────────────────────────────────────────────────────

Deno.test('ProblemResponse.badRequest — returns 400', async () => {
    const res = ProblemResponse.badRequest('/api/compile');
    assertEquals(res.status, 400);
    const body = await parseBody(res);
    assertEquals(body.status, 400);
    assertEquals(body.type, PROBLEM_TYPES.badRequest);
    assertEquals(body.title, 'Bad Request');
    assertEquals(body.instance, '/api/compile');
    assertExists(body.detail);
});

Deno.test('ProblemResponse.badRequest — accepts custom detail', async () => {
    const res = ProblemResponse.badRequest('/api/compile', 'Missing required field: sources');
    const body = await parseBody(res);
    assertEquals(body.detail, 'Missing required field: sources');
});

// ── unauthorized ─────────────────────────────────────────────────────────────

Deno.test('ProblemResponse.unauthorized — returns 401', async () => {
    const res = ProblemResponse.unauthorized('/api/rules');
    assertEquals(res.status, 401);
    const body = await parseBody(res);
    assertEquals(body.status, 401);
    assertEquals(body.type, PROBLEM_TYPES.unauthorized);
    assertEquals(body.title, 'Unauthorized');
});

// ── forbidden ────────────────────────────────────────────────────────────────

Deno.test('ProblemResponse.forbidden — returns 403', async () => {
    const res = ProblemResponse.forbidden('/api/admin');
    assertEquals(res.status, 403);
    const body = await parseBody(res);
    assertEquals(body.status, 403);
    assertEquals(body.type, PROBLEM_TYPES.forbidden);
    assertEquals(body.title, 'Forbidden');
});

// ── turnstileRejection ───────────────────────────────────────────────────────

Deno.test('ProblemResponse.turnstileRejection — returns 403 with turnstile type', async () => {
    const res = ProblemResponse.turnstileRejection('/api/compile');
    assertEquals(res.status, 403);
    const body = await parseBody(res);
    assertEquals(body.status, 403);
    assertEquals(body.type, PROBLEM_TYPES.turnstileRejection);
    assertEquals(body.title, 'Turnstile Verification Failed');
    assertEquals(body.instance, '/api/compile');
});

Deno.test('ProblemResponse.turnstileRejection — includes adblocker guidance in default detail', async () => {
    const res = ProblemResponse.turnstileRejection('/api/compile');
    const body = await parseBody(res);
    assertStringIncludes(body.detail as string, 'adblocker');
});

// ── adblockDetected ──────────────────────────────────────────────────────────

Deno.test('ProblemResponse.adblockDetected — returns 403 with adblock-detected type', async () => {
    const res = ProblemResponse.adblockDetected('/api/compile');
    assertEquals(res.status, 403);
    const body = await parseBody(res);
    assertEquals(body.status, 403);
    assertEquals(body.type, PROBLEM_TYPES.adblockDetected);
    assertEquals(body.title, 'Adblock Detected');
    assertEquals(body.instance, '/api/compile');
});

Deno.test('ProblemResponse.adblockDetected — default detail mentions content-filtering', async () => {
    const res = ProblemResponse.adblockDetected('/api/compile');
    const body = await parseBody(res);
    assertStringIncludes(body.detail as string, 'content-filtering');
});

// ── notFound ─────────────────────────────────────────────────────────────────

Deno.test('ProblemResponse.notFound — returns 404', async () => {
    const res = ProblemResponse.notFound('/api/rules/99');
    assertEquals(res.status, 404);
    const body = await parseBody(res);
    assertEquals(body.status, 404);
    assertEquals(body.type, PROBLEM_TYPES.notFound);
    assertEquals(body.title, 'Not Found');
    assertEquals(body.instance, '/api/rules/99');
});

// ── payloadTooLarge ──────────────────────────────────────────────────────────

Deno.test('ProblemResponse.payloadTooLarge — returns 413', async () => {
    const res = ProblemResponse.payloadTooLarge('/api/compile');
    assertEquals(res.status, 413);
    const body = await parseBody(res);
    assertEquals(body.status, 413);
    assertEquals(body.type, PROBLEM_TYPES.payloadTooLarge);
    assertEquals(body.title, 'Payload Too Large');
});

// ── rateLimited ──────────────────────────────────────────────────────────────

Deno.test('ProblemResponse.rateLimited — returns 429 with Retry-After header', async () => {
    const res = ProblemResponse.rateLimited('/api/compile', 30);
    assertEquals(res.status, 429);
    assertEquals(res.headers.get('Retry-After'), '30');
    const body = await parseBody(res);
    assertEquals(body.status, 429);
    assertEquals(body.type, PROBLEM_TYPES.rateLimited);
    assertEquals(body.title, 'Too Many Requests');
    assertEquals(body.instance, '/api/compile');
    assertEquals(body['retryAfter'], 30);
});

Deno.test('ProblemResponse.rateLimited — custom detail overrides default', async () => {
    const res = ProblemResponse.rateLimited('/api/compile', 60, 'Custom message');
    const body = await parseBody(res);
    assertEquals(body.detail, 'Custom message');
});

Deno.test('ProblemResponse.rateLimited — Retry-After header reflects retryAfterSecs', () => {
    const res = ProblemResponse.rateLimited('/api/compile', 120);
    assertEquals(res.headers.get('Retry-After'), '120');
});

Deno.test('ProblemResponse.rateLimited — default detail uses singular "second" when retryAfterSecs is 1', async () => {
    const res = ProblemResponse.rateLimited('/api/compile', 1);
    const body = await parseBody(res);
    assertStringIncludes(body.detail as string, '1 second');
    assertEquals((body.detail as string).includes('1 seconds'), false);
});

// ── internalServerError ──────────────────────────────────────────────────────

Deno.test('ProblemResponse.internalServerError — returns 500', async () => {
    const res = ProblemResponse.internalServerError('/api/compile');
    assertEquals(res.status, 500);
    const body = await parseBody(res);
    assertEquals(body.status, 500);
    assertEquals(body.type, PROBLEM_TYPES.internalServerError);
    assertEquals(body.title, 'Internal Server Error');
});

Deno.test('ProblemResponse.internalServerError — includes requestId extension when provided', async () => {
    const res = ProblemResponse.internalServerError('/api/compile', 'req-abc-123');
    const body = await parseBody(res);
    assertEquals(body['requestId'], 'req-abc-123');
});

Deno.test('ProblemResponse.internalServerError — omits requestId when not provided', async () => {
    const res = ProblemResponse.internalServerError('/api/compile');
    const body = await parseBody(res);
    assertEquals(body['requestId'], undefined);
});

// ── serviceUnavailable ───────────────────────────────────────────────────────

Deno.test('ProblemResponse.serviceUnavailable — returns 503', async () => {
    const res = ProblemResponse.serviceUnavailable('/api/compile');
    assertEquals(res.status, 503);
    const body = await parseBody(res);
    assertEquals(body.status, 503);
    assertEquals(body.type, PROBLEM_TYPES.serviceUnavailable);
    assertEquals(body.title, 'Service Unavailable');
});

// ── create (low-level) ───────────────────────────────────────────────────────

Deno.test('ProblemResponse.create — passes through extension fields', async () => {
    const res = ProblemResponse.create({
        type: `${PROBLEM_TYPE_BASE}/custom`,
        title: 'Custom Problem',
        status: 422,
        detail: 'Custom detail',
        instance: '/api/custom',
        customField: 'customValue',
    });
    assertEquals(res.status, 422);
    const body = await parseBody(res);
    assertEquals(body.type, `${PROBLEM_TYPE_BASE}/custom`);
    assertEquals(body.title, 'Custom Problem');
    assertEquals(body['customField'], 'customValue');
});

// ── custom headers ────────────────────────────────────────────────────────────

Deno.test('ProblemResponse — forwards custom headers from options', async () => {
    const res = ProblemResponse.forbidden('/api/admin', 'Tier too low', {
        headers: { 'X-Request-Id': 'req-xyz' },
    });
    assertEquals(res.headers.get('X-Request-Id'), 'req-xyz');
    // Content-Type must still be problem+json even when extra headers are set
    assertStringIncludes(res.headers.get('Content-Type') ?? '', PROBLEM_CONTENT_TYPE);
    await res.text();
});

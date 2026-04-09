/**
 * Tests for ProblemDetailsService.
 *
 * Covers:
 *   - isProblemContentType: recognises application/problem+json variants
 *   - isFromFetchHeaders: detects RFC 9457 from fetch Headers
 *   - parse: validates and returns ProblemDetails, returns null for invalid
 *   - messageFromBody: prefers detail > title > fallback
 *   - isAdblockProblem: returns true only for adblock/turnstile problem types
 *   - extractMessage: reads detail from problem+json responses
 *   - extractMessage: falls back to legacy { error } envelope
 *   - extractMessage: falls back to statusText when body is unreadable
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import {
    ProblemDetailsService,
    PROBLEM_CONTENT_TYPE,
    CLIENT_PROBLEM_TYPES,
} from './problem-details.service';
import type { ProblemDetails } from './problem-details.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes(body: unknown, contentType: string, status = 400): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': contentType },
    });
}

const MINIMAL_PROBLEM: ProblemDetails = {
    type: CLIENT_PROBLEM_TYPES.badRequest,
    title: 'Bad Request',
    status: 400,
};

const FULL_PROBLEM: ProblemDetails = {
    type: CLIENT_PROBLEM_TYPES.rateLimited,
    title: 'Too Many Requests',
    status: 429,
    detail: 'Retry after 30 seconds.',
    instance: '/api/compile',
    retryAfter: 30,
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ProblemDetailsService', () => {
    let service: ProblemDetailsService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideZonelessChangeDetection(), ProblemDetailsService],
        });
        service = TestBed.inject(ProblemDetailsService);
    });

    // ── isProblemContentType ──────────────────────────────────────────────────

    describe('isProblemContentType', () => {
        it('returns true for bare application/problem+json', () => {
            expect(ProblemDetailsService.isProblemContentType(PROBLEM_CONTENT_TYPE)).toBe(true);
        });

        it('returns true when charset suffix is present', () => {
            expect(ProblemDetailsService.isProblemContentType('application/problem+json; charset=utf-8')).toBe(true);
        });

        it('returns false for application/json', () => {
            expect(ProblemDetailsService.isProblemContentType('application/json')).toBe(false);
        });

        it('returns false for null', () => {
            expect(ProblemDetailsService.isProblemContentType(null)).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(ProblemDetailsService.isProblemContentType('')).toBe(false);
        });
    });

    // ── isFromFetchHeaders ────────────────────────────────────────────────────

    describe('isFromFetchHeaders', () => {
        it('returns true when Content-Type is application/problem+json', () => {
            const h = new Headers({ 'Content-Type': PROBLEM_CONTENT_TYPE });
            expect(ProblemDetailsService.isFromFetchHeaders(h)).toBe(true);
        });

        it('returns false when Content-Type is application/json', () => {
            const h = new Headers({ 'Content-Type': 'application/json' });
            expect(ProblemDetailsService.isFromFetchHeaders(h)).toBe(false);
        });
    });

    // ── parse ─────────────────────────────────────────────────────────────────

    describe('parse', () => {
        it('returns a ProblemDetails object for a valid minimal problem', () => {
            const result = ProblemDetailsService.parse(MINIMAL_PROBLEM);
            expect(result).not.toBeNull();
            expect(result?.type).toBe(CLIENT_PROBLEM_TYPES.badRequest);
            expect(result?.status).toBe(400);
        });

        it('returns a ProblemDetails object for a full problem with extensions', () => {
            const result = ProblemDetailsService.parse(FULL_PROBLEM);
            expect(result?.retryAfter).toBe(30);
            expect(result?.instance).toBe('/api/compile');
        });

        it('passes through unknown extension fields', () => {
            const withExt = { ...MINIMAL_PROBLEM, customField: 'hello' };
            const result = ProblemDetailsService.parse(withExt) as Record<string, unknown>;
            expect(result?.['customField']).toBe('hello');
        });

        it('returns null when type is missing', () => {
            const invalid = { title: 'Bad', status: 400 };
            expect(ProblemDetailsService.parse(invalid)).toBeNull();
        });

        it('returns null for a non-object value', () => {
            expect(ProblemDetailsService.parse('not an object')).toBeNull();
            expect(ProblemDetailsService.parse(null)).toBeNull();
            expect(ProblemDetailsService.parse(42)).toBeNull();
        });
    });

    // ── messageFromBody ───────────────────────────────────────────────────────

    describe('messageFromBody', () => {
        it('returns detail when present', () => {
            const msg = ProblemDetailsService.messageFromBody(FULL_PROBLEM);
            expect(msg).toBe('Retry after 30 seconds.');
        });

        it('falls back to title when detail is absent', () => {
            const msg = ProblemDetailsService.messageFromBody(MINIMAL_PROBLEM);
            expect(msg).toBe('Bad Request');
        });
    });

    // ── isAdblockProblem ──────────────────────────────────────────────────────

    describe('isAdblockProblem', () => {
        it('returns true for adblockDetected type', () => {
            const p: ProblemDetails = { type: CLIENT_PROBLEM_TYPES.adblockDetected, title: 'Adblock Detected', status: 403 };
            expect(ProblemDetailsService.isAdblockProblem(p)).toBe(true);
        });

        it('returns true for turnstileRejection type', () => {
            const p: ProblemDetails = { type: CLIENT_PROBLEM_TYPES.turnstileRejection, title: 'Turnstile Failed', status: 403 };
            expect(ProblemDetailsService.isAdblockProblem(p)).toBe(true);
        });

        it('returns false for a rate-limited problem', () => {
            expect(ProblemDetailsService.isAdblockProblem(FULL_PROBLEM)).toBe(false);
        });

        it('returns false for a forbidden problem', () => {
            const p: ProblemDetails = { type: CLIENT_PROBLEM_TYPES.forbidden, title: 'Forbidden', status: 403 };
            expect(ProblemDetailsService.isAdblockProblem(p)).toBe(false);
        });
    });

    // ── extractMessage ────────────────────────────────────────────────────────

    describe('extractMessage', () => {
        it('reads detail from application/problem+json response', async () => {
            const res = makeRes(FULL_PROBLEM, PROBLEM_CONTENT_TYPE, 429);
            const msg = await service.extractMessage(res);
            expect(msg).toBe('Retry after 30 seconds.');
        });

        it('falls back to title when detail absent in problem+json', async () => {
            const res = makeRes(MINIMAL_PROBLEM, PROBLEM_CONTENT_TYPE, 400);
            const msg = await service.extractMessage(res);
            expect(msg).toBe('Bad Request');
        });

        it('falls back to legacy { error } envelope for application/json', async () => {
            const res = makeRes({ success: false, error: 'Something broke' }, 'application/json', 500);
            const msg = await service.extractMessage(res);
            expect(msg).toBe('Something broke');
        });

        it('falls back to statusText when body is unreadable', async () => {
            const res = new Response('not-json', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' },
            });
            const msg = await service.extractMessage(res);
            expect(msg).toBe('Service Unavailable');
        });

        it('falls back to unknown error when statusText is empty', async () => {
            const res = new Response('', { status: 500, headers: { 'Content-Type': 'application/json' } });
            // Empty body — JSON.parse('') throws
            const msg = await service.extractMessage(res);
            expect(msg).toBe('Unknown error');
        });
    });
});

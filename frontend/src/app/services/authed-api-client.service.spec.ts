/**
 * Tests for AuthedApiClientService
 *
 * Covers:
 *   - Service instantiation
 *   - getHeaders(): includes X-Trace-ID on all calls
 *   - getHeaders(): attaches Bearer token when signed in
 *   - getHeaders(): skips Authorization when not signed in
 *   - getHeaders(): throws when signed in but token is null
 *   - compile(): forwards request, returns parsed JSON
 *   - compile(): throws on non-ok response
 *   - validateRules(): forwards request, returns parsed JSON
 *   - validateRule(): forwards request, returns parsed JSON
 *   - listRules(): GET request with auth headers
 *   - createRuleSet(): POST request with auth headers
 *   - compileAsync(): uses fetch directly, attaches auth headers
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthedApiClientService } from './authed-api-client.service';
import { AuthFacadeService } from './auth-facade.service';
import { LogService } from './log.service';
import { API_BASE_URL } from '../tokens';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRACE_ID = 'trace-abc-123';
const BEARER = 'sess_mock_bearer_token';

/** Create a Response stub from a plain object. */
function makeRes(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

function buildAuthMock(signedIn = true, token: string | null = BEARER): Partial<AuthFacadeService> {
    return {
        isSignedIn: signal(signedIn).asReadonly() as AuthFacadeService['isSignedIn'],
        getToken: vi.fn().mockResolvedValue(token),
    };
}

function buildLogMock(): Partial<LogService> {
    return {
        sessionId: TRACE_ID,
        warn: vi.fn(),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthedApiClientService', () => {
    let service: AuthedApiClientService;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    function setup(authOverrides: Partial<AuthFacadeService> = {}) {
        const authMock = { ...buildAuthMock(), ...authOverrides };
        const logMock = buildLogMock();

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                AuthedApiClientService,
                { provide: AuthFacadeService, useValue: authMock },
                { provide: LogService, useValue: logMock },
                { provide: API_BASE_URL, useValue: '/api' },
            ],
        });
        service = TestBed.inject(AuthedApiClientService);
    }

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should be created', () => {
        setup();
        expect(service).toBeTruthy();
    });

    // ── getHeaders ─────────────────────────────────────────────────────────────

    describe('compile()', () => {
        it('attaches Authorization and X-Trace-ID when signed in', async () => {
            setup();
            const mockResult = { success: true, ruleCount: 42, compiledAt: '2025-01-01T00:00:00Z' };
            fetchSpy.mockResolvedValueOnce(makeRes(mockResult));

            await service.compile({
                configuration: {
                    name: 'Test',
                    sources: [{ source: 'https://example.com/list.txt' }],
                    transformations: ['RemoveComments'],
                },
            });

            expect(fetchSpy).toHaveBeenCalledOnce();
            const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const headers = init?.headers as Record<string, string>;
            expect(headers['Authorization']).toBe(`Bearer ${BEARER}`);
            expect(headers['X-Trace-ID']).toBe(TRACE_ID);
        });

        it('omits Authorization when not signed in', async () => {
            setup(buildAuthMock(false, null));
            const mockResult = { success: true, ruleCount: 0, compiledAt: '2025-01-01T00:00:00Z' };
            fetchSpy.mockResolvedValueOnce(makeRes(mockResult));

            await service.compile({
                configuration: {
                    name: 'Anon Test',
                    sources: [{ source: 'https://example.com/list.txt' }],
                    transformations: [],
                },
            });

            const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const headers = init?.headers as Record<string, string>;
            expect(headers['Authorization']).toBeUndefined();
            expect(headers['X-Trace-ID']).toBe(TRACE_ID);
        });

        it('throws when signed in but getToken() returns null', async () => {
            setup(buildAuthMock(true, null));

            await expect(
                service.compile({
                    configuration: {
                        name: 'Test',
                        sources: [],
                        transformations: [],
                    },
                }),
            ).rejects.toThrow('Session token unavailable');
        });

        it('throws on non-ok response', async () => {
            setup();
            fetchSpy.mockResolvedValueOnce(makeRes({ success: false, error: 'Rate limit exceeded' }, 429));

            await expect(
                service.compile({
                    configuration: {
                        name: 'Test',
                        sources: [{ source: 'https://example.com/list.txt' }],
                        transformations: [],
                    },
                }),
            ).rejects.toThrow('429');
        });

        it('returns parsed compile result', async () => {
            setup();
            const expected = { success: true, ruleCount: 1337, rules: ['||example.com^'], compiledAt: '2026-01-01T00:00:00Z' };
            fetchSpy.mockResolvedValueOnce(makeRes(expected));

            const result = await service.compile({
                configuration: {
                    name: 'Test',
                    sources: [{ source: 'https://example.com/list.txt' }],
                    transformations: [],
                },
            });
            expect(result.ruleCount).toBe(1337);
            expect(result.success).toBe(true);
        });
    });

    // ── validateRules ──────────────────────────────────────────────────────────

    describe('validateRules()', () => {
        it('sends rules to POST /api/validate with auth headers', async () => {
            setup();
            const mockResult = { success: true, valid: true, totalRules: 2, validRules: 2, invalidRules: 0, errors: [], warnings: [] };
            fetchSpy.mockResolvedValueOnce(makeRes(mockResult));

            const result = await service.validateRules({ rules: ['||example.com^', '||ads.com^'] });

            expect(result.valid).toBe(true);
            expect(result.totalRules).toBe(2);
            const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const headers = init?.headers as Record<string, string>;
            expect(headers['Authorization']).toBe(`Bearer ${BEARER}`);
        });
    });

    // ── validateRule ───────────────────────────────────────────────────────────

    describe('validateRule()', () => {
        it('sends single rule to POST /api/validate-rule', async () => {
            setup();
            const mockResult = { success: true, valid: true, rule: '||example.com^' };
            fetchSpy.mockResolvedValueOnce(makeRes(mockResult));

            const result = await service.validateRule({ rule: '||example.com^' });

            expect(result.valid).toBe(true);
            const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('validate-rule');
        });
    });

    // ── listRules ──────────────────────────────────────────────────────────────

    describe('listRules()', () => {
        it('calls GET /api/rules with auth headers', async () => {
            setup();
            const mockResult = { success: true, ruleSets: [] };
            fetchSpy.mockResolvedValueOnce(makeRes(mockResult));

            const result = await service.listRules();

            expect(result.ruleSets).toEqual([]);
            const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/rules');
            expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(`Bearer ${BEARER}`);
        });
    });

    // ── createRuleSet ──────────────────────────────────────────────────────────

    describe('createRuleSet()', () => {
        it('calls POST /api/rules with auth headers and body', async () => {
            setup();
            const mockRuleSet = { id: 'rs-1', name: 'My List', description: undefined, rules: ['||example.com^'], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' };
            fetchSpy.mockResolvedValueOnce(makeRes({ success: true, ruleSet: mockRuleSet }));

            const result = await service.createRuleSet({ name: 'My List', rules: ['||example.com^'] });

            expect(result.success).toBe(true);
            expect(result.ruleSet.name).toBe('My List');
        });
    });

    // ── compileAsync ───────────────────────────────────────────────────────────

    describe('compileAsync()', () => {
        it('uses fetch directly for /api/compile/async', async () => {
            setup();
            const mockResult = { success: true, requestId: 'req-abc123', note: 'Queued', message: 'Processing' };
            fetchSpy.mockResolvedValueOnce(makeRes(mockResult));

            const result = await service.compileAsync({
                configuration: {
                    name: 'Async Test',
                    sources: [{ source: 'https://example.com/list.txt' }],
                    transformations: [],
                },
            });

            expect(result.requestId).toBe('req-abc123');
            const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('compile/async');
            expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(`Bearer ${BEARER}`);
        });

        it('throws on non-ok async response', async () => {
            setup();
            fetchSpy.mockResolvedValueOnce(makeRes({ error: 'Queue unavailable' }, 503));

            await expect(
                service.compileAsync({
                    configuration: { name: 'Test', sources: [], transformations: [] },
                }),
            ).rejects.toThrow('503');
        });
    });
});

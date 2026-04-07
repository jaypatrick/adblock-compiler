/**
 * Tests for TrpcClientService
 *
 * Covers:
 *   - Service instantiation
 *   - tRPC client is callable and returns typed results
 *   - Authorization header is attached when AuthFacadeService.getToken() returns a token
 *   - No Authorization header when getToken() returns null
 *   - Base URL is correctly derived from API_BASE_URL (strips /api suffix)
 *   - Public procedures (v1.version.get) work without auth
 *   - Authenticated procedures (v1.compile.json) attach auth headers
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrpcClientService } from './trpc-client.service';
import { AuthFacadeService } from './auth-facade.service';
import { API_BASE_URL } from '../tokens';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrpcClientService', () => {
    let service: TrpcClientService;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    function setup(authOverrides: Partial<AuthFacadeService> = {}, baseUrl = '/api') {
        const authMock = { ...buildAuthMock(), ...authOverrides };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                TrpcClientService,
                { provide: AuthFacadeService, useValue: authMock },
                { provide: API_BASE_URL, useValue: baseUrl },
            ],
        });
        service = TestBed.inject(TrpcClientService);
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

    it('should expose a typed client property', () => {
        setup();
        expect(service.client).toBeDefined();
        expect(service.client.v1).toBeDefined();
        expect(service.client.v1.version).toBeDefined();
        expect(service.client.v1.health).toBeDefined();
        expect(service.client.v1.compile).toBeDefined();
    });

    // ── Base URL derivation ────────────────────────────────────────────────────

    describe('base URL derivation', () => {
        it('strips /api suffix from browser base URL', async () => {
            setup(buildAuthMock(false, null), '/api');
            const mockResult = { version: '0.79.4', apiVersion: 'v1' };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            await service.client.v1.version.get.query();

            const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
            // URL should be /api/trpc/v1.version.get (after stripping /api and re-appending /api/trpc)
            expect(url).toContain('/api/trpc');
        });

        it('strips /api/ suffix (with trailing slash) from SSR base URL', async () => {
            setup(buildAuthMock(false, null), 'https://adblock-compiler.example.workers.dev/api/');
            const mockResult = { version: '0.79.4', apiVersion: 'v1' };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            await service.client.v1.version.get.query();

            const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('https://adblock-compiler.example.workers.dev/api/trpc');
        });
    });

    // ── Public procedure (v1.version.get) ─────────────────────────────────────

    describe('v1.version.get (public query)', () => {
        it('calls the tRPC endpoint and returns typed result', async () => {
            setup(buildAuthMock(false, null));
            const mockResult = { version: '0.79.4', apiVersion: 'v1' };
            // tRPC batch response format: array with single result object
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            const result = await service.client.v1.version.get.query();

            expect(result).toEqual(mockResult);
            expect(fetchSpy).toHaveBeenCalledOnce();
            const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
            expect(url).toContain('/api/trpc/v1.version.get');
        });

        it('does NOT attach Authorization header when not signed in', async () => {
            setup(buildAuthMock(false, null));
            const mockResult = { version: '0.79.4', apiVersion: 'v1' };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            await service.client.v1.version.get.query();

            const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const headers = init?.headers as Record<string, string>;
            expect(headers?.['Authorization'] ?? headers?.['authorization']).toBeUndefined();
        });

        it('attaches Authorization header when signed in and token available', async () => {
            setup(buildAuthMock(true, BEARER));
            const mockResult = { version: '0.79.4', apiVersion: 'v1' };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            await service.client.v1.version.get.query();

            const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const headers = init?.headers as Record<string, string>;
            expect(headers?.['Authorization'] ?? headers?.['authorization']).toBe(`Bearer ${BEARER}`);
        });
    });

    // ── Authenticated procedure (v1.compile.json) ─────────────────────────────

    describe('v1.compile.json (authenticated mutation)', () => {
        it('attaches Authorization header when token is available', async () => {
            setup(buildAuthMock(true, BEARER));
            const mockResult = {
                success: true,
                ruleCount: 42,
                compiledAt: '2025-01-01T00:00:00Z',
            };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            await service.client.v1.compile.json.mutate({
                configuration: {
                    sources: [{ url: 'https://example.com/easylist.txt' }],
                },
            });

            expect(fetchSpy).toHaveBeenCalledOnce();
            const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const headers = init?.headers as Record<string, string>;
            expect(headers?.['Authorization'] ?? headers?.['authorization']).toBe(`Bearer ${BEARER}`);
        });

        it('does NOT attach Authorization header when token is null', async () => {
            setup(buildAuthMock(false, null));
            const mockError = {
                error: {
                    json: {
                        message: 'UNAUTHORIZED',
                        code: -32001,
                        data: { code: 'UNAUTHORIZED', httpStatus: 401, path: 'v1.compile.json' },
                    },
                },
            };
            fetchSpy.mockResolvedValueOnce(makeRes([mockError], 401));

            // The server will return 401 UNAUTHORIZED because no token is attached.
            // This test verifies that the client does NOT attach an auth header when
            // getToken() returns null.
            try {
                await service.client.v1.compile.json.mutate({
                    configuration: {
                        sources: [{ url: 'https://example.com/easylist.txt' }],
                    },
                });
            } catch {
                // Expected to throw due to UNAUTHORIZED response
            }

            const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const headers = init?.headers as Record<string, string>;
            expect(headers?.['Authorization'] ?? headers?.['authorization']).toBeUndefined();
        });

        it('returns typed compile result when authenticated', async () => {
            setup(buildAuthMock(true, BEARER));
            const expected = {
                success: true,
                ruleCount: 1337,
                rules: ['||example.com^'],
                compiledAt: '2026-01-01T00:00:00Z',
            };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: expected } }]));

            const result = await service.client.v1.compile.json.mutate({
                configuration: {
                    sources: [{ url: 'https://example.com/easylist.txt' }],
                },
            });

            expect(result.ruleCount).toBe(1337);
            expect(result.success).toBe(true);
        });
    });

    // ── Health check (v1.health.get) ──────────────────────────────────────────

    describe('v1.health.get (public query)', () => {
        it('calls the health endpoint and returns health status', async () => {
            setup(buildAuthMock(false, null));
            const mockResult = {
                healthy: true,
                timestamp: '2025-01-01T00:00:00Z',
                version: '0.79.4',
                uptime: 42000,
            };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            const result = await service.client.v1.health.get.query();

            expect(result.healthy).toBe(true);
            expect(result.version).toBe('0.79.4');
        });
    });
});

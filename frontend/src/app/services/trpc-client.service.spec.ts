/**
 * Tests for TrpcClientService
 *
 * Covers:
 *   - Service instantiation
 *   - tRPC client is callable and dispatches HTTP requests to the correct endpoint
 *   - Results are returned typed (client is TrpcTypedClient, not <any>)
 *   - Authorization header is attached when AuthFacadeService.getToken() returns a token
 *   - No Authorization header when getToken() returns null
 *   - Base URL is correctly derived from API_BASE_URL (strips /api suffix)
 *   - Public procedures (v1.version.get) work without auth
 *   - Authenticated procedures (v1.compile.json) attach auth headers
 *   - query() validates responses with Zod and throws on invalid shape
 *   - createResource() stays idle when params is undefined; calls loader when params are set; propagates validation errors
 *   - createMutation() manages loading/error/result signals and validates responses
 */

import { TestBed } from '@angular/core/testing';
import { Injector, provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrpcClientService } from './trpc-client.service';
import { AuthFacadeService } from './auth-facade.service';
import { API_BASE_URL } from '../tokens';
import { TrpcVersionGetResponseSchema, TrpcCompileJsonResponseSchema } from '../trpc/schemas';

// ── Helpers ────────────────────────────────────────────────────────────────────────────────

const BEARER = 'sess_mock_bearer_token';

/** Create a Response stub from a plain object. */
function makeRes(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ── Mocks ─────────────────────────────────────────────────────────────────────────────────

function buildAuthMock(signedIn = true, token: string | null = BEARER): Partial<AuthFacadeService> {
    return {
        isSignedIn: signal(signedIn).asReadonly() as AuthFacadeService['isSignedIn'],
        getToken: vi.fn().mockResolvedValue(token),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────

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

    // ── Base URL derivation ────────────────────────────────────────────────────────────────

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

    // ── Public procedure (v1.version.get) ──────────────────────────────────────────────────

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

    // ── Authenticated procedure (v1.compile.json) ──────────────────────────────────────────

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
                    name: 'Test List',
                    sources: [{ source: 'https://example.com/easylist.txt' }],
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
                        name: 'Test List',
                        sources: [{ source: 'https://example.com/easylist.txt' }],
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
                    name: 'Test List',
                    sources: [{ source: 'https://example.com/easylist.txt' }],
                },
            });

            expect(result.ruleCount).toBe(1337);
            expect(result.success).toBe(true);
        });
    });

    // ── Health check (v1.health.get) ─────────────────────────────────────────────────────────

    describe('v1.health.get (public query)', () => {
        it('calls the health endpoint and returns health status', async () => {
            setup(buildAuthMock(false, null));
            const mockResult = {
                status: 'healthy',
                timestamp: '2025-01-01T00:00:00Z',
                version: '0.79.4',
                services: {
                    gateway: { status: 'healthy' },
                    database: { status: 'healthy', latency_ms: 5 },
                    compiler: { status: 'healthy' },
                    auth: { status: 'healthy', provider: 'better-auth' },
                    cache: { status: 'healthy' },
                },
            };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            const result = await service.client.v1.health.get.query();

            expect(result.status).toBe('healthy');
            expect(result.version).toBe('0.79.4');
        });
    });

    // ── query() helper ──────────────────────────────────────────────────────────────────────

    describe('query(fn, schema) — validated one-shot call', () => {
        it('returns validated response when schema matches', async () => {
            setup(buildAuthMock(false, null));
            const mockResult = { version: '0.79.4', apiVersion: 'v1' };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: mockResult } }]));

            const result = await service.query(
                () => service.client.v1.version.get.query(),
                TrpcVersionGetResponseSchema,
            );

            expect(result.version).toBe('0.79.4');
            expect(result.apiVersion).toBe('v1');
        });

        it('throws when response does not match schema', async () => {
            setup(buildAuthMock(false, null));
            // Return a response missing required 'apiVersion' field
            const invalidResult = { version: '0.79.4' };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: invalidResult } }]));

            await expect(
                service.query(
                    () => service.client.v1.version.get.query(),
                    TrpcVersionGetResponseSchema,
                ),
            ).rejects.toThrow('Invalid API response from tRPC query');
        });
    });

    // ── createMutation() helper ────────────────────────────────────────────────────────────

    describe('createMutation(fn, schema) — signal-based mutation', () => {
        it('starts with loading=false, error=null, result=null', () => {
            setup();
            const mutation = service.createMutation(
                (_input: { value: number }) => Promise.resolve({ success: true }),
                TrpcVersionGetResponseSchema,
            );
            expect(mutation.loading()).toBe(false);
            expect(mutation.error()).toBeNull();
            expect(mutation.result()).toBeNull();
        });

        it('sets result on successful validated mutation', async () => {
            setup(buildAuthMock(true, BEARER));
            const expected = {
                success: true,
                ruleCount: 99,
                rules: ['||example.com^'],
                compiledAt: '2026-01-01T00:00:00Z',
            };
            fetchSpy.mockResolvedValueOnce(makeRes([{ result: { data: expected } }]));

            const mutation = service.createMutation(
                (input: Parameters<typeof service.client.v1.compile.json.mutate>[0]) =>
                    service.client.v1.compile.json.mutate(input),
                TrpcCompileJsonResponseSchema,
            );

            const result = await mutation.mutate({
                configuration: { name: 'Test', sources: [{ source: 'https://example.com/easylist.txt' }] },
            });

            expect(result.success).toBe(true);
            expect(result.ruleCount).toBe(99);
            expect(mutation.result()?.ruleCount).toBe(99);
            expect(mutation.loading()).toBe(false);
            expect(mutation.error()).toBeNull();
        });

        it('sets error signal and resets loading on network failure', async () => {
            setup(buildAuthMock(true, BEARER));

            const mutation = service.createMutation(
                (_input: { value: number }) => Promise.reject(new Error('Network error')),
                TrpcVersionGetResponseSchema,
            );

            await expect(mutation.mutate({ value: 1 })).rejects.toThrow('Network error');
            expect(mutation.loading()).toBe(false);
            expect(mutation.error()?.message).toBe('Network error');
            expect(mutation.result()).toBeNull();
        });

        it('throws and sets error when response fails Zod validation', async () => {
            setup(buildAuthMock(false, null));

            const mutation = service.createMutation(
                () => Promise.resolve({ notVersion: 'bad' }),
                TrpcVersionGetResponseSchema,
            );

            await expect(mutation.mutate(undefined as unknown as never)).rejects.toThrow('Invalid API response from tRPC mutation');
            expect(mutation.error()).not.toBeNull();
            expect(mutation.loading()).toBe(false);
        });
    });

    // ── createResource() helper ────────────────────────────────────────────────────────────

    describe('createResource(params, loader, schema) — reactive resource', () => {
        it('stays idle and never calls the loader when params is undefined', async () => {
            setup(buildAuthMock(false, null));
            const injector = TestBed.inject(Injector);
            const params = signal<string | undefined>(undefined);
            const loader = vi.fn().mockResolvedValue({ version: '1.0', apiVersion: 'v1' });

            const resource = service.createResource(params, loader, TrpcVersionGetResponseSchema, { injector });

            await TestBed.whenStable();

            expect(loader).not.toHaveBeenCalled();
            expect(resource.isLoading()).toBe(false);
            expect(resource.value()).toBeUndefined();
        });

        it('calls the loader and resolves value when params is defined', async () => {
            setup(buildAuthMock(false, null));
            const injector = TestBed.inject(Injector);
            const mockData = { version: '1.0', apiVersion: 'v1' };
            const loader = vi.fn().mockResolvedValue(mockData);
            const params = signal<string | undefined>('trigger');

            const resource = service.createResource(params, loader, TrpcVersionGetResponseSchema, { injector });

            await TestBed.whenStable();

            expect(loader).toHaveBeenCalledWith('trigger');
            expect(resource.value()).toEqual(mockData);
            expect(resource.error()).toBeUndefined();
        });

        it('enters error state when loader returns data failing schema validation', async () => {
            setup(buildAuthMock(false, null));
            const injector = TestBed.inject(Injector);
            const loader = vi.fn().mockResolvedValue({ notVersion: 'bad' });
            const params = signal<string | undefined>('trigger');

            const resource = service.createResource(params, loader, TrpcVersionGetResponseSchema, { injector });

            await TestBed.whenStable();

            expect(resource.error()).toBeDefined();
            expect((resource.error() as Error).message).toContain('Invalid API response from tRPC resource');
            expect(resource.value()).toBeUndefined();
            expect(resource.isLoading()).toBe(false);
        });
    });
});

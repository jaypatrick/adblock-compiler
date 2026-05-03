/**
 * @module neonApiService.test
 * Unit tests for the Neon API service.
 *
 * All tests mock `globalThis.fetch` — no real network calls are made.
 */

import { assertEquals, assertExists, assertRejects } from '@std/assert';
import {
    type ConnectionUriOptions,
    type CreateBranchOptions,
    createNeonApiService,
    NeonApiError,
    type NeonApiService,
    NeonApiServiceConfigSchema,
    NeonBranchSchema,
    NeonDatabaseSchema,
    NeonEndpointSchema,
    NeonProjectSchema,
} from './neonApiService.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Save the original fetch so we can restore it after each test. */
const originalFetch = globalThis.fetch;

/** Stub globalThis.fetch to return a canned JSON response. */
function stubFetch(status: number, body: unknown): void {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
    };
}

/** Stub fetch that captures the request details for assertion. */
function spyFetch(
    status: number,
    body: unknown,
): { calls: Array<{ url: string; init: RequestInit | undefined }> } {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = (input: string | URL | Request, init?: RequestInit): any => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
    };
    return { calls };
}

/** Create a service instance for testing with a dummy API key. */
function createTestService(): NeonApiService {
    return createNeonApiService({ apiKey: 'napi_test_key_12345' });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES = {
    project: {
        id: 'twilight-river-73901472',
        name: 'bloqr-backend',
        region_id: 'azure-eastus2',
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-20T12:00:00Z',
        pg_version: 17,
    },
    branch: {
        id: 'br-cool-night-abc123',
        name: 'main',
        project_id: 'twilight-river-73901472',
        parent_id: null,
        current_state: 'ready',
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-20T12:00:00Z',
    },
    endpoint: {
        id: 'ep-winter-term-a8rxh2a9',
        host: 'ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech',
        branch_id: 'br-cool-night-abc123',
        type: 'read_write' as const,
        current_state: 'active',
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-20T12:00:00Z',
    },
    database: {
        id: 1,
        name: 'neondb',
        branch_id: 'br-cool-night-abc123',
        owner_name: 'neondb_owner',
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-20T12:00:00Z',
    },
    operation: {
        id: 'op-xyz-123',
        project_id: 'twilight-river-73901472',
        branch_id: 'br-cool-night-abc123',
        action: 'create_branch',
        status: 'finished' as const,
        created_at: '2025-01-20T12:00:00Z',
        updated_at: '2025-01-20T12:01:00Z',
    },
};

// ── Tests ────────────────────────────────────────────────────────────────────

Deno.test('NeonApiService', async (t) => {
    // Restore fetch after every top-level step
    const cleanup = () => {
        // deno-lint-ignore no-explicit-any
        (globalThis as any).fetch = originalFetch;
    };

    // ── Config validation ────────────────────────────────────────────────────

    await t.step('config validation', async (t) => {
        await t.step('accepts valid config with default baseUrl', () => {
            const result = NeonApiServiceConfigSchema.safeParse({ apiKey: 'napi_abc' });
            assertEquals(result.success, true);
            if (result.success) {
                assertEquals(result.data.baseUrl, 'https://console.neon.tech/api/v2');
            }
        });

        await t.step('accepts valid config with custom baseUrl', () => {
            const result = NeonApiServiceConfigSchema.safeParse({
                apiKey: 'napi_abc',
                baseUrl: 'https://custom.neon.io/api/v2',
            });
            assertEquals(result.success, true);
            if (result.success) {
                assertEquals(result.data.baseUrl, 'https://custom.neon.io/api/v2');
            }
        });

        await t.step('rejects empty apiKey', () => {
            const result = NeonApiServiceConfigSchema.safeParse({ apiKey: '' });
            assertEquals(result.success, false);
        });

        await t.step('rejects missing apiKey', () => {
            const result = NeonApiServiceConfigSchema.safeParse({});
            assertEquals(result.success, false);
        });

        await t.step('rejects invalid baseUrl', () => {
            const result = NeonApiServiceConfigSchema.safeParse({ apiKey: 'napi_abc', baseUrl: 'not-a-url' });
            assertEquals(result.success, false);
        });
    });

    // ── Zod schema validation ────────────────────────────────────────────────

    await t.step('zod schemas', async (t) => {
        await t.step('NeonProjectSchema accepts valid project', () => {
            const result = NeonProjectSchema.safeParse(FIXTURES.project);
            assertEquals(result.success, true);
        });

        await t.step('NeonProjectSchema accepts project without pg_version', () => {
            const { pg_version: _, ...noVersion } = FIXTURES.project;
            const result = NeonProjectSchema.safeParse(noVersion);
            assertEquals(result.success, true);
        });

        await t.step('NeonProjectSchema rejects missing id', () => {
            const { id: _, ...noId } = FIXTURES.project;
            const result = NeonProjectSchema.safeParse(noId);
            assertEquals(result.success, false);
        });

        await t.step('NeonBranchSchema accepts valid branch', () => {
            const result = NeonBranchSchema.safeParse(FIXTURES.branch);
            assertEquals(result.success, true);
        });

        await t.step('NeonBranchSchema accepts null parent_id', () => {
            const result = NeonBranchSchema.safeParse({ ...FIXTURES.branch, parent_id: null });
            assertEquals(result.success, true);
        });

        await t.step('NeonBranchSchema rejects missing name', () => {
            const { name: _, ...noName } = FIXTURES.branch;
            const result = NeonBranchSchema.safeParse(noName);
            assertEquals(result.success, false);
        });

        await t.step('NeonEndpointSchema accepts valid endpoint', () => {
            const result = NeonEndpointSchema.safeParse(FIXTURES.endpoint);
            assertEquals(result.success, true);
        });

        await t.step('NeonEndpointSchema rejects invalid type', () => {
            const result = NeonEndpointSchema.safeParse({ ...FIXTURES.endpoint, type: 'invalid' });
            assertEquals(result.success, false);
        });

        await t.step('NeonDatabaseSchema accepts valid database', () => {
            const result = NeonDatabaseSchema.safeParse(FIXTURES.database);
            assertEquals(result.success, true);
        });

        await t.step('NeonDatabaseSchema rejects string id', () => {
            const result = NeonDatabaseSchema.safeParse({ ...FIXTURES.database, id: 'not-a-number' });
            assertEquals(result.success, false);
        });
    });

    // ── Factory ──────────────────────────────────────────────────────────────

    await t.step('factory', async (t) => {
        await t.step('creates service with valid config', () => {
            const svc = createNeonApiService({ apiKey: 'napi_test' });
            assertExists(svc);
            assertExists(svc.getProject);
            assertExists(svc.listBranches);
        });

        await t.step('throws ZodError for invalid config', () => {
            try {
                createNeonApiService({ apiKey: '' });
                throw new Error('should have thrown');
            } catch (err) {
                assertEquals((err as Error).name, 'ZodError');
            }
        });
    });

    // ── getProject ───────────────────────────────────────────────────────────

    await t.step('getProject', async (t) => {
        await t.step('returns parsed project on success', async () => {
            stubFetch(200, { project: FIXTURES.project });
            try {
                const svc = createTestService();
                const proj = await svc.getProject('twilight-river-73901472');
                assertEquals(proj.id, 'twilight-river-73901472');
                assertEquals(proj.name, 'bloqr-backend');
                assertEquals(proj.pg_version, 17);
            } finally {
                cleanup();
            }
        });

        await t.step('sends correct Authorization header', async () => {
            const spy = spyFetch(200, { project: FIXTURES.project });
            try {
                const svc = createTestService();
                await svc.getProject('test-proj');
                assertEquals(spy.calls.length, 1);
                const authHeader = (spy.calls[0].init?.headers as Record<string, string>)['Authorization'];
                assertEquals(authHeader, 'Bearer napi_test_key_12345');
            } finally {
                cleanup();
            }
        });

        await t.step('throws NeonApiError on 404', async () => {
            stubFetch(404, { message: 'project not found' });
            try {
                const svc = createTestService();
                await assertRejects(
                    () => svc.getProject('nonexistent'),
                    NeonApiError,
                    'failed with status 404',
                );
            } finally {
                cleanup();
            }
        });
    });

    // ── listBranches ─────────────────────────────────────────────────────────

    await t.step('listBranches', async (t) => {
        await t.step('returns parsed branches', async () => {
            stubFetch(200, { branches: [FIXTURES.branch] });
            try {
                const svc = createTestService();
                const branches = await svc.listBranches('proj-1');
                assertEquals(branches.length, 1);
                assertEquals(branches[0].name, 'main');
            } finally {
                cleanup();
            }
        });

        await t.step('returns empty array for no branches', async () => {
            stubFetch(200, { branches: [] });
            try {
                const svc = createTestService();
                const branches = await svc.listBranches('proj-1');
                assertEquals(branches.length, 0);
            } finally {
                cleanup();
            }
        });
    });

    // ── getBranch ────────────────────────────────────────────────────────────

    await t.step('getBranch', async (t) => {
        await t.step('returns parsed branch', async () => {
            stubFetch(200, { branch: FIXTURES.branch });
            try {
                const svc = createTestService();
                const branch = await svc.getBranch('proj-1', 'br-cool-night-abc123');
                assertEquals(branch.id, 'br-cool-night-abc123');
                assertEquals(branch.current_state, 'ready');
            } finally {
                cleanup();
            }
        });
    });

    // ── createBranch ─────────────────────────────────────────────────────────

    await t.step('createBranch', async (t) => {
        await t.step('sends POST with branch options', async () => {
            const spy = spyFetch(201, {
                branch: FIXTURES.branch,
                operations: [FIXTURES.operation],
            });
            try {
                const svc = createTestService();
                const opts: CreateBranchOptions = { name: 'feature/test' };
                const result = await svc.createBranch('proj-1', opts);

                assertEquals(result.branch.name, 'main');
                assertEquals(result.operations.length, 1);
                assertEquals(result.operations[0].action, 'create_branch');

                assertEquals(spy.calls.length, 1);
                assertEquals(spy.calls[0].init?.method, 'POST');
                const body = JSON.parse(spy.calls[0].init?.body as string);
                assertEquals(body.branch.name, 'feature/test');
            } finally {
                cleanup();
            }
        });

        await t.step('sends POST without body when no options', async () => {
            const spy = spyFetch(201, {
                branch: FIXTURES.branch,
                operations: [],
            });
            try {
                const svc = createTestService();
                await svc.createBranch('proj-1');

                const body = JSON.parse(spy.calls[0].init?.body as string);
                assertEquals(Object.keys(body).length, 0);
            } finally {
                cleanup();
            }
        });
    });

    // ── deleteBranch ─────────────────────────────────────────────────────────

    await t.step('deleteBranch', async (t) => {
        await t.step('sends DELETE and returns result', async () => {
            const spy = spyFetch(200, {
                branch: FIXTURES.branch,
                operations: [FIXTURES.operation],
            });
            try {
                const svc = createTestService();
                const result = await svc.deleteBranch('proj-1', 'br-cool-night-abc123');
                assertEquals(result.branch.id, 'br-cool-night-abc123');
                assertEquals(spy.calls[0].init?.method, 'DELETE');
            } finally {
                cleanup();
            }
        });
    });

    // ── listEndpoints ────────────────────────────────────────────────────────

    await t.step('listEndpoints', async (t) => {
        await t.step('returns parsed endpoints', async () => {
            stubFetch(200, { endpoints: [FIXTURES.endpoint] });
            try {
                const svc = createTestService();
                const endpoints = await svc.listEndpoints('proj-1');
                assertEquals(endpoints.length, 1);
                assertEquals(endpoints[0].host, 'ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech');
            } finally {
                cleanup();
            }
        });
    });

    // ── listDatabases ────────────────────────────────────────────────────────

    await t.step('listDatabases', async (t) => {
        await t.step('returns parsed databases', async () => {
            stubFetch(200, { databases: [FIXTURES.database] });
            try {
                const svc = createTestService();
                const dbs = await svc.listDatabases('proj-1', 'br-abc');
                assertEquals(dbs.length, 1);
                assertEquals(dbs[0].name, 'neondb');
                assertEquals(dbs[0].id, 1);
            } finally {
                cleanup();
            }
        });
    });

    // ── getConnectionUri ─────────────────────────────────────────────────────

    await t.step('getConnectionUri', async (t) => {
        await t.step('returns URI string', async () => {
            stubFetch(200, { uri: 'postgres://user:pass@host/db' });
            try {
                const svc = createTestService();
                const uri = await svc.getConnectionUri('proj-1', 'br-abc');
                assertEquals(uri, 'postgres://user:pass@host/db');
            } finally {
                cleanup();
            }
        });

        await t.step('includes query params for database_name and role_name', async () => {
            const spy = spyFetch(200, { uri: 'postgres://user:pass@host/mydb' });
            try {
                const svc = createTestService();
                const opts: ConnectionUriOptions = { database_name: 'mydb', role_name: 'admin' };
                await svc.getConnectionUri('proj-1', 'br-abc', opts);

                const url = spy.calls[0].url;
                assertEquals(url.includes('database_name=mydb'), true);
                assertEquals(url.includes('role_name=admin'), true);
            } finally {
                cleanup();
            }
        });
    });

    // ── Error handling ───────────────────────────────────────────────────────

    await t.step('error handling', async (t) => {
        await t.step('NeonApiError includes status and body', async () => {
            stubFetch(403, { message: 'forbidden', code: 'FORBIDDEN' });
            try {
                const svc = createTestService();
                try {
                    await svc.getProject('proj-1');
                    throw new Error('should have thrown');
                } catch (err) {
                    const neonErr = err as NeonApiError;
                    assertEquals(neonErr.name, 'NeonApiError');
                    assertEquals(neonErr.status, 403);
                    assertEquals((neonErr.body as Record<string, string>).message, 'forbidden');
                }
            } finally {
                cleanup();
            }
        });

        await t.step('NeonApiError on 500 server error', async () => {
            stubFetch(500, { message: 'internal error' });
            try {
                const svc = createTestService();
                await assertRejects(
                    () => svc.listBranches('proj-1'),
                    NeonApiError,
                    'failed with status 500',
                );
            } finally {
                cleanup();
            }
        });

        await t.step('NeonApiError on 401 unauthorized', async () => {
            stubFetch(401, { message: 'unauthorized' });
            try {
                const svc = createTestService();
                await assertRejects(
                    () => svc.listEndpoints('proj-1'),
                    NeonApiError,
                    'failed with status 401',
                );
            } finally {
                cleanup();
            }
        });

        await t.step('handles non-JSON error bodies gracefully', async () => {
            // deno-lint-ignore no-explicit-any
            (globalThis as any).fetch = (): Promise<Response> => {
                return Promise.resolve(
                    new Response('Gateway Timeout', {
                        status: 504,
                        headers: { 'Content-Type': 'text/plain' },
                    }),
                );
            };
            try {
                const svc = createTestService();
                await assertRejects(
                    () => svc.getProject('proj-1'),
                    NeonApiError,
                    'failed with status 504',
                );
            } finally {
                cleanup();
            }
        });

        await t.step('handles network errors', async () => {
            // deno-lint-ignore no-explicit-any
            (globalThis as any).fetch = (): Promise<Response> => {
                return Promise.reject(new TypeError('Failed to fetch'));
            };
            try {
                const svc = createTestService();
                await assertRejects(
                    () => svc.getProject('proj-1'),
                    TypeError,
                    'Failed to fetch',
                );
            } finally {
                cleanup();
            }
        });
    });

    // ── Logger integration ───────────────────────────────────────────────────

    await t.step('logger integration', async (t) => {
        await t.step('logs API calls when logger provided', async () => {
            stubFetch(200, { project: FIXTURES.project });
            try {
                const messages: string[] = [];
                const logger = {
                    info: (msg: string) => messages.push(msg),
                    warn: () => {},
                    error: () => {},
                };
                const svc = createNeonApiService({ apiKey: 'napi_test' }, logger);
                await svc.getProject('proj-1');

                assertEquals(messages.length, 1);
                assertEquals(messages[0].includes('[NeonApiService]'), true);
                assertEquals(messages[0].includes('GET'), true);
            } finally {
                cleanup();
            }
        });

        await t.step('works without logger (silent by default)', async () => {
            stubFetch(200, { branches: [] });
            try {
                const svc = createNeonApiService({ apiKey: 'napi_test' });
                const branches = await svc.listBranches('proj-1');
                assertEquals(branches.length, 0);
            } finally {
                cleanup();
            }
        });
    });

    // ── URL construction ─────────────────────────────────────────────────────

    await t.step('URL construction', async (t) => {
        await t.step('uses default base URL', async () => {
            const spy = spyFetch(200, { project: FIXTURES.project });
            try {
                const svc = createTestService();
                await svc.getProject('proj-1');
                assertEquals(
                    spy.calls[0].url.startsWith('https://console.neon.tech/api/v2/projects/proj-1'),
                    true,
                );
            } finally {
                cleanup();
            }
        });

        await t.step('uses custom base URL', async () => {
            const spy = spyFetch(200, { project: FIXTURES.project });
            try {
                const svc = createNeonApiService({
                    apiKey: 'napi_test',
                    baseUrl: 'https://custom.neon.io/api/v2',
                });
                await svc.getProject('proj-1');
                assertEquals(
                    spy.calls[0].url.startsWith('https://custom.neon.io/api/v2/projects/proj-1'),
                    true,
                );
            } finally {
                cleanup();
            }
        });
    });
});

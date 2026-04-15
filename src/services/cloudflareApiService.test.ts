/**
 * Tests for CloudflareApiService
 */

import { assertEquals, assertRejects } from '@std/assert';
import Cloudflare from 'cloudflare';
import type { IBasicLogger } from '../types/index.ts';
import { CloudflareApiService, createCloudflareApiService } from './cloudflareApiService.ts';
import type { D1Param } from './cloudflareApiService.ts';
import type { ApiShieldSchema, ApiShieldUploadResult } from './cloudflareApiService.ts';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal page-like object returned by mock SDK methods.
 * Mirrors the `getPaginatedItems()` contract of the real SDK page types.
 */
function makeMockPage<T>(items: T[]) {
    return { getPaginatedItems: () => items };
}

/**
 * Creates a minimal mock Cloudflare SDK client for unit testing.
 *
 * Each method returns a pre-configured response so tests can verify that
 * the service correctly delegates to and processes the SDK results.
 */
function createMockCloudflareClient() {
    return {
        d1: {
            database: {
                query: (_databaseId: string, _params: unknown) =>
                    Promise.resolve(
                        makeMockPage([{ results: [{ id: 1, name: 'row-one' }], meta: {} }]),
                    ),
                list: (_params: unknown) =>
                    Promise.resolve(
                        makeMockPage([{ uuid: 'db-uuid-1', name: 'my-db', version: 'alpha' }]),
                    ),
            },
        },
        kv: {
            namespaces: {
                list: (_params: unknown) =>
                    Promise.resolve(
                        makeMockPage([{ id: 'ns-id-1', title: 'MY_KV' }]),
                    ),
            },
        },
        workers: {
            scripts: {
                list: (_params: unknown) =>
                    Promise.resolve(
                        makeMockPage([{ id: 'worker-id-1', script_name: 'my-worker' }]),
                    ),
            },
        },
        queues: {
            list: (_params: unknown) =>
                Promise.resolve(
                    makeMockPage([{ queue_id: 'q-id-1', queue_name: 'my-queue' }]),
                ),
        },
        zones: {
            list: (_params: unknown) =>
                Promise.resolve(
                    makeMockPage([{ id: 'zone-id-1', name: 'example.com' }]),
                ),
        },
        apiGateway: {
            userSchemas: {
                list: (_params: unknown) =>
                    Promise.resolve(
                        makeMockPage([
                            {
                                schema_id: 'schema-id-1',
                                name: 'my-schema',
                                kind: 'openapi_v3',
                                created_at: '2024-01-01T00:00:00Z',
                                source: 'openapi: 3.0.0',
                                validation_enabled: true,
                            } as ApiShieldSchema,
                        ]),
                    ),
                create: (_params: unknown) =>
                    Promise.resolve({
                        schema: {
                            schema_id: 'schema-id-new',
                            name: 'my-schema',
                            kind: 'openapi_v3',
                            created_at: '2024-01-02T00:00:00Z',
                        } as ApiShieldSchema,
                    } as ApiShieldUploadResult),
                edit: (_schemaId: string, _params: unknown) =>
                    Promise.resolve({
                        schema_id: 'schema-id-1',
                        name: 'my-schema',
                        kind: 'openapi_v3',
                        created_at: '2024-01-01T00:00:00Z',
                        validation_enabled: true,
                    } as ApiShieldSchema),
                delete: (_schemaId: string, _params: unknown) => Promise.resolve(undefined),
            },
        },
        post: (_path: string, _opts: unknown) => Promise.resolve({ data: [{ total_requests: 100 }] }),
    };
}

// ─── Constructor / factory tests ──────────────────────────────────────────────

Deno.test('CloudflareApiService - constructor', async (t) => {
    await t.step('should create instance with a mock client', () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        assertEquals(service instanceof CloudflareApiService, true);
    });

    await t.step('should accept an optional logger', () => {
        const mock = createMockCloudflareClient();
        const logger: IBasicLogger = { info: () => {}, warn: () => {}, error: () => {} };
        const service = new CloudflareApiService(mock as unknown as Cloudflare, logger);
        assertEquals(service instanceof CloudflareApiService, true);
    });
});

Deno.test('createCloudflareApiService - factory', async (t) => {
    await t.step('should return a CloudflareApiService instance', () => {
        // Use a fake token – no real HTTP call is made here.
        const service = createCloudflareApiService({ apiToken: 'test-token' });
        assertEquals(service instanceof CloudflareApiService, true);
    });
});

// ─── queryD1 ─────────────────────────────────────────────────────────────────

Deno.test('CloudflareApiService - queryD1', async (t) => {
    await t.step('should return flattened rows and success=true', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const result = await service.queryD1<{ id: number; name: string }>('acct-1', 'db-1', 'SELECT * FROM t');

        assertEquals(result.success, true);
        assertEquals(result.result.length, 1);
        assertEquals(result.result[0].id, 1);
        assertEquals(result.result[0].name, 'row-one');
    });

    await t.step('should pass sql and params through to the client', async () => {
        let capturedDatabaseId = '';
        let capturedSql = '';
        let capturedParams: D1Param[] = [];

        const mock = {
            ...createMockCloudflareClient(),
            d1: {
                database: {
                    query: (databaseId: string, params: { account_id: string; sql: string; params?: D1Param[] }) => {
                        capturedDatabaseId = databaseId;
                        capturedSql = params.sql;
                        capturedParams = params.params ?? [];
                        return Promise.resolve(makeMockPage([{ results: [], meta: {} }]));
                    },
                    list: (_params: unknown) => Promise.resolve(makeMockPage([])),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.queryD1('acct-1', 'db-1', 'SELECT * FROM t WHERE x = ?', ['hello']);

        assertEquals(capturedDatabaseId, 'db-1');
        assertEquals(capturedSql, 'SELECT * FROM t WHERE x = ?');
        assertEquals(capturedParams, ['hello']);
    });

    await t.step('should return empty result array when query has no rows', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            d1: {
                database: {
                    query: (_databaseId: string, _params: unknown) => Promise.resolve(makeMockPage([{ results: [], meta: {} }])),
                    list: (_params: unknown) => Promise.resolve(makeMockPage([])),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        const result = await service.queryD1('acct-1', 'db-1', 'SELECT * FROM empty');

        assertEquals(result.success, true);
        assertEquals(result.result.length, 0);
    });

    await t.step('should flatten rows from multiple QueryResult pages', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            d1: {
                database: {
                    query: (_databaseId: string, _params: unknown) =>
                        Promise.resolve(
                            makeMockPage([
                                { results: [{ id: 1 }], meta: {} },
                                { results: [{ id: 2 }, { id: 3 }], meta: {} },
                            ]),
                        ),
                    list: (_params: unknown) => Promise.resolve(makeMockPage([])),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        const result = await service.queryD1<{ id: number }>('acct-1', 'db-1', 'SELECT id FROM t');

        assertEquals(result.result.length, 3);
        assertEquals(result.result[0].id, 1);
        assertEquals(result.result[2].id, 3);
    });

    await t.step('should propagate SDK errors', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            d1: {
                database: {
                    query: (_databaseId: string, _params: unknown) => Promise.reject(new Error('SDK error')),
                    list: (_params: unknown) => Promise.resolve(makeMockPage([])),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await assertRejects(() => service.queryD1('acct-1', 'db-1', 'SELECT 1'), Error, 'SDK error');
    });
});

// ─── listD1Databases ──────────────────────────────────────────────────────────

Deno.test('CloudflareApiService - listD1Databases', async (t) => {
    await t.step('should return database list from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const databases = await service.listD1Databases('acct-1');

        assertEquals(databases.length, 1);
        assertEquals((databases[0] as { uuid: string }).uuid, 'db-uuid-1');
    });

    await t.step('should pass account_id to the client', async () => {
        let capturedAccountId = '';

        const mock = {
            ...createMockCloudflareClient(),
            d1: {
                database: {
                    query: (_databaseId: string, _params: unknown) => Promise.resolve(makeMockPage([])),
                    list: (params: { account_id: string }) => {
                        capturedAccountId = params.account_id;
                        return Promise.resolve(makeMockPage([]));
                    },
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.listD1Databases('my-account');

        assertEquals(capturedAccountId, 'my-account');
    });
});

// ─── listKvNamespaces ─────────────────────────────────────────────────────────

Deno.test('CloudflareApiService - listKvNamespaces', async (t) => {
    await t.step('should return namespace list from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const namespaces = await service.listKvNamespaces('acct-1');

        assertEquals(namespaces.length, 1);
        assertEquals((namespaces[0] as { id: string }).id, 'ns-id-1');
    });

    await t.step('should pass account_id to the client', async () => {
        let capturedAccountId = '';

        const mock = {
            ...createMockCloudflareClient(),
            kv: {
                namespaces: {
                    list: (params: { account_id: string }) => {
                        capturedAccountId = params.account_id;
                        return Promise.resolve(makeMockPage([]));
                    },
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.listKvNamespaces('kv-account');

        assertEquals(capturedAccountId, 'kv-account');
    });
});

// ─── listWorkers ─────────────────────────────────────────────────────────────

Deno.test('CloudflareApiService - listWorkers', async (t) => {
    await t.step('should return worker script list from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const workers = await service.listWorkers('acct-1');

        assertEquals(workers.length, 1);
        assertEquals((workers[0] as { id: string }).id, 'worker-id-1');
    });

    await t.step('should pass account_id to the client', async () => {
        let capturedAccountId = '';

        const mock = {
            ...createMockCloudflareClient(),
            workers: {
                scripts: {
                    list: (params: { account_id: string }) => {
                        capturedAccountId = params.account_id;
                        return Promise.resolve(makeMockPage([]));
                    },
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.listWorkers('workers-account');

        assertEquals(capturedAccountId, 'workers-account');
    });
});

// ─── listQueues ───────────────────────────────────────────────────────────────

Deno.test('CloudflareApiService - listQueues', async (t) => {
    await t.step('should return queue list from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const queues = await service.listQueues('acct-1');

        assertEquals(queues.length, 1);
        assertEquals((queues[0] as { queue_id: string }).queue_id, 'q-id-1');
    });

    await t.step('should pass account_id to the client', async () => {
        let capturedAccountId = '';

        const mock = {
            ...createMockCloudflareClient(),
            queues: {
                list: (params: { account_id: string }) => {
                    capturedAccountId = params.account_id;
                    return Promise.resolve(makeMockPage([]));
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.listQueues('queues-account');

        assertEquals(capturedAccountId, 'queues-account');
    });
});

// ─── listZones ────────────────────────────────────────────────────────────────

Deno.test('CloudflareApiService - listZones', async (t) => {
    await t.step('should return zone list from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const zones = await service.listZones();

        assertEquals(zones.length, 1);
        assertEquals((zones[0] as { id: string }).id, 'zone-id-1');
    });

    await t.step('should pass params to the client when provided', async () => {
        let capturedParams: unknown = undefined;

        const mock = {
            ...createMockCloudflareClient(),
            zones: {
                list: (params: unknown) => {
                    capturedParams = params;
                    return Promise.resolve(makeMockPage([]));
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.listZones({ account: { id: 'acct-1' } });

        assertEquals((capturedParams as { account: { id: string } }).account.id, 'acct-1');
    });

    await t.step('should pass empty object when no params given', async () => {
        let capturedParams: unknown = undefined;

        const mock = {
            ...createMockCloudflareClient(),
            zones: {
                list: (params: unknown) => {
                    capturedParams = params;
                    return Promise.resolve(makeMockPage([]));
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.listZones();

        assertEquals(typeof capturedParams, 'object');
    });
});

// ─── Logger integration ───────────────────────────────────────────────────────

Deno.test('CloudflareApiService - logger integration', async (t) => {
    await t.step('should log info messages via the provided logger', async () => {
        const infos: string[] = [];
        const testLogger: IBasicLogger = {
            info: (message: string) => infos.push(message),
            warn: () => {},
            error: () => {},
        };

        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare, testLogger);

        await service.queryD1('acct-1', 'db-1', 'SELECT 1');

        assertEquals(infos.length >= 1, true);
        assertEquals(infos[0].includes('queryD1'), true);
    });
});

// ─── queryAnalyticsEngine ─────────────────────────────────────────────────────

Deno.test('CloudflareApiService - queryAnalyticsEngine', async (t) => {
    await t.step('should return data rows from the SDK post() call', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            post: (_path: string, _opts: unknown) => Promise.resolve({ data: [{ total_requests: 42, error_requests: 3 }] }),
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        const result = await service.queryAnalyticsEngine('acct-1', 'SELECT 1');

        assertEquals(result.data.length, 1);
        assertEquals((result.data[0] as { total_requests: number }).total_requests, 42);
    });

    await t.step('should pass correct path and sql body to the SDK', async () => {
        let capturedPath = '';
        let capturedBody: unknown;

        const mock = {
            ...createMockCloudflareClient(),
            post: (path: string, opts: { body: unknown }) => {
                capturedPath = path;
                capturedBody = opts.body;
                return Promise.resolve({ data: [] });
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.queryAnalyticsEngine('my-acct', 'SELECT count() FROM dataset');

        assertEquals(capturedPath, '/accounts/my-acct/analytics_engine/sql');
        assertEquals((capturedBody as { query: string }).query, 'SELECT count() FROM dataset');
    });

    await t.step('should return empty data array when no rows match', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            post: (_path: string, _opts: unknown) => Promise.resolve({ data: [] }),
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        const result = await service.queryAnalyticsEngine('acct-1', 'SELECT 1 WHERE false');

        assertEquals(result.data.length, 0);
    });

    await t.step('should propagate SDK errors', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            post: (_path: string, _opts: unknown) => Promise.reject(new Error('Analytics unavailable')),
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await assertRejects(
            () => service.queryAnalyticsEngine('acct-1', 'SELECT 1'),
            Error,
            'Analytics unavailable',
        );
    });
});

// ─── listApiShieldSchemas ─────────────────────────────────────────────────────

Deno.test('CloudflareApiService - listApiShieldSchemas', async (t) => {
    await t.step('should return schema list from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const schemas = await service.listApiShieldSchemas('zone-1');

        assertEquals(schemas.length, 1);
        assertEquals((schemas[0] as ApiShieldSchema).schema_id, 'schema-id-1');
        assertEquals((schemas[0] as ApiShieldSchema).validation_enabled, true);
    });

    await t.step('should pass zone_id and omit_source=false to the client', async () => {
        let capturedParams: unknown;

        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    list: (params: unknown) => {
                        capturedParams = params;
                        return Promise.resolve(makeMockPage([]));
                    },
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.listApiShieldSchemas('my-zone');

        assertEquals((capturedParams as { zone_id: string }).zone_id, 'my-zone');
        assertEquals((capturedParams as { omit_source: boolean }).omit_source, false);
    });

    await t.step('should return empty array when no schemas exist', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    list: (_params: unknown) => Promise.resolve(makeMockPage([])),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        const schemas = await service.listApiShieldSchemas('zone-1');

        assertEquals(schemas.length, 0);
    });

    await t.step('should propagate SDK errors', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    list: (_params: unknown) => Promise.reject(new Error('List failed')),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await assertRejects(() => service.listApiShieldSchemas('zone-1'), Error, 'List failed');
    });
});

// ─── uploadApiShieldSchema ────────────────────────────────────────────────────

Deno.test('CloudflareApiService - uploadApiShieldSchema', async (t) => {
    await t.step('should return create response from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const result = await service.uploadApiShieldSchema('zone-1', 'my-schema', 'openapi: 3.0.0');

        assertEquals((result as ApiShieldUploadResult).schema.schema_id, 'schema-id-new');
    });

    await t.step('should pass zone_id, kind, and name to the client', async () => {
        let capturedParams: unknown;

        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    create: (params: unknown) => {
                        capturedParams = params;
                        return Promise.resolve({
                            schema: { schema_id: 'new-id', name: 'n', kind: 'openapi_v3', created_at: '' } as ApiShieldSchema,
                        } as ApiShieldUploadResult);
                    },
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.uploadApiShieldSchema('zone-abc', 'test-schema', 'content');

        assertEquals((capturedParams as { zone_id: string }).zone_id, 'zone-abc');
        assertEquals((capturedParams as { kind: string }).kind, 'openapi_v3');
        assertEquals((capturedParams as { name: string }).name, 'test-schema');
        assertEquals(typeof (capturedParams as { file: unknown }).file, 'object');
    });

    await t.step('should propagate SDK errors', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    create: (_params: unknown) => Promise.reject(new Error('Upload failed')),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await assertRejects(
            () => service.uploadApiShieldSchema('zone-1', 'schema', 'content'),
            Error,
            'Upload failed',
        );
    });
});

// ─── enableApiShieldSchema ────────────────────────────────────────────────────

Deno.test('CloudflareApiService - enableApiShieldSchema', async (t) => {
    await t.step('should return updated schema from client', async () => {
        const mock = createMockCloudflareClient();
        const service = new CloudflareApiService(mock as unknown as Cloudflare);

        const result = await service.enableApiShieldSchema('zone-1', 'schema-id-1');

        assertEquals((result as ApiShieldSchema).schema_id, 'schema-id-1');
        assertEquals((result as ApiShieldSchema).validation_enabled, true);
    });

    await t.step('should pass zone_id, schema_id, and validation_enabled=true', async () => {
        let capturedSchemaId = '';
        let capturedParams: unknown;

        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    edit: (schemaId: string, params: unknown) => {
                        capturedSchemaId = schemaId;
                        capturedParams = params;
                        return Promise.resolve({
                            schema_id: schemaId,
                            name: 'n',
                            kind: 'openapi_v3' as const,
                            created_at: '',
                            validation_enabled: true,
                        });
                    },
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.enableApiShieldSchema('zone-xyz', 'sid-42');

        assertEquals(capturedSchemaId, 'sid-42');
        assertEquals((capturedParams as { zone_id: string }).zone_id, 'zone-xyz');
        assertEquals((capturedParams as { validation_enabled: boolean }).validation_enabled, true);
    });

    await t.step('should propagate SDK errors', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    edit: (_schemaId: string, _params: unknown) => Promise.reject(new Error('Enable failed')),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await assertRejects(() => service.enableApiShieldSchema('zone-1', 'sid-1'), Error, 'Enable failed');
    });
});

// ─── deleteApiShieldSchema ────────────────────────────────────────────────────

Deno.test('CloudflareApiService - deleteApiShieldSchema', async (t) => {
    await t.step('should call delete with zone_id and schema_id', async () => {
        let capturedSchemaId = '';
        let capturedParams: unknown;

        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    delete: (schemaId: string, params: unknown) => {
                        capturedSchemaId = schemaId;
                        capturedParams = params;
                        return Promise.resolve(undefined);
                    },
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await service.deleteApiShieldSchema('zone-abc', 'del-id-1');

        assertEquals(capturedSchemaId, 'del-id-1');
        assertEquals((capturedParams as { zone_id: string }).zone_id, 'zone-abc');
    });

    await t.step('should propagate SDK errors', async () => {
        const mock = {
            ...createMockCloudflareClient(),
            apiGateway: {
                ...createMockCloudflareClient().apiGateway,
                userSchemas: {
                    ...createMockCloudflareClient().apiGateway.userSchemas,
                    delete: (_schemaId: string, _params: unknown) => Promise.reject(new Error('Delete failed')),
                },
            },
        };

        const service = new CloudflareApiService(mock as unknown as Cloudflare);
        await assertRejects(() => service.deleteApiShieldSchema('zone-1', 'sid-1'), Error, 'Delete failed');
    });
});

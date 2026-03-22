/**
 * @module migrate-d1-to-neon.test
 * Tests for the D1 → Neon migration script.
 *
 * Run: deno test scripts/migrate-d1-to-neon.test.ts --no-lock
 */

import { assertEquals, assertExists } from '@std/assert';
import {
    chunkArray,
    buildBatchInsert,
    migrateTable,
    TABLE_DEFINITIONS,
    type D1Row,
    type MigrationConfig,
    type MigrationLogger,
} from './migrate-d1-to-neon.ts';
import type { D1QueryResult, CloudflareApiService } from '../src/services/cloudflareApiService.ts';
import type { NeonApiService } from '../src/services/neonApiService.ts';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Silent logger for tests. */
const silentLogger: MigrationLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

/** Captured log messages for assertion. */
interface CapturedLogs {
    info: string[];
    warn: string[];
    error: string[];
}

function createCapturingLogger(): { logger: MigrationLogger; logs: CapturedLogs } {
    const logs: CapturedLogs = { info: [], warn: [], error: [] };
    return {
        logger: {
            info: (msg: string) => logs.info.push(msg),
            warn: (msg: string) => logs.warn.push(msg),
            error: (msg: string) => logs.error.push(msg),
        },
        logs,
    };
}

/** Build a mock MigrationConfig for testing. */
function mockConfig(overrides: Partial<MigrationConfig> = {}): MigrationConfig {
    return {
        cfApiToken: 'test-token',
        cfAccountId: 'test-account',
        d1DatabaseId: 'test-db',
        neonApiKey: 'test-neon-key',
        neonConnectionString: 'postgresql://test:test@localhost:5432/test',
        dryRun: false,
        verifyOnly: false,
        batchSize: 100,
        ...overrides,
    };
}

/** Minimal mock CloudflareApiService for testing. */
function mockCfService(data: Record<string, D1Row[]> = {}): CloudflareApiService {
    return {
        queryD1: async <T>(_accountId: string, _dbId: string, sql: string): Promise<D1QueryResult<T>> => {
            // Extract table name from "SELECT * FROM <table>"
            const match = sql.match(/FROM\s+(\w+)/i);
            const table = match?.[1] ?? '';
            const rows = data[table] ?? [];
            return { result: rows as unknown as T[], success: true };
        },
    } as unknown as CloudflareApiService;
}

/** Mock NeonApiService that records all INSERT calls. */
interface NeonMockCapture {
    calls: Array<{ sql: string; params: unknown[] }>;
}

function mockNeonService(capture: NeonMockCapture = { calls: [] }): NeonApiService {
    return {
        querySQL: async <T>(_connStr: string, sql: string, params?: unknown[]): Promise<T[]> => {
            capture.calls.push({ sql, params: params ?? [] });
            return [] as T[];
        },
    } as unknown as NeonApiService;
}

// ─── chunkArray ──────────────────────────────────────────────────────────────

Deno.test('chunkArray: empty array returns empty', () => {
    assertEquals(chunkArray([], 10), []);
});

Deno.test('chunkArray: smaller than batch size returns single chunk', () => {
    assertEquals(chunkArray([1, 2, 3], 10), [[1, 2, 3]]);
});

Deno.test('chunkArray: exact batch size returns single chunk', () => {
    assertEquals(chunkArray([1, 2, 3], 3), [[1, 2, 3]]);
});

Deno.test('chunkArray: larger than batch size returns multiple chunks', () => {
    assertEquals(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

Deno.test('chunkArray: batch size of 1 returns individual items', () => {
    assertEquals(chunkArray(['a', 'b', 'c'], 1), [['a'], ['b'], ['c']]);
});

// ─── buildBatchInsert ────────────────────────────────────────────────────────

Deno.test('buildBatchInsert: empty rows returns empty sql', () => {
    const { sql, params } = buildBatchInsert('users', [], 'id');
    assertEquals(sql, '');
    assertEquals(params, []);
});

Deno.test('buildBatchInsert: single row builds correct INSERT', () => {
    const rows: D1Row[] = [{ id: '1', name: 'Alice', email: 'alice@test.com' }];
    const { sql, params } = buildBatchInsert('users', rows, 'id');

    assertEquals(params, ['1', 'Alice', 'alice@test.com']);
    assertEquals(sql.includes('INSERT INTO "users"'), true);
    assertEquals(sql.includes('"id", "name", "email"'), true);
    assertEquals(sql.includes('ON CONFLICT ("id") DO NOTHING'), true);
    assertEquals(sql.includes('$1, $2, $3'), true);
});

Deno.test('buildBatchInsert: multiple rows builds correct multi-value INSERT', () => {
    const rows: D1Row[] = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
    ];
    const { sql, params } = buildBatchInsert('users', rows, 'id');

    assertEquals(params, ['1', 'Alice', '2', 'Bob']);
    assertEquals(sql.includes('($1, $2), ($3, $4)'), true);
    assertEquals(sql.includes('ON CONFLICT ("id") DO NOTHING'), true);
});

Deno.test('buildBatchInsert: null values are preserved', () => {
    const rows: D1Row[] = [{ id: '1', email: null }];
    const { sql, params } = buildBatchInsert('users', rows, 'id');

    assertEquals(params, ['1', null]);
    assertEquals(sql.includes('ON CONFLICT ("id") DO NOTHING'), true);
});

// ─── Table Transforms ────────────────────────────────────────────────────────

Deno.test('api_keys transform: CSV scopes → PostgreSQL array syntax', () => {
    const apiKeysDef = TABLE_DEFINITIONS.find((d) => d.d1Table === 'api_keys');
    assertExists(apiKeysDef);
    assertExists(apiKeysDef.transform);

    const input: D1Row = { id: '1', scopes: 'compile,read,admin' };
    const output = apiKeysDef.transform(input);
    assertEquals(output.scopes, '{compile,read,admin}');
});

Deno.test('api_keys transform: already-array scopes are unchanged', () => {
    const apiKeysDef = TABLE_DEFINITIONS.find((d) => d.d1Table === 'api_keys');
    assertExists(apiKeysDef);
    assertExists(apiKeysDef.transform);

    const input: D1Row = { id: '1', scopes: ['compile'] };
    const output = apiKeysDef.transform(input);
    assertEquals(output.scopes, ['compile']);
});

Deno.test('compiled_outputs transform: JSON string → parsed object', () => {
    const def = TABLE_DEFINITIONS.find((d) => d.d1Table === 'compiled_outputs');
    assertExists(def);
    assertExists(def.transform);

    const input: D1Row = { id: '1', config_snapshot: '{"sources":["easylist"]}' };
    const output = def.transform(input);
    assertEquals(output.config_snapshot, { sources: ['easylist'] });
});

Deno.test('compiled_outputs transform: already-object config_snapshot unchanged', () => {
    const def = TABLE_DEFINITIONS.find((d) => d.d1Table === 'compiled_outputs');
    assertExists(def);
    assertExists(def.transform);

    const input: D1Row = { id: '1', config_snapshot: { sources: ['easylist'] } };
    const output = def.transform(input);
    assertEquals(output.config_snapshot, { sources: ['easylist'] });
});

Deno.test('compiled_outputs transform: invalid JSON string is left as-is', () => {
    const def = TABLE_DEFINITIONS.find((d) => d.d1Table === 'compiled_outputs');
    assertExists(def);
    assertExists(def.transform);

    const input: D1Row = { id: '1', config_snapshot: 'not-json' };
    const output = def.transform(input);
    assertEquals(output.config_snapshot, 'not-json');
});

Deno.test('compilation_events transform: numeric boolean → JS boolean', () => {
    const def = TABLE_DEFINITIONS.find((d) => d.d1Table === 'compilation_events');
    assertExists(def);
    assertExists(def.transform);

    assertEquals(def.transform({ id: '1', cache_hit: 1 }).cache_hit, true);
    assertEquals(def.transform({ id: '1', cache_hit: 0 }).cache_hit, false);
});

// ─── migrateTable ────────────────────────────────────────────────────────────

Deno.test('migrateTable: dry-run does not insert into Neon', async () => {
    const capture: NeonMockCapture = { calls: [] };
    const cfData = { users: [{ id: '1', email: 'a@b.com' }] };

    const result = await migrateTable(
        TABLE_DEFINITIONS[0], // users
        mockCfService(cfData),
        mockNeonService(capture),
        mockConfig({ dryRun: true }),
        silentLogger,
    );

    assertEquals(result.d1Count, 1);
    assertEquals(result.pgInserted, 0);
    assertEquals(capture.calls.length, 0);
});

Deno.test('migrateTable: live run inserts rows into Neon', async () => {
    const capture: NeonMockCapture = { calls: [] };
    const cfData = { users: [{ id: '1', email: 'a@b.com' }, { id: '2', email: 'c@d.com' }] };

    const result = await migrateTable(
        TABLE_DEFINITIONS[0],
        mockCfService(cfData),
        mockNeonService(capture),
        mockConfig({ dryRun: false, batchSize: 100 }),
        silentLogger,
    );

    assertEquals(result.d1Count, 2);
    assertEquals(result.pgInserted, 2);
    assertEquals(capture.calls.length, 1); // single batch
    assertEquals(capture.calls[0].sql.includes('ON CONFLICT'), true);
});

Deno.test('migrateTable: respects batch size', async () => {
    const capture: NeonMockCapture = { calls: [] };
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, name: `user${i}` }));
    const cfData = { users: rows };

    const result = await migrateTable(
        TABLE_DEFINITIONS[0],
        mockCfService(cfData),
        mockNeonService(capture),
        mockConfig({ dryRun: false, batchSize: 2 }),
        silentLogger,
    );

    assertEquals(result.d1Count, 5);
    assertEquals(result.pgInserted, 5);
    assertEquals(capture.calls.length, 3); // 2+2+1
});

Deno.test('migrateTable: empty D1 table produces zero inserts', async () => {
    const capture: NeonMockCapture = { calls: [] };

    const result = await migrateTable(
        TABLE_DEFINITIONS[0],
        mockCfService({ users: [] }),
        mockNeonService(capture),
        mockConfig(),
        silentLogger,
    );

    assertEquals(result.d1Count, 0);
    assertEquals(result.pgInserted, 0);
    assertEquals(capture.calls.length, 0);
});

Deno.test('migrateTable: handles D1 query failure gracefully', async () => {
    const { logger, logs } = createCapturingLogger();

    const failingCfService = {
        queryD1: async () => { throw new Error('D1 unavailable'); },
    } as unknown as CloudflareApiService;

    const result = await migrateTable(
        TABLE_DEFINITIONS[0],
        failingCfService,
        mockNeonService(),
        mockConfig(),
        logger,
    );

    assertEquals(result.d1Count, 0);
    assertEquals(result.pgInserted, 0);
    assertEquals(logs.warn.length > 0, true);
});

Deno.test('migrateTable: handles Neon insert failure gracefully', async () => {
    const { logger, logs } = createCapturingLogger();

    const failingNeon = {
        querySQL: async () => { throw new Error('Neon unavailable'); },
    } as unknown as NeonApiService;

    const cfData = { users: [{ id: '1', email: 'a@b.com' }] };

    const result = await migrateTable(
        TABLE_DEFINITIONS[0],
        mockCfService(cfData),
        failingNeon,
        mockConfig(),
        logger,
    );

    assertEquals(result.d1Count, 1);
    assertEquals(result.pgInserted, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(logs.error.length > 0, true);
});

// ─── TABLE_DEFINITIONS sanity checks ─────────────────────────────────────────

Deno.test('TABLE_DEFINITIONS: all tables have required fields', () => {
    for (const def of TABLE_DEFINITIONS) {
        assertExists(def.d1Table, `Missing d1Table`);
        assertExists(def.pgTable, `Missing pgTable for ${def.d1Table}`);
        assertExists(def.d1Query, `Missing d1Query for ${def.d1Table}`);
        assertExists(def.pgConflictColumn, `Missing pgConflictColumn for ${def.d1Table}`);
        assertEquals(def.d1Query.includes(def.d1Table), true, `d1Query should reference ${def.d1Table}`);
    }
});

Deno.test('TABLE_DEFINITIONS: users is first (parent table)', () => {
    assertEquals(TABLE_DEFINITIONS[0].d1Table, 'users');
});

Deno.test('TABLE_DEFINITIONS: covers all expected tables', () => {
    const tables = TABLE_DEFINITIONS.map((d) => d.d1Table);
    const expected = [
        'users', 'api_keys', 'sessions', 'filter_sources',
        'compiled_outputs', 'compilation_events',
        'storage_entries', 'filter_cache', 'compilation_metadata',
    ];
    for (const t of expected) {
        assertEquals(tables.includes(t), true, `Missing table definition for ${t}`);
    }
});

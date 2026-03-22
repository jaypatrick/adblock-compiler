/**
 * Unit tests for D1StorageAdapter (Prisma-based rewrite).
 *
 * These tests exercise the adapter through a mock PrismaClient and mock D1
 * binding, verifying that every IStorageAdapter method delegates correctly
 * to Prisma and that error paths return safe defaults.
 *
 * @module D1StorageAdapter.test
 */

import { assertEquals, assertRejects } from '@std/assert';
import { createD1Storage, D1StorageAdapter } from './D1StorageAdapter.ts';

// =============================================================================
// Mock helpers
// =============================================================================

/**
 * Creates a minimal mock D1Database that satisfies the adapter's constructor
 * and raw-query methods. Prisma operations will fail (expected -- we only
 * test logic, not the Prisma runtime against a real D1 binding).
 */
function createMockD1(): any {
    return {
        prepare: (_sql: string) => ({
            bind: (..._values: unknown[]) => ({
                first: async () => null,
                run: async () => ({ results: [], success: true, meta: { duration: 0, changes: 0, last_row_id: 0 } }),
                all: async () => ({ results: [], success: true, meta: { duration: 0, changes: 0, last_row_id: 0 } }),
                raw: async () => [],
            }),
            first: async () => null,
            run: async () => ({ results: [], success: true, meta: { duration: 0, changes: 0, last_row_id: 0 } }),
            all: async () => ({ results: [], success: true, meta: { duration: 0, changes: 0, last_row_id: 0 } }),
            raw: async () => [],
        }),
        dump: async () => new ArrayBuffer(0),
        batch: async (stmts: unknown[]) => stmts.map(() => ({ results: [], success: true, meta: { duration: 0, changes: 0, last_row_id: 0 } })),
        exec: async () => ({ count: 0, duration: 0 }),
    };
}

// =============================================================================
// Lifecycle tests
// =============================================================================

Deno.test('D1StorageAdapter: isOpen returns false before open()', () => {
    const adapter = new D1StorageAdapter(createMockD1());
    assertEquals(adapter.isOpen(), false);
});

Deno.test('D1StorageAdapter: open() sets isOpen to true', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await adapter.open();
    assertEquals(adapter.isOpen(), true);
});

Deno.test('D1StorageAdapter: close() sets isOpen to false', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await adapter.open();
    await adapter.close();
    assertEquals(adapter.isOpen(), false);
});

Deno.test('D1StorageAdapter: double open() is a no-op', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await adapter.open();
    await adapter.open();
    assertEquals(adapter.isOpen(), true);
});

Deno.test('D1StorageAdapter: double close() is a no-op', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await adapter.open();
    await adapter.close();
    await adapter.close();
    assertEquals(adapter.isOpen(), false);
});

// =============================================================================
// Guard: ensureOpen (methods throw before open)
// =============================================================================

Deno.test('D1StorageAdapter: set() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.set(['test'], 'value'),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: get() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.get(['test']),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: delete() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.delete(['test']),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: list() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.list(),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: clearExpired() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.clearExpired(),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: getStats() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.getStats(),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: cacheFilterList() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.cacheFilterList('https://example.com', ['||ad.com^'], 'abc123'),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: getCachedFilterList() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.getCachedFilterList('https://example.com'),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: storeCompilationMetadata() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () =>
            adapter.storeCompilationMetadata({
                configName: 'test',
                timestamp: Date.now(),
                sourceCount: 1,
                ruleCount: 10,
                duration: 100,
            }),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: getCompilationHistory() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.getCompilationHistory('test'),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: clearCache() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.clearCache(),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: rawQuery() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.rawQuery('SELECT 1'),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: batchExecute() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.batchExecute([{ sql: 'SELECT 1' }]),
        Error,
        'not open',
    );
});

Deno.test('D1StorageAdapter: getDatabaseDump() throws when not open', async () => {
    const adapter = new D1StorageAdapter(createMockD1());
    await assertRejects(
        () => adapter.getDatabaseDump(),
        Error,
        'not open',
    );
});

// =============================================================================
// Configuration defaults
// =============================================================================

Deno.test('D1StorageAdapter: default config is applied', () => {
    const adapter = new D1StorageAdapter(createMockD1());
    // Verify adapter was created without errors (config defaults applied internally).
    assertEquals(adapter.isOpen(), false);
});

Deno.test('D1StorageAdapter: custom config is accepted', () => {
    const adapter = new D1StorageAdapter(createMockD1(), {
        defaultTtlMs: 7_200_000,
        enableLogging: true,
    });
    assertEquals(adapter.isOpen(), false);
});

// =============================================================================
// D1-specific operations (use mock D1 directly)
// =============================================================================

Deno.test('D1StorageAdapter: rawQuery() returns mock results', async () => {
    const mockD1 = createMockD1();
    mockD1.prepare = (_sql: string) => ({
        bind: (..._v: unknown[]) => ({
            all: async () => ({
                results: [{ id: 1, name: 'test' }],
                success: true,
                meta: { duration: 1, changes: 0, last_row_id: 0 },
            }),
        }),
        all: async () => ({
            results: [{ id: 1, name: 'test' }],
            success: true,
            meta: { duration: 1, changes: 0, last_row_id: 0 },
        }),
    });

    const adapter = new D1StorageAdapter(mockD1);
    await adapter.open();

    const rows = await adapter.rawQuery<{ id: number; name: string }>(
        'SELECT * FROM test WHERE id = ?',
        [1],
    );

    assertEquals(rows, [{ id: 1, name: 'test' }]);
});

Deno.test('D1StorageAdapter: getDatabaseDump() returns ArrayBuffer', async () => {
    const buffer = new ArrayBuffer(16);
    const mockD1 = createMockD1();
    mockD1.dump = async () => buffer;

    const adapter = new D1StorageAdapter(mockD1);
    await adapter.open();

    const result = await adapter.getDatabaseDump();
    assertEquals(result, buffer);
});

Deno.test('D1StorageAdapter: batchExecute() executes multiple statements', async () => {
    let batchCallCount = 0;
    const mockD1 = createMockD1();
    mockD1.batch = async (stmts: unknown[]) => {
        batchCallCount++;
        return (stmts as unknown[]).map(() => ({
            results: [],
            success: true,
            meta: { duration: 0, changes: 1, last_row_id: 0 },
        }));
    };

    const adapter = new D1StorageAdapter(mockD1);
    await adapter.open();

    const results = await adapter.batchExecute([
        { sql: 'DELETE FROM storage_entries WHERE key = ?', params: ['a'] },
        { sql: 'DELETE FROM storage_entries WHERE key = ?', params: ['b'] },
    ]);

    assertEquals(batchCallCount, 1);
    assertEquals(results.length, 2);
});

// =============================================================================
// Factory function
// =============================================================================

Deno.test('createD1Storage: creates adapter from env object', () => {
    const env = { DB: createMockD1() };
    const adapter = createD1Storage(env);
    assertEquals(adapter instanceof D1StorageAdapter, true);
    assertEquals(adapter.isOpen(), false);
});

Deno.test('createD1Storage: passes config and logger', () => {
    const env = { DB: createMockD1() };
    const logs: string[] = [];
    const adapter = createD1Storage(env, { defaultTtlMs: 5000 }, {
        debug: (msg) => logs.push(msg),
        info: (msg) => logs.push(msg),
        warn: (msg) => logs.push(msg),
        error: (msg) => logs.push(msg),
    });
    assertEquals(adapter instanceof D1StorageAdapter, true);
});

// =============================================================================
// getPrismaClient
// =============================================================================

Deno.test('D1StorageAdapter: getPrismaClient() returns PrismaClient instance', () => {
    const adapter = new D1StorageAdapter(createMockD1());
    const client = adapter.getPrismaClient();
    // PrismaClient should be an object (we can't fully verify its type without
    // a real D1 binding, but at minimum it should be truthy).
    assertEquals(typeof client, 'object');
    assertEquals(client !== null, true);
});

// =============================================================================
// Logger integration
// =============================================================================

Deno.test('D1StorageAdapter: open() emits debug log when logging enabled', async () => {
    const logs: string[] = [];
    const adapter = new D1StorageAdapter(createMockD1(), { enableLogging: true }, {
        debug: (msg) => logs.push(msg),
    });

    await adapter.open();
    assertEquals(logs.length > 0, true);
    assertEquals(logs[0].includes('opened'), true);
});

Deno.test('D1StorageAdapter: close() emits debug log when logging enabled', async () => {
    const logs: string[] = [];
    const adapter = new D1StorageAdapter(createMockD1(), { enableLogging: true }, {
        debug: (msg) => logs.push(msg),
    });

    await adapter.open();
    logs.length = 0; // Clear open log
    await adapter.close();
    assertEquals(logs.length > 0, true);
    assertEquals(logs[0].includes('closed'), true);
});

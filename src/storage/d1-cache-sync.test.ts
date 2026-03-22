/**
 * Tests for D1 Cache Sync Utilities
 *
 * Uses mock Prisma clients to verify sync, invalidation, staleness checks,
 * and batch operations without requiring a live D1 database.
 */

import { assertEquals, assertExists } from '@std/assert';
import {
    type BatchSyncResult,
    D1CacheSyncConfigSchema,
    type ICacheSyncLogger,
    invalidateRecord,
    isCacheStale,
    syncBatch,
    syncRecord,
} from './d1-cache-sync.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a capturing logger that records every call. */
function createCapturingLogger(): ICacheSyncLogger & { messages: Array<{ level: string; msg: string }> } {
    const messages: Array<{ level: string; msg: string }> = [];
    return {
        messages,
        debug(msg: string) { messages.push({ level: 'debug', msg }); },
        info(msg: string) { messages.push({ level: 'info', msg }); },
        warn(msg: string) { messages.push({ level: 'warn', msg }); },
        error(msg: string) { messages.push({ level: 'error', msg }); },
    };
}

/** In-memory record store used by the mock Prisma delegate. */
type RecordStore = Map<string, Record<string, unknown>>;

/** Create a mock Prisma delegate for a single table. */
function createMockDelegate(store: RecordStore = new Map()) {
    return {
        upsert: async ({ where, update, create }: {
            where: { id: string };
            update: Record<string, unknown>;
            create: Record<string, unknown>;
        }) => {
            const existing = store.get(where.id);
            if (existing) {
                const merged = { ...existing, ...update };
                store.set(where.id, merged);
                return merged;
            }
            store.set(create.id as string, create);
            return create;
        },

        delete: async ({ where }: { where: { id: string } }) => {
            if (!store.has(where.id)) {
                const err = new Error('Record to delete does not exist.');
                (err as unknown as { code: string }).code = 'P2025';
                throw err;
            }
            const record = store.get(where.id);
            store.delete(where.id);
            return record;
        },

        findUnique: async ({ where, select: _select }: {
            where: { id: string };
            select?: Record<string, boolean>;
        }) => {
            return store.get(where.id) ?? null;
        },
    };
}

/**
 * Build a mock D1 Prisma client.
 *
 * Optionally pass pre-populated stores per table.
 */
function createMockD1Prisma(
    stores: Record<string, RecordStore> = {},
    opts?: { transactionFail?: boolean },
) {
    const delegates: Record<string, ReturnType<typeof createMockDelegate>> = {};

    const getOrCreateDelegate = (table: string) => {
        if (!delegates[table]) {
            delegates[table] = createMockDelegate(stores[table] ?? new Map());
        }
        return delegates[table];
    };

    const proxy: Record<string, unknown> = {
        $transaction: async (fn: (tx: Record<string, unknown>) => Promise<void>) => {
            if (opts?.transactionFail) {
                throw new Error('Simulated transaction failure');
            }
            // The transaction proxy exposes the same delegates.
            await fn(new Proxy({}, {
                get(_target, prop: string) {
                    return getOrCreateDelegate(prop);
                },
            }));
        },
    };

    return new Proxy(proxy, {
        get(target, prop: string) {
            if (prop === '$transaction') return target.$transaction;
            return getOrCreateDelegate(prop);
        },
    });
}

// ===========================================================================
// Config validation
// ===========================================================================

Deno.test('D1CacheSyncConfigSchema: accepts defaults', () => {
    const cfg = D1CacheSyncConfigSchema.parse({});
    assertEquals(cfg.strategy, 'write-through');
    assertEquals(cfg.maxAge, 300);
    assertEquals(cfg.syncTables.length > 0, true);
});

Deno.test('D1CacheSyncConfigSchema: accepts custom values', () => {
    const cfg = D1CacheSyncConfigSchema.parse({
        syncTables: ['user', 'filterCache'],
        maxAge: 600,
        strategy: 'lazy',
    });
    assertEquals(cfg.strategy, 'lazy');
    assertEquals(cfg.maxAge, 600);
    assertEquals(cfg.syncTables, ['user', 'filterCache']);
});

Deno.test('D1CacheSyncConfigSchema: rejects invalid strategy', () => {
    const result = D1CacheSyncConfigSchema.safeParse({ strategy: 'invalid' });
    assertEquals(result.success, false);
});

Deno.test('D1CacheSyncConfigSchema: rejects negative maxAge', () => {
    const result = D1CacheSyncConfigSchema.safeParse({ maxAge: -1 });
    assertEquals(result.success, false);
});

Deno.test('D1CacheSyncConfigSchema: rejects invalid table names', () => {
    const result = D1CacheSyncConfigSchema.safeParse({ syncTables: ['nonExistentTable'] });
    assertEquals(result.success, false);
});

// ===========================================================================
// syncRecord
// ===========================================================================

Deno.test('syncRecord: creates new record', async () => {
    const store: RecordStore = new Map();
    const prisma = createMockD1Prisma({ filterCache: store });

    const result = await syncRecord('filterCache', 'fc-1', { source: 'https://example.com', content: '[]', hash: 'abc' }, prisma);

    assertEquals(result.success, true);
    assertEquals(result.table, 'filterCache');
    assertEquals(result.id, 'fc-1');
    assertEquals(store.has('fc-1'), true);
});

Deno.test('syncRecord: updates existing record', async () => {
    const store: RecordStore = new Map([
        ['fc-1', { id: 'fc-1', source: 'https://example.com', content: '["old"]', hash: 'old' }],
    ]);
    const prisma = createMockD1Prisma({ filterCache: store });

    await syncRecord('filterCache', 'fc-1', { content: '["new"]', hash: 'new' }, prisma);

    assertEquals((store.get('fc-1') as Record<string, unknown>).content, '["new"]');
    assertEquals((store.get('fc-1') as Record<string, unknown>).hash, 'new');
});

Deno.test('syncRecord: logs on success', async () => {
    const logger = createCapturingLogger();
    const prisma = createMockD1Prisma();

    await syncRecord('user', 'u-1', { email: 'test@test.com' }, prisma, logger);

    const debugMsg = logger.messages.find(m => m.level === 'debug' && m.msg.includes('synced user/u-1'));
    assertExists(debugMsg);
});

Deno.test('syncRecord: returns error on failure', async () => {
    // Provide a prisma whose delegate always throws.
    const broken = {
        filterCache: {
            upsert: async () => { throw new Error('D1 write error'); },
        },
    };
    const logger = createCapturingLogger();

    const result = await syncRecord('filterCache', 'fc-bad', { content: '' }, broken, logger);

    assertEquals(result.success, false);
    assertExists(result.error);
    assertEquals(result.error!.includes('D1 write error'), true);
    const errMsg = logger.messages.find(m => m.level === 'error');
    assertExists(errMsg);
});

// ===========================================================================
// invalidateRecord
// ===========================================================================

Deno.test('invalidateRecord: deletes existing record', async () => {
    const store: RecordStore = new Map([
        ['fc-1', { id: 'fc-1', source: 'x', content: '[]', hash: 'h' }],
    ]);
    const prisma = createMockD1Prisma({ filterCache: store });

    const result = await invalidateRecord('filterCache', 'fc-1', prisma);

    assertEquals(result.success, true);
    assertEquals(store.has('fc-1'), false);
});

Deno.test('invalidateRecord: succeeds when record does not exist (P2025)', async () => {
    const prisma = createMockD1Prisma();
    const logger = createCapturingLogger();

    const result = await invalidateRecord('filterCache', 'missing', prisma, logger);

    assertEquals(result.success, true);
    // Should have logged a debug message about the record being absent.
    const debugMsg = logger.messages.find(m => m.msg.includes('already absent'));
    assertExists(debugMsg);
});

Deno.test('invalidateRecord: returns error on unexpected failure', async () => {
    const broken = {
        filterCache: {
            delete: async () => { throw new Error('unexpected'); },
        },
    };

    const result = await invalidateRecord('filterCache', 'fc-1', broken);

    assertEquals(result.success, false);
    assertExists(result.error);
});

// ===========================================================================
// isCacheStale
// ===========================================================================

Deno.test('isCacheStale: returns true for missing record', async () => {
    const prisma = createMockD1Prisma();

    const stale = await isCacheStale('filterCache', 'missing', prisma, 300);

    assertEquals(stale, true);
});

Deno.test('isCacheStale: returns false for fresh record', async () => {
    const store: RecordStore = new Map([
        ['fc-1', { id: 'fc-1', updatedAt: new Date().toISOString() }],
    ]);
    const prisma = createMockD1Prisma({ filterCache: store });

    const stale = await isCacheStale('filterCache', 'fc-1', prisma, 300);

    assertEquals(stale, false);
});

Deno.test('isCacheStale: returns true for expired record', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
    const store: RecordStore = new Map([
        ['fc-1', { id: 'fc-1', updatedAt: tenMinutesAgo }],
    ]);
    const prisma = createMockD1Prisma({ filterCache: store });

    // maxAge = 300s (5 min), record is 10 min old → stale
    const stale = await isCacheStale('filterCache', 'fc-1', prisma, 300);

    assertEquals(stale, true);
});

Deno.test('isCacheStale: falls back to createdAt when updatedAt is absent', async () => {
    const store: RecordStore = new Map([
        ['fc-1', { id: 'fc-1', createdAt: new Date().toISOString() }],
    ]);
    const prisma = createMockD1Prisma({ filterCache: store });

    const stale = await isCacheStale('filterCache', 'fc-1', prisma, 300);

    assertEquals(stale, false);
});

Deno.test('isCacheStale: returns true when record has no timestamp fields', async () => {
    const store: RecordStore = new Map([
        ['fc-1', { id: 'fc-1' }],
    ]);
    const prisma = createMockD1Prisma({ filterCache: store });
    const logger = createCapturingLogger();

    const stale = await isCacheStale('filterCache', 'fc-1', prisma, 300, logger);

    assertEquals(stale, true);
    const warnMsg = logger.messages.find(m => m.level === 'warn' && m.msg.includes('no timestamp'));
    assertExists(warnMsg);
});

Deno.test('isCacheStale: returns true on error (safe default)', async () => {
    const broken = {
        filterCache: {
            findUnique: async () => { throw new Error('D1 read error'); },
        },
    };

    const stale = await isCacheStale('filterCache', 'fc-1', broken, 300);

    assertEquals(stale, true);
});

// ===========================================================================
// syncBatch
// ===========================================================================

Deno.test('syncBatch: empty batch returns success immediately', async () => {
    const prisma = createMockD1Prisma();

    const result = await syncBatch('filterCache', [], prisma);

    assertEquals(result.success, true);
    assertEquals(result.total, 0);
    assertEquals(result.synced, 0);
});

Deno.test('syncBatch: syncs multiple records in a transaction', async () => {
    const store: RecordStore = new Map();
    const prisma = createMockD1Prisma({ filterCache: store });

    const records = [
        { id: 'fc-1', data: { source: 'a', content: '[]', hash: 'h1' } },
        { id: 'fc-2', data: { source: 'b', content: '[]', hash: 'h2' } },
        { id: 'fc-3', data: { source: 'c', content: '[]', hash: 'h3' } },
    ];

    const result = await syncBatch('filterCache', records, prisma);

    assertEquals(result.success, true);
    assertEquals(result.total, 3);
    assertEquals(result.synced, 3);
    assertEquals(result.failed, 0);
    assertEquals(store.has('fc-1'), true);
    assertEquals(store.has('fc-2'), true);
    assertEquals(store.has('fc-3'), true);
});

Deno.test('syncBatch: falls back to individual upserts when transaction fails', async () => {
    const store: RecordStore = new Map();
    const prisma = createMockD1Prisma({ filterCache: store }, { transactionFail: true });
    const logger = createCapturingLogger();

    const records = [
        { id: 'fc-1', data: { source: 'a', content: '[]', hash: 'h1' } },
        { id: 'fc-2', data: { source: 'b', content: '[]', hash: 'h2' } },
    ];

    const result = await syncBatch('filterCache', records, prisma, logger);

    // Individual fallback should still succeed.
    assertEquals(result.success, true);
    assertEquals(result.synced, 2);
    // Logger should mention the transaction failure.
    const warnMsg = logger.messages.find(m => m.level === 'warn' && m.msg.includes('transaction failed'));
    assertExists(warnMsg);
});

Deno.test('syncBatch: reports partial failures in individual fallback', async () => {
    // Delegate that fails on a specific id.
    let callCount = 0;
    const failingDelegate = {
        upsert: async ({ create }: { where: unknown; update: unknown; create: { id: string } }) => {
            callCount++;
            if (create.id === 'fc-bad') {
                throw new Error('write error');
            }
            return create;
        },
    };

    const prisma = {
        filterCache: failingDelegate,
        $transaction: async () => { throw new Error('force individual fallback'); },
    };

    const records = [
        { id: 'fc-1', data: { source: 'a', content: '[]', hash: 'h1' } },
        { id: 'fc-bad', data: { source: 'bad', content: '[]', hash: 'h' } },
        { id: 'fc-3', data: { source: 'c', content: '[]', hash: 'h3' } },
    ];

    const result: BatchSyncResult = await syncBatch('filterCache', records, prisma);

    assertEquals(result.success, false);
    assertEquals(result.total, 3);
    assertEquals(result.synced, 2);
    assertEquals(result.failed, 1);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].includes('write error'), true);
});

Deno.test('syncBatch: logs batch progress', async () => {
    const store: RecordStore = new Map();
    const prisma = createMockD1Prisma({ user: store });
    const logger = createCapturingLogger();

    const records = [
        { id: 'u-1', data: { email: 'a@test.com' } },
    ];

    await syncBatch('user', records, prisma, logger);

    const infoMsg = logger.messages.find(m => m.level === 'info' && m.msg.includes('batch synced'));
    assertExists(infoMsg);
});

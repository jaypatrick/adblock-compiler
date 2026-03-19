/**
 * Unit tests for worker/handlers/queue.ts
 *
 * Covers pure/near-pure exports:
 *   compress/decompress, getCacheKey, processInChunks,
 *   handleQueueCancel, handleQueueHistory, handleQueueStats,
 *   emitDiagnosticsToTailWorker, QUEUE_BINDINGS_NOT_AVAILABLE_ERROR
 */

import { assertEquals, assertExists, assertNotEquals } from '@std/assert';
import type { Env } from '../types.ts';
import {
    compress,
    decompress,
    emitDiagnosticsToTailWorker,
    getCacheKey,
    handleQueueCancel,
    handleQueueHistory,
    handleQueueStats,
    processInChunks,
    QUEUE_BINDINGS_NOT_AVAILABLE_ERROR,
} from './queue.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: {
            get: async (_key: string) => null,
            put: async () => undefined,
        } as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

// ============================================================================
// compress / decompress
// ============================================================================

Deno.test('compress/decompress - round-trip returns original string', async () => {
    const original = 'hello world filter rules\n||example.com^';
    const compressed = await compress(original);
    const restored = await decompress(compressed);
    assertEquals(restored, original);
});

Deno.test('compress/decompress - round-trip with empty string', async () => {
    const original = '';
    const compressed = await compress(original);
    const restored = await decompress(compressed);
    assertEquals(restored, original);
});

Deno.test('compress/decompress - round-trip with multi-line content', async () => {
    const original = Array.from({ length: 100 }, (_, i) => `||line-${i}.example.com^`).join('\n');
    const compressed = await compress(original);
    const restored = await decompress(compressed);
    assertEquals(restored, original);
});

Deno.test('compress/decompress - round-trip with unicode content (emoji and accented chars)', async () => {
    const original = '! 🚫 Règles de filtrage — café résumé naïve\n||例え.com^\n||example.com/фильтр^';
    const compressed = await compress(original);
    const restored = await decompress(compressed);
    assertEquals(restored, original);
});

// ============================================================================
// getCacheKey
// ============================================================================

Deno.test('getCacheKey - same config produces same key (deterministic)', async () => {
    const config = { name: 'Test', sources: [{ source: 'https://example.com/list.txt' }] };
    const key1 = await getCacheKey(config);
    const key2 = await getCacheKey(config);
    assertEquals(key1, key2);
});

Deno.test('getCacheKey - different configs produce different keys', async () => {
    const key1 = await getCacheKey({ name: 'A' });
    const key2 = await getCacheKey({ name: 'B' });
    assertNotEquals(key1, key2);
});

Deno.test('getCacheKey - key order is stable (stableStringify)', async () => {
    const configA = { b: 2, a: 1 };
    const configB = { a: 1, b: 2 };
    const key1 = await getCacheKey(configA);
    const key2 = await getCacheKey(configB);
    assertEquals(key1, key2);
});

Deno.test('getCacheKey - returns a non-empty string prefixed with cache:', async () => {
    const key = await getCacheKey({ name: 'Test' });
    assertExists(key);
    assertEquals(key.startsWith('cache:'), true);
});

// ============================================================================
// processInChunks
// ============================================================================

Deno.test('processInChunks - empty array returns zero counts', async () => {
    const result = await processInChunks([], 2, async (_item) => {});
    assertEquals(result.successful, 0);
    assertEquals(result.failed, 0);
    assertEquals(result.failures.length, 0);
});

Deno.test('processInChunks - all items succeed', async () => {
    const items = [1, 2, 3];
    const result = await processInChunks(items, 2, async (_item) => {});
    assertEquals(result.successful, 3);
    assertEquals(result.failed, 0);
    assertEquals(result.failures.length, 0);
});

Deno.test('processInChunks - some items fail', async () => {
    const items = ['a', 'b', 'c'];
    const result = await processInChunks(
        items,
        2,
        async (item) => {
            if (item === 'b') throw new Error('boom');
        },
        (item) => `id-${item}`,
    );
    assertEquals(result.successful, 2);
    assertEquals(result.failed, 1);
    assertEquals(result.failures[0].item, 'id-b');
    assertEquals(result.failures[0].error, 'boom');
});

Deno.test('processInChunks - getItemId callback used in failure message', async () => {
    const items = [42];
    const result = await processInChunks(
        items,
        1,
        async (_item) => {
            throw new Error('fail');
        },
        (item) => `custom-id-${item}`,
    );
    assertEquals(result.failures[0].item, 'custom-id-42');
});

Deno.test('processInChunks - uses default item id when getItemId not provided', async () => {
    const items = ['x'];
    const result = await processInChunks(
        items,
        1,
        async (_item) => {
            throw new Error('fail');
        },
    );
    assertEquals(result.failures[0].item, 'item-0');
});

// ============================================================================
// handleQueueCancel
// ============================================================================

Deno.test('handleQueueCancel - valid requestId returns 200 with message', async () => {
    const env = makeEnv();
    const res = await handleQueueCancel('req-abc', env);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertExists(body.message);
});

Deno.test('handleQueueCancel - empty requestId returns 400', async () => {
    const env = makeEnv();
    const res = await handleQueueCancel('', env);
    assertEquals(res.status, 400);
});

// ============================================================================
// handleQueueHistory
// ============================================================================

Deno.test('handleQueueHistory - returns 200 with history and depthHistory arrays', async () => {
    const env = makeEnv();
    const res = await handleQueueHistory(env);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertExists(body.history);
    assertExists(body.depthHistory);
    assertEquals(Array.isArray(body.history), true);
    assertEquals(Array.isArray(body.depthHistory), true);
});

// ============================================================================
// handleQueueStats
// ============================================================================

Deno.test('handleQueueStats - returns 200', async () => {
    const env = makeEnv();
    const res = await handleQueueStats(env);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertExists(body);
});

// ============================================================================
// emitDiagnosticsToTailWorker
// ============================================================================

Deno.test('emitDiagnosticsToTailWorker - does not throw with empty array', () => {
    emitDiagnosticsToTailWorker([]);
});

// ============================================================================
// QUEUE_BINDINGS_NOT_AVAILABLE_ERROR
// ============================================================================

Deno.test('QUEUE_BINDINGS_NOT_AVAILABLE_ERROR - is a non-empty string', () => {
    assertEquals(typeof QUEUE_BINDINGS_NOT_AVAILABLE_ERROR, 'string');
    assertEquals(QUEUE_BINDINGS_NOT_AVAILABLE_ERROR.length > 0, true);
});

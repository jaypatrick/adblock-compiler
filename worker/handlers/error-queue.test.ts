/**
 * Unit tests for worker/handlers/error-queue.ts
 *
 * Tests the error queue consumer handler and error log persistence to R2.
 */

import { assertEquals } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';
import { handleErrorQueue } from './error-queue.ts';
import type { ErrorQueueMessage } from '../types.ts';
import { UserTier } from '../types.ts';

// ============================================================================
// R2 Bucket Stub
// ============================================================================

/**
 * In-memory R2Bucket stub for testing error log persistence.
 */
function makeInMemoryR2(): R2Bucket {
    const store = new Map<string, { value: string; metadata: Record<string, string> }>();

    return {
        async put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { customMetadata?: Record<string, string> }) {
            const stringValue = typeof value === 'string' ? value : '';
            store.set(key, {
                value: stringValue,
                metadata: options?.customMetadata || {},
            });
        },
        async get(key: string) {
            const item = store.get(key);
            if (!item) return null;
            return {
                text: async () => item.value,
                json: async () => JSON.parse(item.value),
                arrayBuffer: async () => new TextEncoder().encode(item.value).buffer,
                blob: async () => new Blob([item.value]),
                body: null as unknown as ReadableStream,
                bodyUsed: false,
                customMetadata: item.metadata,
            } as unknown as R2ObjectBody;
        },
        async delete(_key: string) {
            // Not needed for error queue tests
        },
        async list(_options?: { prefix?: string }) {
            // Return all keys for simplicity
            const keys = [...store.keys()].map((name) => ({ key: name }));
            return {
                objects: keys as unknown as R2Object[],
                truncated: false,
                cursor: '',
                delimitedPrefixes: [],
            };
        },
        // Add other required R2Bucket methods as stubs
        head: async () => null as unknown as R2Object,
        createMultipartUpload: async () => ({} as unknown as R2MultipartUpload),
    } as unknown as R2Bucket;
}

// ============================================================================
// Message Stub
// ============================================================================

/**
 * Create a mock MessageBatch for testing.
 */
function makeMockMessageBatch(messages: ErrorQueueMessage[]): MessageBatch<ErrorQueueMessage> {
    const messageObjects = messages.map((body) => ({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        body,
        attempts: 1,
        ack: () => {},
        retry: () => {},
    }));

    return {
        queue: 'adblock-compiler-error-queue',
        messages: messageObjects,
        ackAll: () => {},
        retryAll: () => {},
    };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('handleErrorQueue - empty batch processes without errors', async () => {
    const r2 = makeInMemoryR2();
    const env = makeEnv({ ERROR_BUCKET: r2 });

    const batch = makeMockMessageBatch([]);

    await handleErrorQueue(batch, env);

    // No errors should be thrown, and no R2 writes should occur
    const list = await r2.list();
    assertEquals(list.objects.length, 0);
});

Deno.test('handleErrorQueue - single error message persisted to R2', async () => {
    const r2 = makeInMemoryR2();
    const env = makeEnv({ ERROR_BUCKET: r2 });

    const errorMessage: ErrorQueueMessage = {
        errorId: 'error-123',
        timestamp: Date.now(),
        method: 'GET',
        path: '/api/compile',
        requestId: 'req-456',
        errorMessage: 'Test error',
        errorStack: 'Error: Test error\n  at ...',
        clientIp: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
        userId: 'user-789',
        tier: UserTier.Pro,
    };

    const batch = makeMockMessageBatch([errorMessage]);

    await handleErrorQueue(batch, env);

    // Verify error was written to R2
    const list = await r2.list();
    assertEquals(list.objects.length, 1);

    const key = list.objects[0].key;
    const date = new Date(errorMessage.timestamp).toISOString().split('T')[0];
    assertEquals(key.startsWith(`errors/${date}/`), true);
    assertEquals(key.endsWith('.jsonl'), true);

    // Verify JSONL content
    const obj = await r2.get(key);
    const content = await obj!.text();
    const lines = content.trim().split('\n');
    assertEquals(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assertEquals(parsed.errorId, errorMessage.errorId);
    assertEquals(parsed.errorMessage, errorMessage.errorMessage);
    assertEquals(parsed.method, errorMessage.method);
});

Deno.test('handleErrorQueue - multiple errors batched by date', async () => {
    const r2 = makeInMemoryR2();
    const env = makeEnv({ ERROR_BUCKET: r2 });

    const now = Date.now();
    const yesterday = now - 86400000; // 24 hours ago

    const errors: ErrorQueueMessage[] = [
        {
            errorId: 'error-1',
            timestamp: now,
            method: 'POST',
            path: '/api/compile',
            requestId: 'req-1',
            errorMessage: 'Today error 1',
        },
        {
            errorId: 'error-2',
            timestamp: now,
            method: 'POST',
            path: '/api/compile',
            requestId: 'req-2',
            errorMessage: 'Today error 2',
        },
        {
            errorId: 'error-3',
            timestamp: yesterday,
            method: 'GET',
            path: '/api/info',
            requestId: 'req-3',
            errorMessage: 'Yesterday error',
        },
    ];

    const batch = makeMockMessageBatch(errors);

    await handleErrorQueue(batch, env);

    // Verify 2 files written (one for today, one for yesterday)
    const list = await r2.list();
    assertEquals(list.objects.length, 2);

    // Verify each file has correct date prefix
    const todayDate = new Date(now).toISOString().split('T')[0];
    const yesterdayDate = new Date(yesterday).toISOString().split('T')[0];

    const todayFile = list.objects.find((obj) => obj.key.startsWith(`errors/${todayDate}/`));
    const yesterdayFile = list.objects.find((obj) => obj.key.startsWith(`errors/${yesterdayDate}/`));

    assertEquals(!!todayFile, true);
    assertEquals(!!yesterdayFile, true);

    // Verify today's file has 2 errors
    const todayObj = await r2.get(todayFile!.key);
    const todayContent = await todayObj!.text();
    const todayLines = todayContent.trim().split('\n');
    assertEquals(todayLines.length, 2);

    // Verify yesterday's file has 1 error
    const yesterdayObj = await r2.get(yesterdayFile!.key);
    const yesterdayContent = await yesterdayObj!.text();
    const yesterdayLines = yesterdayContent.trim().split('\n');
    assertEquals(yesterdayLines.length, 1);
});

Deno.test('handleErrorQueue - skips invalid messages and acks them', async () => {
    const r2 = makeInMemoryR2();
    const env = makeEnv({ ERROR_BUCKET: r2 });

    let acked = 0;
    const messages: ErrorQueueMessage[] = [
        {
            errorId: 'error-1',
            timestamp: Date.now(),
            method: 'GET',
            path: '/api/compile',
            requestId: 'req-1',
            errorMessage: 'Valid error',
        },
        {
            // Missing errorId - invalid
            errorId: '',
            timestamp: Date.now(),
            method: 'GET',
            path: '/api/compile',
            requestId: 'req-2',
            errorMessage: 'Invalid error',
        },
    ];

    const batch = {
        queue: 'adblock-compiler-error-queue',
        messages: messages.map((body) => ({
            id: crypto.randomUUID(),
            timestamp: new Date(),
            body,
            attempts: 1,
            ack: () => {
                acked++;
            },
            retry: () => {},
        })),
        ackAll: () => {},
        retryAll: () => {},
    };

    await handleErrorQueue(batch, env);

    // Both messages should be acked (valid + invalid)
    assertEquals(acked, 2);

    // Only 1 error written to R2 (the valid one)
    const list = await r2.list();
    assertEquals(list.objects.length, 1);
});

Deno.test('handleErrorQueue - handles missing ERROR_BUCKET gracefully', async () => {
    const env = makeEnv({ ERROR_BUCKET: undefined });

    const errorMessage: ErrorQueueMessage = {
        errorId: 'error-123',
        timestamp: Date.now(),
        method: 'GET',
        path: '/api/compile',
        requestId: 'req-456',
        errorMessage: 'Test error',
    };

    const batch = makeMockMessageBatch([errorMessage]);

    // Should not throw, just log warning
    await handleErrorQueue(batch, env);
});

Deno.test('handleErrorQueue - JSONL format with newline termination', async () => {
    const r2 = makeInMemoryR2();
    const env = makeEnv({ ERROR_BUCKET: r2 });

    const errors: ErrorQueueMessage[] = [
        {
            errorId: 'error-1',
            timestamp: Date.now(),
            method: 'GET',
            path: '/api/compile',
            requestId: 'req-1',
            errorMessage: 'Error 1',
        },
        {
            errorId: 'error-2',
            timestamp: Date.now(),
            method: 'POST',
            path: '/api/compile',
            requestId: 'req-2',
            errorMessage: 'Error 2',
        },
    ];

    const batch = makeMockMessageBatch(errors);

    await handleErrorQueue(batch, env);

    const list = await r2.list();
    assertEquals(list.objects.length, 1);

    const obj = await r2.get(list.objects[0].key);
    const content = await obj!.text();

    // JSONL should have newline after each line AND at the end
    assertEquals(content.endsWith('\n'), true);
    const lines = content.split('\n').filter((line) => line.length > 0);
    assertEquals(lines.length, 2);

    // Each line should be valid JSON
    const parsed1 = JSON.parse(lines[0]);
    const parsed2 = JSON.parse(lines[1]);
    assertEquals(parsed1.errorId, 'error-1');
    assertEquals(parsed2.errorId, 'error-2');
});

Deno.test('handleErrorQueue - R2 custom metadata includes batch info', async () => {
    const r2 = makeInMemoryR2();
    const env = makeEnv({ ERROR_BUCKET: r2 });

    const errors: ErrorQueueMessage[] = [
        {
            errorId: 'error-1',
            timestamp: Date.now(),
            method: 'GET',
            path: '/api/compile',
            requestId: 'req-1',
            errorMessage: 'Error 1',
        },
    ];

    const batch = makeMockMessageBatch(errors);

    await handleErrorQueue(batch, env);

    const list = await r2.list();
    const obj = await r2.get(list.objects[0].key);
    const metadata = obj!.customMetadata!;

    assertEquals(metadata.errorCount, '1');
    assertEquals(!!metadata.batchId, true);
    assertEquals(!!metadata.dateKey, true);
});

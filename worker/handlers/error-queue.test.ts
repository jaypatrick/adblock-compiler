/**
 * Unit tests for worker/handlers/error-queue.ts
 *
 * Covers:
 *   buildErrorLogKey        — correct R2 key partitioning
 *   serializeToNdjson       — NDJSON format
 *   handleErrorQueue        — R2 write, graceful fallback when ERROR_BUCKET absent
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';
import type { ErrorQueueMessage } from '../types.ts';
import { buildErrorLogKey, handleErrorQueue, serializeToNdjson } from './error-queue.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeErrorMessage(overrides: Partial<ErrorQueueMessage> = {}): ErrorQueueMessage {
    return {
        type: 'error',
        requestId: 'test-req-1',
        timestamp: '2026-04-07T12:00:00.000Z',
        path: '/api/compile',
        method: 'POST',
        message: 'Something went wrong',
        stack: 'Error: Something went wrong\n    at handler (worker.ts:42)',
        errorDetails: 'Error: Something went wrong\n    at handler (worker.ts:42)',
        ...overrides,
    };
}

/** Minimal R2Bucket stub that captures put() calls. */
interface PutCall {
    key: string;
    body: string;
    contentType?: string;
    customMetadata?: Record<string, string>;
}

function makeR2Bucket(): { bucket: R2Bucket; calls: PutCall[] } {
    const calls: PutCall[] = [];
    const bucket = {
        async put(
            key: string,
            value: string,
            options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
        ) {
            calls.push({
                key,
                body: value,
                contentType: options?.httpMetadata?.contentType,
                customMetadata: options?.customMetadata,
            });
        },
        // Stub unused methods
        get: async () => null,
        head: async () => null,
        delete: async () => {},
        list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
        createMultipartUpload: async () => ({
            uploadId: '',
            key: '',
            uploadPart: async () => ({ partNumber: 1, etag: '' }),
            complete: async () => ({ key: '', size: 0, etag: '', httpEtag: '', checksums: {}, uploaded: new Date(), version: '', storageClass: '' }),
            abort: async () => {},
        }),
        resumeMultipartUpload: () => ({
            uploadId: '',
            key: '',
            uploadPart: async () => ({ partNumber: 1, etag: '' }),
            complete: async () => ({ key: '', size: 0, etag: '', httpEtag: '', checksums: {}, uploaded: new Date(), version: '', storageClass: '' }),
            abort: async () => {},
        }),
    } as unknown as R2Bucket;
    return { bucket, calls };
}

/** Minimal MessageBatch stub. */
function makeBatch(messages: ErrorQueueMessage[], queueName = 'adblock-compiler-error-queue'): MessageBatch<ErrorQueueMessage> {
    return {
        queue: queueName,
        messages: messages.map((body, i) => ({
            id: `msg-${i}`,
            body,
            timestamp: new Date(),
            attempts: 1,
            ack: () => {},
            retry: () => {},
            ackAll: () => {},
            retryAll: () => {},
        })),
        ackAll: () => {},
        retryAll: () => {},
    } as unknown as MessageBatch<ErrorQueueMessage>;
}

// ============================================================================
// buildErrorLogKey
// ============================================================================

Deno.test('buildErrorLogKey - produces correctly partitioned R2 key', () => {
    const date = new Date('2026-04-07T15:30:00.000Z');
    const key = buildErrorLogKey(date, 'batch-abc123');
    assertEquals(key, 'errors/2026/04/07/15/batch-abc123.ndjson');
});

Deno.test('buildErrorLogKey - zero-pads month, day, and hour', () => {
    const date = new Date('2026-01-03T05:00:00.000Z');
    const key = buildErrorLogKey(date, 'b1');
    assertEquals(key, 'errors/2026/01/03/05/b1.ndjson');
});

Deno.test('buildErrorLogKey - uses UTC values', () => {
    // UTC midnight is still 2026-04-07, regardless of local timezone
    const date = new Date('2026-04-07T00:00:00.000Z');
    const key = buildErrorLogKey(date, 'b2');
    assertStringIncludes(key, 'errors/2026/04/07/00/');
});

// ============================================================================
// serializeToNdjson
// ============================================================================

Deno.test('serializeToNdjson - single message produces single JSON line', () => {
    const msg = makeErrorMessage();
    const result = serializeToNdjson([msg]);
    const lines = result.split('\n').filter((l) => l.length > 0);
    assertEquals(lines.length, 1);
    const parsed = JSON.parse(lines[0]) as ErrorQueueMessage;
    assertEquals(parsed.requestId, 'test-req-1');
    assertEquals(parsed.type, 'error');
});

Deno.test('serializeToNdjson - multiple messages produce one line each', () => {
    const messages = [
        makeErrorMessage({ requestId: 'req-1' }),
        makeErrorMessage({ requestId: 'req-2' }),
        makeErrorMessage({ requestId: 'req-3' }),
    ];
    const result = serializeToNdjson(messages);
    const lines = result.split('\n');
    assertEquals(lines.length, 3);
    assertEquals((JSON.parse(lines[0]) as ErrorQueueMessage).requestId, 'req-1');
    assertEquals((JSON.parse(lines[1]) as ErrorQueueMessage).requestId, 'req-2');
    assertEquals((JSON.parse(lines[2]) as ErrorQueueMessage).requestId, 'req-3');
});

Deno.test('serializeToNdjson - empty array produces empty string', () => {
    const result = serializeToNdjson([]);
    assertEquals(result, '');
});

// ============================================================================
// handleErrorQueue
// ============================================================================

Deno.test('handleErrorQueue - writes NDJSON batch to ERROR_BUCKET', async () => {
    const { bucket, calls } = makeR2Bucket();
    const env = makeEnv({ ERROR_BUCKET: bucket });
    const messages = [makeErrorMessage({ requestId: 'r1' }), makeErrorMessage({ requestId: 'r2' })];
    const batch = makeBatch(messages);

    await handleErrorQueue(batch, env);

    assertEquals(calls.length, 1, 'should make exactly one R2 put call');
    const [call] = calls;
    assertStringIncludes(call.key, 'errors/');
    assertStringIncludes(call.key, '.ndjson');
    assertEquals(call.contentType, 'application/x-ndjson');

    // Verify NDJSON content round-trips correctly
    const lines = call.body.split('\n');
    assertEquals(lines.length, 2);
    assertEquals((JSON.parse(lines[0]) as ErrorQueueMessage).requestId, 'r1');
    assertEquals((JSON.parse(lines[1]) as ErrorQueueMessage).requestId, 'r2');
});

Deno.test('handleErrorQueue - R2 key uses current UTC time partitioning', async () => {
    const { bucket, calls } = makeR2Bucket();
    const env = makeEnv({ ERROR_BUCKET: bucket });
    const batch = makeBatch([makeErrorMessage()]);

    const before = new Date();
    await handleErrorQueue(batch, env);
    const after = new Date();

    assertEquals(calls.length, 1);
    const key = calls[0].key;
    // Key should contain the year of the test run
    assertStringIncludes(key, before.getUTCFullYear().toString());
    // Prefix must be errors/
    assertStringIncludes(key, 'errors/');
    // Suffix must be .ndjson
    assertStringIncludes(key, '.ndjson');

    void after; // suppress unused variable lint
});

Deno.test('handleErrorQueue - sets customMetadata with batchSize and queueName', async () => {
    const { bucket, calls } = makeR2Bucket();
    const env = makeEnv({ ERROR_BUCKET: bucket });
    const batch = makeBatch([makeErrorMessage(), makeErrorMessage()], 'adblock-compiler-error-queue');

    await handleErrorQueue(batch, env);

    assertEquals(calls.length, 1);
    const meta = calls[0].customMetadata;
    assertEquals(meta?.batchSize, '2');
    assertEquals(meta?.queueName, 'adblock-compiler-error-queue');
});

Deno.test('handleErrorQueue - acks all messages even when ERROR_BUCKET is absent', async () => {
    const env = makeEnv(); // no ERROR_BUCKET
    const ackedIds: string[] = [];
    const messages = [makeErrorMessage({ requestId: 'r1' }), makeErrorMessage({ requestId: 'r2' })];

    const batch = {
        queue: 'adblock-compiler-error-queue',
        messages: messages.map((body, i) => ({
            id: `msg-${i}`,
            body,
            timestamp: new Date(),
            attempts: 1,
            ack: () => {
                ackedIds.push(`msg-${i}`);
            },
            retry: () => {},
            ackAll: () => {},
            retryAll: () => {},
        })),
        ackAll: () => {},
        retryAll: () => {},
    } as unknown as MessageBatch<ErrorQueueMessage>;

    // Should not throw even without ERROR_BUCKET
    await handleErrorQueue(batch, env);

    assertEquals(ackedIds.length, 2, 'all messages must be acked even when R2 is absent');
});

Deno.test('handleErrorQueue - gracefully handles R2 write failure', async () => {
    const failingBucket = {
        put: async () => {
            throw new Error('R2 write error');
        },
        get: async () => null,
        head: async () => null,
        delete: async () => {},
        list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
    } as unknown as R2Bucket;

    const env = makeEnv({ ERROR_BUCKET: failingBucket });
    const batch = makeBatch([makeErrorMessage()]);

    // Should not throw even when R2 fails
    await handleErrorQueue(batch, env);
});

Deno.test('handleErrorQueue - handles empty batch gracefully', async () => {
    const { bucket, calls } = makeR2Bucket();
    const env = makeEnv({ ERROR_BUCKET: bucket });
    const batch = makeBatch([]);

    await handleErrorQueue(batch, env);

    assertEquals(calls.length, 0, 'empty batch should not write to R2');
});

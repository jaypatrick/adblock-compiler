/**
 * Tests for CloudflareQueueProvider
 */

import { assertEquals } from '@std/assert';
import type { IBasicLogger } from '../types/index.ts';
import type { AnyQueueMessage } from './IQueueProvider.ts';
import { CloudflareQueueProvider, createCloudflareQueueProvider } from './CloudflareQueueProvider.ts';

// Mock queue binding
class MockQueue {
    public sentMessages: unknown[] = [];
    public batches: Array<{ body: unknown }>[] = [];

    async send(message: unknown): Promise<void> {
        this.sentMessages.push(message);
    }

    async sendBatch(messages: Array<{ body: unknown }>): Promise<void> {
        this.batches.push(messages);
    }
}

// Helper to create a test message
function createTestMessage(id: string): AnyQueueMessage {
    return {
        id,
        type: 'health-check',
        priority: 'standard',
        createdAt: Date.now(),
        sources: [],
    } as AnyQueueMessage;
}

Deno.test('CloudflareQueueProvider - should create instance', () => {
    const provider = new CloudflareQueueProvider();
    assertEquals(provider.name, 'cloudflare');
});

Deno.test('CloudflareQueueProvider - should return false for health check when no binding', async () => {
    const provider = new CloudflareQueueProvider();
    assertEquals(await provider.healthCheck(), false);
});

Deno.test('CloudflareQueueProvider - should return true for health check when binding set', async () => {
    const provider = new CloudflareQueueProvider();
    provider.setBinding(new MockQueue());
    assertEquals(await provider.healthCheck(), true);
});

Deno.test('CloudflareQueueProvider - should fail send when no binding', async () => {
    const provider = new CloudflareQueueProvider();
    const msg = createTestMessage('test-1');
    const result = await provider.send(msg);
    assertEquals(result.success, false);
    assertEquals(result.error, 'Queue binding not initialized');
});

Deno.test('CloudflareQueueProvider - should log error via logger when processBatch handler fails and max retries exceeded', async () => {
    const errors: string[] = [];
    const testLogger: IBasicLogger = {
        info: () => {},
        warn: () => {},
        error: (message: string) => errors.push(message),
    };
    const provider = new CloudflareQueueProvider({ maxRetries: 0 }, testLogger);

    const msg = {
        id: 'test-msg-1',
        body: createTestMessage('test-msg-1'),
        timestamp: new Date(),
        attempts: 1,
        ack: () => {},
        retry: () => {},
    };
    const batch = {
        messages: [msg],
        queue: 'test-queue',
        ackAll: () => {},
        retryAll: () => {},
    };

    // deno-lint-ignore require-await
    await provider.processBatch(batch, async () => {
        throw new Error('Handler failed');
    });

    assertEquals(errors.length, 1);
    assertEquals(errors[0].includes('test-msg-1'), true);
    assertEquals(errors[0].includes('Handler failed'), true);
});

Deno.test('CloudflareQueueProvider - should log error via logger when wrapBatch message fails', async () => {
    const errors: string[] = [];
    const testLogger: IBasicLogger = {
        info: () => {},
        warn: () => {},
        error: (message: string) => errors.push(message),
    };
    const provider = new CloudflareQueueProvider(undefined, testLogger);

    const msg = {
        id: 'test-msg-2',
        body: createTestMessage('test-msg-2'),
        timestamp: new Date(),
        attempts: 1,
        ack: () => {},
        retry: () => {},
    };
    const batch = {
        messages: [msg],
        queue: 'test-queue',
        ackAll: () => {},
        retryAll: () => {},
    };

    const result = provider.wrapBatch(batch);
    assertEquals(result.messages.length, 1);

    await result.messages[0].fail('Test failure reason');

    assertEquals(errors.length, 1);
    assertEquals(errors[0].includes('test-msg-2'), true);
    assertEquals(errors[0].includes('Test failure reason'), true);
});

Deno.test('createCloudflareQueueProvider - should create provider with logger', async () => {
    const errors: string[] = [];
    const testLogger: IBasicLogger = {
        info: () => {},
        warn: () => {},
        error: (message: string) => errors.push(message),
    };

    const provider = createCloudflareQueueProvider(undefined, undefined, testLogger);
    assertEquals(provider.name, 'cloudflare');
    assertEquals(await provider.healthCheck(), false);
});

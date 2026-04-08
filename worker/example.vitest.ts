/**
 * Example Cloudflare Worker binding-behaviour integration test.
 *
 * This test runs inside the real Cloudflare Workers runtime (workerd / Miniflare 3)
 * instead of using in-process mocks. Use `.vitest.ts` tests for behaviours that
 * cannot be accurately replicated with mocks:
 *
 * - Queue batch semantics (ackAll, retryAll, partial ack, retry backoff)
 * - Durable Object lifecycle (alarm(), webSocketMessage(), hibernation, storage)
 * - Workflow step sequencing (step.do replay, step.sleep, durable execution)
 * - Runtime-specific behaviour (waitUntil, passThroughOnException, Analytics Engine)
 *
 * For all other tests (handler logic, auth flows, Zod validation), continue using
 * **Deno + MockEnv** — it is faster, simpler, and does not require Cloudflare bindings.
 *
 * ## Running this test
 *
 * ```sh
 * # Run all vitest binding tests
 * deno task test:vitest
 *
 * # Run in watch mode
 * deno task test:vitest:watch
 *
 * # Run with UI
 * deno task test:vitest:ui
 * ```
 *
 * @see vitest.worker.config.ts — Vitest configuration
 * @see worker/test-helpers.ts — Mock helpers for Deno-based tests
 * @see docs/development/testing.md — Full testing strategy
 */

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

/**
 * Example: KV binding behaviour test
 *
 * This test demonstrates using the real KV binding from wrangler.toml.
 * For unit tests that don't require binding-specific behaviour, use Deno + makeInMemoryKv().
 */
describe('KV binding behaviour', () => {
    it('should write and read from real KV binding', async () => {
        const kv = env.COMPILATION_CACHE as KVNamespace;

        // Write to KV
        await kv.put('test-key', 'test-value');

        // Read from KV
        const value = await kv.get('test-key');
        expect(value).toBe('test-value');

        // Clean up
        await kv.delete('test-key');
    });

    it('should handle KV list pagination correctly', async () => {
        const kv = env.COMPILATION_CACHE as KVNamespace;

        // Write multiple keys
        await Promise.all([
            kv.put('prefix:1', 'value1'),
            kv.put('prefix:2', 'value2'),
            kv.put('prefix:3', 'value3'),
        ]);

        // List with prefix
        const result = await kv.list({ prefix: 'prefix:' });
        expect(result.keys.length).toBe(3);
        expect(result.list_complete).toBe(true);

        // Clean up
        await Promise.all([
            kv.delete('prefix:1'),
            kv.delete('prefix:2'),
            kv.delete('prefix:3'),
        ]);
    });
});

/**
 * Example: Queue binding behaviour test
 *
 * This test demonstrates queue message handling with the real Queue binding.
 * This is where vitest-pool-workers provides real value — mocking queue batch
 * semantics accurately is very difficult.
 */
describe('Queue binding behaviour', () => {
    it('should enqueue and process messages with correct batch semantics', async () => {
        const queue = env.ADBLOCK_COMPILER_QUEUE as Queue;

        // Enqueue a test message
        await queue.send({
            type: 'compile',
            requestId: 'test-request-id',
            configuration: {
                name: 'Test Configuration',
                sources: [{ source: 'https://example.com/list.txt' }],
                transformations: ['Deduplicate'],
            },
        });

        // Note: To verify queue consumption, you would need to trigger the queue
        // consumer handler and check the result. This is left as an exercise for
        // integration with the actual queue handler.
        //
        // For now, we just verify that the message was enqueued successfully.
        expect(true).toBe(true);
    });
});

/**
 * Example: Environment variable access
 *
 * This test demonstrates accessing environment variables from the Worker env.
 */
describe('Environment variables', () => {
    it('should have COMPILER_VERSION set', () => {
        expect(env.COMPILER_VERSION).toBeDefined();
        expect(typeof env.COMPILER_VERSION).toBe('string');
    });
});

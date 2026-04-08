/**
 * Vitest Worker Configuration
 *
 * Uses `@cloudflare/vitest-pool-workers` to run integration tests against the
 * real Cloudflare Workers runtime environment (with real KV, D1, Queue, R2 bindings).
 *
 * ## When to use
 * - Tests that require Cloudflare-specific bindings (KV, D1, Queue, R2, Durable Objects)
 * - Integration tests for Hono routes that interact with bindings
 * - Tests that need the Workers runtime environment
 *
 * ## When NOT to use
 * - Pure TypeScript unit tests (use Deno test runner via `deno task test:src`)
 * - Tests that don't need Cloudflare bindings
 * - Tests that require Node.js-specific APIs
 *
 * @see https://hono.dev/examples/cloudflare-vitest
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 * @see docs/development/testing.md
 */

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {
                configPath: './wrangler.toml',
            },
            miniflare: {
                // Use in-memory storage for tests (not persistent)
                kvPersist: false,
                d1Persist: false,
                r2Persist: false,
                durableObjectsPersist: false,
            },
        }),
    ],
    test: {
        include: ['worker/**/*.vitest.test.ts'],
        exclude: [
            'node_modules/**',
            'dist/**',
            'frontend/**',
            'worker/**/*.test.ts', // Deno tests
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['worker/**/*.ts'],
            exclude: [
                'worker/**/*.test.ts',
                'worker/**/*.vitest.test.ts',
                'worker/test-helpers.ts',
                'worker/types.ts',
            ],
        },
    },
});

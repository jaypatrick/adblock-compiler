/**
 * vitest.worker.config.ts — Cloudflare Worker testing with @cloudflare/vitest-pool-workers
 *
 * This configuration enables **binding-behaviour integration tests** that run inside
 * the real Cloudflare Workers runtime (workerd / Miniflare 3) instead of using
 * in-process mocks.
 *
 * ## Test Tiers (after this integration)
 *
 * | Tier | Runner | Scope | Files |
 * |------|--------|-------|-------|
 * | Unit tests | Deno | Pure logic — compiler, transforms, utils, schemas | `src/**\/*.test.ts` |
 * | Worker handler tests | Deno + `MockEnv` | Handler logic, auth flows, Zod validation | `worker/**\/*.test.ts` |
 * | Binding-behaviour tests | Vitest + workerd | Queue batch semantics, DO lifecycle, Workflows | `worker/**\/*.vitest.ts` |
 * | E2E tests | Deno | Hits a live server | `worker/api.e2e.test.ts` |
 * | Frontend tests | Vitest | Angular components/services | `frontend/**\/*.spec.ts` |
 *
 * ## When to use vitest-pool-workers tests (`.vitest.ts` files)
 *
 * Use `.vitest.ts` tests for behaviours that **cannot** be accurately replicated
 * with in-process mocks:
 *
 * - **Queue batch semantics** — `ackAll`, `retryAll`, partial ack, retry backoff
 * - **Durable Object lifecycle** — `alarm()`, `webSocketMessage()`, hibernation, storage consistency
 * - **Workflow step sequencing** — `step.do` replay, `step.sleep`, durable execution guarantees
 * - **Runtime-specific behaviour** — `waitUntil`, `passThroughOnException`, Analytics Engine, Hyperdrive in an isolate
 *
 * For **all other tests** (handler logic, auth flows, Zod validation, rate limiting),
 * continue using **Deno + `MockEnv`** — it is faster, simpler, and does not require
 * Cloudflare bindings to be provisioned.
 *
 * ## Running tests
 *
 * ```sh
 * # Run binding-behaviour tests with workerd
 * deno task test:vitest
 *
 * # Run all test tiers
 * deno task test:all
 *
 * # Continue to use Deno for src/ and worker/ unit tests
 * deno task test:src
 * deno task test:worker
 * ```
 *
 * ## References
 * - https://hono.dev/examples/cloudflare-vitest
 * - https://developers.cloudflare.com/workers/testing/vitest-integration/
 * - https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples
 *
 * @see worker/test-helpers.ts — Mock helpers for Deno-based tests
 * @see docs/development/testing.md — Full testing strategy documentation
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
    test: {
        // Only run files with .vitest.ts extension (binding-behaviour tests)
        // Leave .test.ts files to Deno test runner (faster, simpler, no binding dependencies)
        include: ['worker/**/*.vitest.ts'],

        // Cloudflare Workers pool configuration
        poolOptions: {
            workers: {
                // Use wrangler.toml for binding configuration
                // This ensures tests use the same bindings as the production worker
                wrangler: {
                    configPath: './wrangler.toml',
                },

                // Miniflare 3 configuration options
                miniflare: {
                    // Enable compatibility flags from wrangler.toml
                    compatibilityDate: '2026-01-01',
                    compatibilityFlags: ['nodejs_compat'],

                    // Bindings for tests (fallback if wrangler.toml is incomplete)
                    // These will be overridden by wrangler.toml bindings
                    bindings: {
                        // Environment variables for tests
                        COMPILER_VERSION: '1.0.0-test',
                    },
                },

                // Isolate tests — each test file runs in its own worker
                singleWorker: false,

                // Main worker entry point
                main: './worker/worker.ts',
            },
        },

        // Global test timeout (binding tests may be slower than unit tests)
        testTimeout: 30_000, // 30 seconds

        // Hook timeout (setup/teardown)
        hookTimeout: 10_000, // 10 seconds
    },
});

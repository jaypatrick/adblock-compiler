/**
 * Tests for the Worker Error Reporter factory.
 *
 * Covers:
 *   - createWorkerErrorReporter: returns ConsoleErrorReporter by default
 *   - createWorkerErrorReporter: returns ConsoleErrorReporter for type 'console'
 *   - createWorkerErrorReporter: returns CloudflareErrorReporter when ANALYTICS_ENGINE present
 *   - createWorkerErrorReporter: falls back to console when 'cloudflare' type but no binding
 *   - createWorkerErrorReporter: returns SentryErrorReporter when SENTRY_DSN present
 *   - createWorkerErrorReporter: falls back to console when 'sentry' type but no DSN
 *   - createWorkerErrorReporter: returns CompositeErrorReporter for type 'composite'
 *   - createWorkerErrorReporter: returns NoOpErrorReporter for type 'none'
 *   - createWorkerErrorReporter: falls back to console for unknown type
 *
 * @see worker/utils/errorReporter.ts
 */

import { assertEquals, assertExists, assertInstanceOf } from '@std/assert';
import { createWorkerErrorReporter } from './errorReporter.ts';
import { CloudflareErrorReporter, CompositeErrorReporter, ConsoleErrorReporter, NoOpErrorReporter, SentryErrorReporter } from '../../src/utils/ErrorReporter.ts';
import type { Env } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('createWorkerErrorReporter - returns ConsoleErrorReporter by default (no type set)', () => {
    const env = makeEnv();
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, ConsoleErrorReporter);
});

Deno.test('createWorkerErrorReporter - returns ConsoleErrorReporter for type "console"', () => {
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'console' });
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, ConsoleErrorReporter);
});

Deno.test('createWorkerErrorReporter - returns CloudflareErrorReporter when type is "cloudflare" and ANALYTICS_ENGINE is bound', () => {
    const mockDataset = { writeDataPoint: () => {} } as unknown as AnalyticsEngineDataset;
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'cloudflare', ANALYTICS_ENGINE: mockDataset });
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, CloudflareErrorReporter);
});

Deno.test('createWorkerErrorReporter - falls back to ConsoleErrorReporter when type is "cloudflare" but no ANALYTICS_ENGINE', () => {
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'cloudflare' }); // no ANALYTICS_ENGINE
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, ConsoleErrorReporter);
});

Deno.test('createWorkerErrorReporter - returns SentryErrorReporter when type is "sentry" and SENTRY_DSN is set', () => {
    const env = makeEnv({
        ERROR_REPORTER_TYPE: 'sentry',
        SENTRY_DSN: 'https://key@o999.ingest.sentry.io/12345',
    });
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, SentryErrorReporter);
});

Deno.test('createWorkerErrorReporter - falls back to ConsoleErrorReporter when type is "sentry" but no SENTRY_DSN', () => {
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'sentry' }); // no SENTRY_DSN
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, ConsoleErrorReporter);
});

Deno.test('createWorkerErrorReporter - returns CompositeErrorReporter for type "composite"', () => {
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'composite' });
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, CompositeErrorReporter);
});

Deno.test('createWorkerErrorReporter - composite includes Cloudflare reporter when ANALYTICS_ENGINE is bound', () => {
    const mockDataset = { writeDataPoint: () => {} } as unknown as AnalyticsEngineDataset;
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'composite', ANALYTICS_ENGINE: mockDataset });
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, CompositeErrorReporter);
    assertExists(reporter);
});

Deno.test('createWorkerErrorReporter - returns NoOpErrorReporter for type "none"', () => {
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'none' });
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, NoOpErrorReporter);
});

Deno.test('createWorkerErrorReporter - falls back to ConsoleErrorReporter for unknown type', () => {
    const env = makeEnv({ ERROR_REPORTER_TYPE: 'unknown-type' });
    const reporter = createWorkerErrorReporter(env);
    assertInstanceOf(reporter, ConsoleErrorReporter);
});

Deno.test('createWorkerErrorReporter - reporter has report method', () => {
    const env = makeEnv();
    const reporter = createWorkerErrorReporter(env);
    assertEquals(typeof reporter.report, 'function');
});

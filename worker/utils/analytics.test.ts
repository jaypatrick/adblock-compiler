/**
 * Tests for the Analytics service factory.
 *
 * Covers:
 *   - createAnalyticsService returns an AnalyticsService instance
 *   - createAnalyticsService with ANALYTICS_ENGINE binding
 *   - createAnalyticsService without ANALYTICS_ENGINE (no-op)
 *
 * @see worker/utils/analytics.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { createAnalyticsService } from './analytics.ts';
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

Deno.test('createAnalyticsService - returns an AnalyticsService instance when ANALYTICS_ENGINE is unset', () => {
    const env = makeEnv();
    const service = createAnalyticsService(env);
    assertExists(service);
    // AnalyticsService must have typed tracking methods
    assertEquals(typeof service.trackCompilationRequest, 'function');
});

Deno.test('createAnalyticsService - returns an AnalyticsService instance when ANALYTICS_ENGINE is set', () => {
    const mockDataset = {
        writeDataPoint: (_data: unknown) => {},
    } as unknown as AnalyticsEngineDataset;

    const env = makeEnv({ ANALYTICS_ENGINE: mockDataset });
    const service = createAnalyticsService(env);
    assertExists(service);
    assertEquals(typeof service.trackCompilationRequest, 'function');
});

Deno.test('createAnalyticsService - no-op service does not throw when tracking compilation request', () => {
    const env = makeEnv(); // no ANALYTICS_ENGINE
    const service = createAnalyticsService(env);
    // Should not throw even without real bindings
    service.trackCompilationRequest({ configName: 'test', sourceCount: 1 });
});

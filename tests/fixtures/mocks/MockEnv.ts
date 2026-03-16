/**
 * Shared mock Env factory for Worker tests.
 *
 * Consolidates the duplicated createMockEnv() pattern found across
 * worker/middleware/*.test.ts, worker/services/*.test.ts, and
 * worker/queue.integration.test.ts into a single reusable factory.
 *
 * Usage:
 *   import { createMockEnv, createMockEnvWithAnalytics, MockKVNamespace } from '../../tests/fixtures/mocks/MockEnv.ts';
 */

import type { Env } from '../../../worker/types.ts';

// ============================================================================
// MockKVNamespace — in-memory KV store for testing
// ============================================================================

export class MockKVNamespace {
    private store: Map<string, { value: ArrayBuffer | string; expiration?: number }> = new Map();

    async get(key: string, type?: 'text' | 'json' | 'arrayBuffer'): Promise<unknown> {
        const entry = this.store.get(key);
        if (!entry) return null;

        if (entry.expiration && Date.now() > entry.expiration) {
            this.store.delete(key);
            return null;
        }

        if (type === 'arrayBuffer' && entry.value instanceof ArrayBuffer) {
            return entry.value;
        }
        if (type === 'json' && typeof entry.value === 'string') {
            return JSON.parse(entry.value);
        }
        if (type === 'text' && typeof entry.value === 'string') {
            return entry.value;
        }
        return entry.value;
    }

    async put(
        key: string,
        value: string | ArrayBuffer,
        options?: { expirationTtl?: number },
    ): Promise<void> {
        this.store.set(key, {
            value,
            expiration: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined,
        });
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    async list(): Promise<{ keys: Array<{ name: string }> }> {
        return {
            keys: Array.from(this.store.keys()).map((name) => ({ name })),
        };
    }

    clear(): void {
        this.store.clear();
    }
}

// ============================================================================
// MockAnalyticsEngine — captures writeDataPoint calls
// ============================================================================

export interface CapturedDataPoint {
    indexes: string[];
    doubles: number[];
    blobs: (string | null)[];
}

export class MockAnalyticsEngine {
    captured: CapturedDataPoint[] = [];

    writeDataPoint(dp: CapturedDataPoint): void {
        this.captured.push(dp);
    }

    clear(): void {
        this.captured = [];
    }
}

// ============================================================================
// createMockEnv — base factory with minimal stubs
// ============================================================================

/**
 * Creates a mock Env with the minimum required bindings.
 * Pass `overrides` to set or replace any specific binding.
 *
 * @example
 *   const env = createMockEnv({ MAX_REQUEST_BODY_MB: '50' });
 *   const envWithDsn = createMockEnv({ SENTRY_DSN: 'https://test@sentry.io/123' });
 */
export function createMockEnv(overrides?: Partial<Env>): Env {
    const kv = new MockKVNamespace();
    return {
        COMPILER_VERSION: '0.0.0-test',
        COMPILATION_CACHE: kv as unknown as KVNamespace,
        RATE_LIMIT: kv as unknown as KVNamespace,
        METRICS: kv as unknown as KVNamespace,
        RULES_KV: kv as unknown as KVNamespace,
        ASSETS: { fetch: async () => new Response('mock-asset') } as unknown as Fetcher,
        MAX_REQUEST_BODY_MB: '10',
        ...overrides,
    } as Env;
}

// ============================================================================
// createMockEnvWithAnalytics — includes Analytics Engine capture
// ============================================================================

/**
 * Creates a mock Env with a MockAnalyticsEngine that captures writeDataPoint calls.
 * Returns the env and the captured data points array for assertions.
 *
 * @example
 *   const { env, analytics } = createMockEnvWithAnalytics();
 *   trackAdminAction(env, { ... });
 *   assertEquals(analytics.captured.length, 1);
 */
export function createMockEnvWithAnalytics(
    overrides?: Partial<Env>,
): { env: Env; analytics: MockAnalyticsEngine } {
    const analytics = new MockAnalyticsEngine();
    const env = createMockEnv({
        ANALYTICS_ENGINE: analytics as unknown as AnalyticsEngineDataset,
        ...overrides,
    });
    return { env, analytics };
}

// ============================================================================
// Request & Context helpers
// ============================================================================

/** Create a minimal Request for handler tests. */
export function createMockRequest(
    url = 'https://test.example.com/',
    init?: RequestInit,
): Request<unknown, IncomingRequestCfProperties<unknown>> {
    return new Request(url, init) as unknown as Request<unknown, IncomingRequestCfProperties<unknown>>;
}

/** Create a minimal ExecutionContext for handler tests. */
export function createMockCtx(): ExecutionContext {
    return {
        waitUntil: () => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

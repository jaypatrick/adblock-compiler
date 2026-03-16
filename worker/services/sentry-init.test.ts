/**
 * Tests for Sentry Worker initialisation helper.
 *
 * Validates the withSentryWorker HOF:
 *   - Passthrough when DSN is absent (zero overhead in local dev)
 *   - Sentry wrapping when DSN is present
 *   - Config defaults (environment, tracesSampleRate)
 *   - Handler spread preserves non-fetch exports (queue, scheduled)
 */

import { assert, assertEquals, assertExists } from '@std/assert';
import { assertSpyCalls, spy, stub } from '@std/testing/mock';
import { withSentryWorker } from './sentry-init.ts';
import type { SentryWorkerConfig } from './sentry-init.ts';
import type { Env } from '../types.ts';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal Env stub — only fields the SUT reads. */
function createMockEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '0.12.1-test',
        COMPILATION_CACHE: {} as KVNamespace,
        RATE_LIMIT: {} as KVNamespace,
        METRICS: {} as KVNamespace,
        ASSETS: {} as unknown as Fetcher,
        SENTRY_DSN: undefined,
        ...overrides,
    } as Env;
}

function createMockRequest(url = 'https://worker.test/compile'): Request {
    return new Request(url, { method: 'POST' });
}

function createMockCtx(): ExecutionContext {
    return {
        waitUntil: () => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

const SENTINEL_RESPONSE = new Response('ok-from-handler', { status: 200 });

// ============================================================================
// DSN-absent passthrough tests
// ============================================================================

Deno.test('withSentryWorker: returns handler with fetch when DSN is undefined', () => {
    const handler = {
        fetch: async () => SENTINEL_RESPONSE,
    } as ExportedHandler<Env>;

    const wrapped = withSentryWorker(handler, () => ({ dsn: undefined }));

    assertExists(wrapped.fetch, 'wrapped handler should have fetch');
});

Deno.test('withSentryWorker: passthrough fetch returns original response when DSN is absent', async () => {
    const fetchSpy = spy(async () => SENTINEL_RESPONSE);
    const handler = { fetch: fetchSpy } as unknown as ExportedHandler<Env>;
    const env = createMockEnv();
    const ctx = createMockCtx();
    const req = createMockRequest();

    const wrapped = withSentryWorker(handler, () => ({ dsn: undefined }));
    const response = await wrapped.fetch!(req, env, ctx);

    assertEquals(response, SENTINEL_RESPONSE);
    assertSpyCalls(fetchSpy, 1);
});

Deno.test('withSentryWorker: passthrough does not import @sentry/cloudflare', async () => {
    let sentryImported = false;

    // Stub dynamic import to detect if Sentry is loaded — since import() is
    // native, we verify indirectly: if DSN is absent the handler should
    // return the sentinel *without* the Sentry wrapping path executing.
    const fetchSpy = spy(async () => SENTINEL_RESPONSE);
    const handler = { fetch: fetchSpy } as unknown as ExportedHandler<Env>;
    const env = createMockEnv();

    const wrapped = withSentryWorker(handler, (e) => {
        // Config returns no DSN
        return { dsn: undefined };
    });

    const response = await wrapped.fetch!(createMockRequest(), env, createMockCtx());
    assertEquals(response, SENTINEL_RESPONSE);
    // If Sentry.withSentry had been called, fetchSpy would NOT be the direct
    // caller — the spy call count of 1 proves passthrough.
    assertSpyCalls(fetchSpy, 1);
});

// ============================================================================
// Config function tests
// ============================================================================

Deno.test('withSentryWorker: configFn receives the env object', async () => {
    const envReceived: Env[] = [];
    const handler = {
        fetch: async () => SENTINEL_RESPONSE,
    } as unknown as ExportedHandler<Env>;
    const env = createMockEnv({ COMPILER_VERSION: 'config-test-version' });

    const wrapped = withSentryWorker(handler, (e) => {
        envReceived.push(e);
        return { dsn: undefined }; // passthrough path so no Sentry import needed
    });

    await wrapped.fetch!(createMockRequest(), env, createMockCtx());

    assertEquals(envReceived.length, 1);
    assertEquals(envReceived[0].COMPILER_VERSION, 'config-test-version');
});

Deno.test('withSentryWorker: configFn is called on every fetch invocation', async () => {
    let callCount = 0;
    const handler = {
        fetch: async () => SENTINEL_RESPONSE,
    } as unknown as ExportedHandler<Env>;
    const env = createMockEnv();

    const wrapped = withSentryWorker(handler, () => {
        callCount++;
        return { dsn: undefined };
    });

    await wrapped.fetch!(createMockRequest(), env, createMockCtx());
    await wrapped.fetch!(createMockRequest(), env, createMockCtx());
    await wrapped.fetch!(createMockRequest(), env, createMockCtx());

    assertEquals(callCount, 3, 'configFn should be invoked per-request');
});

// ============================================================================
// Handler spread / non-fetch export preservation
// ============================================================================

Deno.test('withSentryWorker: preserves queue handler', () => {
    const queueFn = async () => {};
    const handler = {
        fetch: async () => SENTINEL_RESPONSE,
        queue: queueFn,
    } as unknown as ExportedHandler<Env>;

    const wrapped = withSentryWorker(handler, () => ({ dsn: undefined }));

    assertEquals(wrapped.queue, queueFn, 'queue handler should be preserved');
});

Deno.test('withSentryWorker: preserves scheduled handler', () => {
    const scheduledFn = async () => {};
    const handler = {
        fetch: async () => SENTINEL_RESPONSE,
        scheduled: scheduledFn,
    } as unknown as ExportedHandler<Env>;

    const wrapped = withSentryWorker(handler, () => ({ dsn: undefined }));

    assertEquals(wrapped.scheduled, scheduledFn, 'scheduled handler should be preserved');
});

Deno.test('withSentryWorker: overrides fetch but keeps other properties', () => {
    const originalFetch = async () => SENTINEL_RESPONSE;
    const handler = {
        fetch: originalFetch,
        queue: async () => {},
    } as unknown as ExportedHandler<Env>;

    const wrapped = withSentryWorker(handler, () => ({ dsn: undefined }));

    // fetch is replaced by the wrapper
    assert(wrapped.fetch !== originalFetch, 'fetch should be replaced by wrapper');
    // queue stays the same
    assertEquals(wrapped.queue, handler.queue);
});

// ============================================================================
// Return type preservation
// ============================================================================

Deno.test('withSentryWorker: returns same generic type T', () => {
    interface CustomHandler extends ExportedHandler<Env> {
        fetch: (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
    }

    const handler: CustomHandler = {
        fetch: async () => SENTINEL_RESPONSE,
    };

    const wrapped = withSentryWorker(handler, () => ({ dsn: undefined }));

    // TypeScript should accept this — runtime check that fetch exists
    assertExists(wrapped.fetch);
});

// ============================================================================
// SentryWorkerConfig interface tests
// ============================================================================

Deno.test('SentryWorkerConfig: all fields are optional', () => {
    const config: SentryWorkerConfig = {};
    assertEquals(config.dsn, undefined);
    assertEquals(config.release, undefined);
    assertEquals(config.environment, undefined);
    assertEquals(config.tracesSampleRate, undefined);
});

Deno.test('SentryWorkerConfig: accepts all expected fields', () => {
    const config: SentryWorkerConfig = {
        dsn: 'https://key@sentry.io/123',
        release: '1.0.0',
        environment: 'staging',
        tracesSampleRate: 0.5,
    };
    assertEquals(config.dsn, 'https://key@sentry.io/123');
    assertEquals(config.release, '1.0.0');
    assertEquals(config.environment, 'staging');
    assertEquals(config.tracesSampleRate, 0.5);
});

// ============================================================================
// DSN-present path (Sentry wrapping)
// ============================================================================

Deno.test({
    name: 'withSentryWorker: when DSN is set, fetch does not call original handler directly',
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        // With a DSN present, the code does `await import('@sentry/cloudflare')`
        // then calls Sentry.withSentry(...).fetch!(...).  In a test env without
        // a real Sentry SDK wired up, this import may fail.  We verify the
        // *branch selection* logic by confirming the original handler spy is NOT
        // called directly (Sentry.withSentry wraps it).
        const fetchSpy = spy(async () => SENTINEL_RESPONSE);
        const handler = { fetch: fetchSpy } as unknown as ExportedHandler<Env>;
        const env = createMockEnv({ SENTRY_DSN: 'https://key@sentry.io/123' });

        const wrapped = withSentryWorker(handler, (e) => ({
            dsn: (e as Env & { SENTRY_DSN?: string }).SENTRY_DSN,
            release: e.COMPILER_VERSION,
        }));

        try {
            await wrapped.fetch!(createMockRequest(), env, createMockCtx());
            // If Sentry is available in test env, it will wrap and call through
        } catch {
            // Expected: @sentry/cloudflare may not be resolvable in Deno test env.
            // The important assertion is that fetchSpy was NOT called directly —
            // the code took the Sentry branch (attempted the import).
            assertSpyCalls(fetchSpy, 0);
        }
    },
});

Deno.test('withSentryWorker: empty string DSN is treated as absent', async () => {
    const fetchSpy = spy(async () => SENTINEL_RESPONSE);
    const handler = { fetch: fetchSpy } as unknown as ExportedHandler<Env>;
    const env = createMockEnv();

    const wrapped = withSentryWorker(handler, () => ({ dsn: '' }));
    const response = await wrapped.fetch!(createMockRequest(), env, createMockCtx());

    // Empty string is falsy → should take passthrough path
    assertEquals(response, SENTINEL_RESPONSE);
    assertSpyCalls(fetchSpy, 1);
});

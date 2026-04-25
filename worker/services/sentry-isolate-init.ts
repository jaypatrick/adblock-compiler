/**
 * Sentry helpers for Durable Object and Workflow isolates.
 *
 * Durable Objects and Cloudflare Workflows each run in their own isolate,
 * separate from the main Worker fetch handler.  The `withSentryWorker` wrapper
 * in `sentry-init.ts` therefore does **not** cover them.  This module provides:
 *
 *  - A lazy, per-isolate Sentry SDK loader that imports `@sentry/cloudflare`
 *    only when `SENTRY_DSN` is set (zero overhead when Sentry is disabled).
 *  - `captureExceptionInIsolate(env, error)` — initialises the Sentry client
 *    **once per isolate** (using the same DSN/release/environment config as the
 *    main worker) and then calls `captureException()`.
 *
 * Usage in a Durable Object:
 *
 * ```ts
 * import { captureExceptionInIsolate } from './services/sentry-isolate-init.ts';
 *
 * catch (error) {
 *     await captureExceptionInIsolate(this.env as Env, error);
 * }
 * ```
 *
 * Usage in a Durable Object's `webSocketError` (fire-and-forget via waitUntil):
 *
 * ```ts
 * async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
 *     this.state.waitUntil(captureExceptionInIsolate(this.env as Env, error));
 *     // ... cleanup proceeds immediately, not blocked on Sentry module load
 * }
 * ```
 */

/// <reference types="@cloudflare/workers-types" />

import type { Env } from '../types.ts';

type SentryModule = typeof import('@sentry/cloudflare');

// ---------------------------------------------------------------------------
// Per-isolate state.  Each DO instance / Workflow run gets its own module
// scope in Cloudflare's V8 isolate model, so these are truly per-instance.
// ---------------------------------------------------------------------------

/** Cached import promise.  Cleared on import failure to allow retry. */
let sentryModulePromise: Promise<SentryModule> | null = null;

/**
 * Lazy-loads `@sentry/cloudflare`.
 *
 * - Returns `null` immediately when `SENTRY_DSN` is absent.
 * - Caches the in-flight import promise so concurrent calls don't race.
 * - Clears the cache on import failure so the next invocation retries.
 */
async function getSentryModule(env: Env): Promise<SentryModule | null> {
    if (!env.SENTRY_DSN) {
        return null;
    }
    if (!sentryModulePromise) {
        sentryModulePromise = import('@sentry/cloudflare').catch((error: unknown) => {
            // Clear so the next invocation retries instead of permanently returning null.
            sentryModulePromise = null;
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[Sentry] Failed to load @sentry/cloudflare; will retry on next invocation. ${msg}`);
            throw error;
        });
    }
    try {
        return await sentryModulePromise;
    } catch {
        return null;
    }
}

/**
 * Captures an exception in a Durable Object or Workflow isolate.
 *
 * Initialises the Sentry client **once per isolate** (DSN/release/environment
 * matching `withSentryWorker`) and calls `captureException(error)`.  No-op
 * when `SENTRY_DSN` is absent or the SDK fails to load.
 *
 * `@sentry/cloudflare` does not export `init()` from its main package index.
 * Instead, we construct a `CloudflareClient` directly from the exported class
 * and wire it up via `setCurrentClient` + `client.init()` — the same steps
 * the SDK's internal `init()` helper performs.
 *
 * @param env   The Worker `Env` binding object (must include `SENTRY_DSN` et al.)
 * @param error The exception to report.
 */
export async function captureExceptionInIsolate(env: Env, error: unknown): Promise<void> {
    const Sentry = await getSentryModule(env);
    if (!Sentry) {
        return;
    }

    if (!Sentry.isInitialized()) {
        // `@sentry/cloudflare` does not export `init()` from its main index.
        // Build the client from the exported `CloudflareClient` class and connect
        // it via `setCurrentClient` — replicating what the SDK's internal `init()`
        // function does in `@sentry/cloudflare/build/esm/sdk.js`.
        //
        // Mirrors the configuration used in withSentryWorker (sentry-init.ts):
        // - release: prefer an explicit SENTRY_RELEASE (git SHA injected at deploy)
        //   then fall back to COMPILER_VERSION so something meaningful always appears.
        // - tracesSampleRate: 0.1 (10 %) matches the main worker setting; DO/Workflow
        //   isolates process fewer requests so 10 % gives sufficient trace volume without
        //   excessive overhead.
        const client = new Sentry.CloudflareClient({
            dsn: env.SENTRY_DSN,
            release: env.SENTRY_RELEASE ?? env.COMPILER_VERSION,
            environment: env.ENVIRONMENT ?? 'production',
            tracesSampleRate: 0.1,
            integrations: Sentry.getDefaultIntegrations({ dsn: env.SENTRY_DSN }),
            // Minimal fetch-based transport: functionally equivalent to the SDK's
            // internal `makeCloudflareTransport`, built from the exported `createTransport`.
            transport: (options) =>
                Sentry.createTransport(options, async (request) => {
                    const response = await fetch(options.url, {
                        body: request.body as BodyInit,
                        method: 'POST',
                        headers: options.headers,
                    });
                    // Consume the body to prevent connection stalls in CF Workers.
                    await response.text().catch(() => {});
                    return {
                        statusCode: response.status,
                        headers: {
                            'x-sentry-rate-limits': response.headers.get('X-Sentry-Rate-Limits') ?? '',
                            'retry-after': response.headers.get('Retry-After') ?? '',
                        },
                    };
                }),
            // Minimal no-op stack parser — exceptions are still captured with their
            // message and type; raw stack strings are preserved as `extra` context.
            stackParser: (_stack) => [],
        });
        Sentry.setCurrentClient(client);
        client.init();
    }

    Sentry.captureException(error);
}

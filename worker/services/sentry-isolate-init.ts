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

/** True once `Sentry.init()` has been called for this isolate. */
let sentryInitialized = false;

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
            console.warn('[Sentry] Failed to load @sentry/cloudflare; will retry on next invocation.', error);
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
 * @param env   The Worker `Env` binding object (must include `SENTRY_DSN` et al.)
 * @param error The exception to report.
 */
export async function captureExceptionInIsolate(env: Env, error: unknown): Promise<void> {
    const Sentry = await getSentryModule(env);
    if (!Sentry) {
        return;
    }

    if (!sentryInitialized) {
        Sentry.init({
            dsn: env.SENTRY_DSN,
            release: env.SENTRY_RELEASE ?? env.COMPILER_VERSION,
            environment: env.ENVIRONMENT ?? 'production',
            tracesSampleRate: 0.1,
        });
        sentryInitialized = true;
    }

    Sentry.captureException(error);
}

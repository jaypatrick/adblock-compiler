/**
 * Sentry initialisation helpers for Cloudflare Workers.
 *
 * Uses the Deno-native Sentry SDK (`@sentry/deno`), registered in the
 * `deno.json` imports map as:
 *   "@sentry/deno": "npm:@sentry/deno@^9"
 *
 * Usage in worker/worker.ts:
 *
 *   import { withSentryWorker } from './services/sentry-init.ts';
 *
 *   export default withSentryWorker(existingHandler, (env) => ({
 *       dsn: env.SENTRY_DSN,
 *       release: env.COMPILER_VERSION,
 *       tracesSampleRate: 0.1,
 *   }));
 *
 * TODO: Add SENTRY_DSN as a Worker secret:
 *   wrangler secret put SENTRY_DSN
 */

/// <reference types="@cloudflare/workers-types" />

import * as Sentry from '@sentry/deno';
import type { Env } from '../types';

// Guard so Sentry.init() is called only once per worker isolate lifecycle.
let sentryInitialised = false;

export interface SentryWorkerConfig {
    /** Sentry DSN. Leave undefined to disable Sentry (e.g., local dev). */
    dsn?: string;
    /** Service release version. */
    release?: string;
    /** Sentry environment tag. Default: 'production' */
    environment?: string;
    /**
     * Fraction of transactions sampled for performance monitoring.
     * Default: 0.1 (10 %). Set to 1.0 in staging for full coverage.
     */
    tracesSampleRate?: number;
}

/**
 * Wraps a Cloudflare Worker export default handler with Sentry error tracking.
 *
 * When SENTRY_DSN is not set the original handler is returned unchanged —
 * zero overhead in local development.
 *
 * @param handler - The existing export default { fetch, queue, scheduled } object.
 * @param configFn - A function that receives `env` and returns SentryWorkerConfig.
 */
export function withSentryWorker<T extends ExportedHandler<Env>>(
    handler: T,
    configFn: (env: Env) => SentryWorkerConfig,
): T {
    return {
        ...handler,
        async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
            const config = configFn(env);

            if (!config.dsn) {
                // Sentry not configured — pass through directly
                return handler.fetch!(request, env, ctx);
            }

            // Cloudflare Workers run a single JS isolate (single-threaded event loop),
            // so checking and setting sentryInitialised here is race-free.
            if (!sentryInitialised) {
                Sentry.init({
                    dsn: config.dsn!,
                    release: config.release,
                    environment: config.environment ?? 'production',
                    tracesSampleRate: config.tracesSampleRate ?? 0.1,
                });
                sentryInitialised = true;
            }

            try {
                return await handler.fetch!(request, env, ctx);
            } catch (error) {
                try {
                    Sentry.captureException(error);
                } catch {
                    // deno-lint-ignore no-console
                    console.error(JSON.stringify({
                        level: 'error',
                        message: 'Unhandled worker exception (Sentry capture failed)',
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        url: request.url,
                        method: request.method,
                    }));
                }
                throw error;
            }
        },
    } as T;
}

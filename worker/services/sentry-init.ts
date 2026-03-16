/**
 * Sentry initialisation helpers for Cloudflare Workers.
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
 * Add SENTRY_DSN as a Worker secret:
 *   wrangler secret put SENTRY_DSN
 */

/// <reference types="@cloudflare/workers-types" />

import type { Env } from '../types.ts';

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
            // The Cloudflare workers-types Request generic parameter diverges between
            // CfProperties (used by the runtime) and IncomingRequestCfProperties (used
            // by the handler signature).  Cast to satisfy the stricter type expected by
            // handler.fetch and Sentry.withSentry without altering runtime behaviour.
            const cfRequest = request as unknown as Request<
                unknown,
                IncomingRequestCfProperties<unknown>
            >;

            if (!config.dsn) {
                // Sentry not configured — pass through directly
                return handler.fetch!(cfRequest, env, ctx);
            }

            const Sentry = await import('@sentry/cloudflare');
            return Sentry.withSentry(
                () => ({
                    dsn: config.dsn!,
                    release: config.release,
                    environment: config.environment ?? 'production',
                    tracesSampleRate: config.tracesSampleRate ?? 0.1,
                }),
                handler as unknown as ExportedHandler<unknown, unknown, unknown>,
            ).fetch!(cfRequest, env, ctx);
        },
    } as T;
}

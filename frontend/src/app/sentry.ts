/**
 * sentry.ts — Sentry Browser SDK initialisation for the Angular admin frontend.
 *
 * Sentry is initialised lazily from /api/sentry-config so the DSN is never
 * baked into the build artifact. The initialisation is browser-only and
 * non-fatal: if the config endpoint is unreachable or SENTRY_DSN is unset,
 * the app boots normally with Sentry disabled.
 *
 * The `release` value must match the `--release` flag used in the
 * `sentry-sourcemaps.yml` CI workflow (i.e. the git commit SHA) so that Sentry
 * can de-minify stack traces using the uploaded source maps.
 *
 * Integrations enabled:
 *   - browserTracingIntegration()  — page-load and navigation spans
 *   - replayIntegration()          — session replay; full capture on errors
 *
 * Required Worker secret:  SENTRY_DSN      (wrangler secret put SENTRY_DSN)
 * Optional Worker var:     SENTRY_RELEASE  (git SHA — set at deploy time)
 * Required Worker route:   GET /api/sentry-config  → { dsn: string | null, release: string | null }
 */

import * as Sentry from '@sentry/angular';

export async function initSentry(dsn: string | null | undefined, release?: string | null): Promise<void> {
    if (!dsn) return;
    Sentry.init({
        dsn,
        ...(release ? { release } : {}),
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        // Capture 10 % of transactions for performance monitoring.
        // Increase to 1.0 in staging / lower in high-traffic prod.
        tracesSampleRate: 0.1,
        // Always replay the session on errors; sample 5 % otherwise.
        replaysOnErrorSampleRate: 1.0,
        replaysSessionSampleRate: 0.05,
        environment: 'production',
    });
}

/**
 * Angular ErrorHandler integration — forward unhandled Angular errors to Sentry.
 * Re-export for use in app.config.ts providers.
 */
export { Sentry };

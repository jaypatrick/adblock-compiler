/**
 * handleSentryConfig — returns the Sentry DSN and release for frontend RUM initialisation.
 *
 * The DSN is a public Sentry value (it appears in every browser network request
 * to Sentry anyway). Returning it at runtime avoids baking it into the build.
 *
 * `release` is the git SHA injected at deploy time via `SENTRY_RELEASE`. It must
 * match the `--release` flag used in the `sentry-sourcemaps.yml` CI workflow so
 * that Sentry can resolve minified stack traces back to source.
 *
 * Auth: none required — DSN and release tag exposure are intentional and safe.
 * Route: GET /api/sentry-config
 */
import type { Env } from '../types.ts';

export function handleSentryConfig(env: Env): Response {
    return new Response(
        JSON.stringify({
            dsn: env.SENTRY_DSN ?? null,
            release: env.SENTRY_RELEASE ?? null,
        }),
        {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300', // 5-minute CDN cache
            },
        },
    );
}

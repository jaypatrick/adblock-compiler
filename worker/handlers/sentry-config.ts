/**
 * handleSentryConfig — returns the Sentry DSN for frontend RUM initialisation.
 *
 * The DSN is a public Sentry value (it appears in every browser network request
 * to Sentry anyway). Returning it at runtime avoids baking it into the build.
 *
 * Auth: none required — DSN exposure is intentional and safe.
 * Route: GET /api/sentry-config
 */
import type { Env } from '../types.ts';

export function handleSentryConfig(env: Env): Response {
    return new Response(
        JSON.stringify({ dsn: env.SENTRY_DSN ?? null }),
        {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300', // 5-minute CDN cache
            },
        },
    );
}

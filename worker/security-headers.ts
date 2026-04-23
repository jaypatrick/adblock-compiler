/// <reference types="@cloudflare/workers-types" />

/**
 * Content Security Policy and client-side security header middleware.
 *
 * Complements Hono's built-in secureHeaders() with a full Content-Security-Policy
 * including a report-uri directive for Page Shield / browser CSP violation collection.
 *
 * @see worker/routes/csp-report.routes.ts — violation ingestion endpoint (POST /api/csp-report)
 * @see https://developers.cloudflare.com/page-shield/
 */

import type { MiddlewareHandler } from 'hono';

import type { Env } from './types.ts';
import type { Variables } from './routes/shared.ts';

// ============================================================================
// CSP Directives
// ============================================================================

/**
 * Builds the Content-Security-Policy header value.
 *
 * Directives are tuned for the Bloqr SPA + API worker:
 * - `script-src` allows Cloudflare Turnstile and Web Analytics, plus the
 *   swagger-ui-dist bundle hosted on cdn.jsdelivr.net for /api/swagger
 * - `frame-src` allows Cloudflare Turnstile challenge iframes
 * - `connect-src` allows Cloudflare Analytics beacon and Sentry error ingest
 * - `report-uri /api/csp-report` enables browser-native CSP violation reporting
 *   which feeds the Page Shield detection loop and the csp_violations D1 table
 */
function buildCspDirectives(): string {
    return [
        "default-src 'self'",
        // Cloudflare Turnstile (api.js) + Web Analytics + Swagger UI (cdn.jsdelivr.net)
        "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net 'unsafe-inline'",
        // Cloudflare Analytics beacon + Sentry error ingest
        "connect-src 'self' https://cloudflareinsights.com https://*.ingest.sentry.io",
        // Swagger UI styles from cdn.jsdelivr.net
        "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // Cloudflare Turnstile renders in a sandboxed iframe from challenges.cloudflare.com
        "frame-src https://challenges.cloudflare.com",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
        'report-uri /api/csp-report',
    ].join('; ');
}

// Pre-build once per isolate lifetime — the value is static.
const CONTENT_SECURITY_POLICY = buildCspDirectives();

// ============================================================================
// Middleware
// ============================================================================

/**
 * Hono middleware that applies a Content-Security-Policy header (with
 * `report-uri /api/csp-report`) plus `X-Content-Type-Options` and
 * `X-Frame-Options` to every outgoing response.
 *
 * Mount this **after** `secureHeaders()` in the global middleware chain so
 * the CSP overrides any partial CSP that Hono might set by default.
 *
 * @example
 * ```ts
 * import { contentSecurityPolicyMiddleware } from './security-headers.ts';
 * app.use('*', contentSecurityPolicyMiddleware());
 * ```
 */
export function contentSecurityPolicyMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
    return async (c, next) => {
        await next();
        c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('X-Frame-Options', 'DENY');
    };
}

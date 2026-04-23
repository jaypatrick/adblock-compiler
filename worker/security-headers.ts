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
 * - `script-src` allows Cloudflare Web Analytics (static.cloudflareinsights.com)
 * - `connect-src` allows Cloudflare Analytics beacon (cloudflareinsights.com)
 * - `report-uri /api/csp-report` enables browser-native CSP violation reporting
 *   which feeds the Page Shield detection loop and the csp_violations D1 table
 */
function buildCspDirectives(): string {
    return [
        "default-src 'self'",
        "script-src 'self' https://static.cloudflareinsights.com",
        "connect-src 'self' https://cloudflareinsights.com",
        "style-src 'self'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
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

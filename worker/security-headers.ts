/// <reference types="@cloudflare/workers-types" />

/**
 * Content Security Policy and client-side security header middleware.
 *
 * Complements Hono's built-in secureHeaders() with a full Content-Security-Policy
 * including a report-uri directive for Page Shield / browser CSP violation collection.
 *
 * Two CSP variants are served:
 * - **Strict** (default): applied to all SPA and API responses; no `'unsafe-inline'`.
 * - **Relaxed** (`/api/swagger*`, `/api/docs*`, `/api/redoc*`): permits the inline
 *   scripts and styles injected by swagger-ui-bundle.js, Scalar, ReDoc, and CDN
 *   stylesheets from cdn.jsdelivr.net.
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
 * Strict CSP for SPA / API responses.
 * No `'unsafe-inline'` — inline scripts and styles are blocked.
 */
function buildStrictCspDirectives(): string {
    return [
        "default-src 'self'",
        // Cloudflare Turnstile (api.js) + Web Analytics; no CDN or inline scripts here.
        "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
        // Cloudflare Analytics beacon + Sentry error ingest
        "connect-src 'self' https://cloudflareinsights.com https://*.ingest.sentry.io",
        "style-src 'self'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // Cloudflare Turnstile renders in a sandboxed iframe from challenges.cloudflare.com
        'frame-src https://challenges.cloudflare.com',
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
        'report-uri /api/csp-report',
    ].join('; ');
}

/**
 * Relaxed CSP for API documentation pages (`/api/swagger*`, `/api/docs*`, `/api/redoc*`).
 * `'unsafe-inline'` is required because swagger-ui-bundle.js, Scalar, and ReDoc all
 * inject inline scripts and styles at runtime; cdn.jsdelivr.net hosts their stylesheets.
 * This policy is intentionally scoped to documentation paths only.
 */
function buildSwaggerCspDirectives(): string {
    return [
        "default-src 'self'",
        // Turnstile + Web Analytics + Swagger UI; 'unsafe-inline' required by swagger-ui-bundle.js
        "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net 'unsafe-inline'",
        // Cloudflare Analytics beacon + Sentry error ingest
        "connect-src 'self' https://cloudflareinsights.com https://*.ingest.sentry.io",
        // Swagger UI injects inline <style> blocks; cdn.jsdelivr.net supplies the stylesheet.
        "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // Cloudflare Turnstile renders in a sandboxed iframe from challenges.cloudflare.com
        'frame-src https://challenges.cloudflare.com',
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
        'report-uri /api/csp-report',
    ].join('; ');
}

// Pre-build once per isolate lifetime — values are static.
const CSP_STRICT = buildStrictCspDirectives();
const CSP_SWAGGER = buildSwaggerCspDirectives();

/**
 * Path prefixes that serve API documentation (Swagger UI, Scalar, ReDoc).
 * These routes receive the relaxed CSP variant because their bundled renderers
 * inject inline scripts/styles at runtime.  Add new prefixes here whenever a
 * new documentation renderer is mounted.
 */
const DOC_PATH_PREFIXES: readonly string[] = ['/api/swagger', '/api/docs', '/api/redoc'];

// ============================================================================
// Middleware
// ============================================================================

/**
 * Hono middleware that applies a Content-Security-Policy header (with
 * `report-uri /api/csp-report`) plus `X-Content-Type-Options` and
 * `X-Frame-Options` to every outgoing response.
 *
 * Serves a **strict** CSP for all paths except the API documentation paths
 * (`/api/swagger*`, `/api/docs*`, `/api/redoc*`), which receive a relaxed policy
 * that permits the `'unsafe-inline'` scripts/styles required by swagger-ui-bundle.js,
 * Scalar, and ReDoc.
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
        // Apply relaxed CSP for API documentation paths; all other routes get the strict policy.
        const path = c.req.path;
        const isDocPath = DOC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
        const csp = isDocPath ? CSP_SWAGGER : CSP_STRICT;
        c.header('Content-Security-Policy', csp);
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('X-Frame-Options', 'DENY');
    };
}

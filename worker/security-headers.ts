/// <reference types="@cloudflare/workers-types" />

/**
 * Content Security Policy and client-side security header middleware.
 *
 * Complements Hono's built-in secureHeaders() with a full Content-Security-Policy
 * including a report-uri directive for Page Shield / browser CSP violation collection.
 *
 * Two CSP variants are served:
 * - **Strict** (default): applied to all SPA and API responses; no `'unsafe-inline'`.
 * - **Swagger** (`/api/swagger*`): relaxed to permit the inline scripts and styles
 *   injected by swagger-ui-bundle.js and cdn.jsdelivr.net stylesheets.
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
 * Relaxed CSP for Swagger UI pages only (`/api/swagger*`).
 * `'unsafe-inline'` is required because swagger-ui-bundle.js injects inline scripts
 * and styles at runtime, and cdn.jsdelivr.net hosts the swagger-ui stylesheet.
 * This policy is intentionally scoped to the `/api/swagger*` path.
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

// ============================================================================
// Middleware
// ============================================================================

/**
 * Hono middleware that applies a Content-Security-Policy header (with
 * `report-uri /api/csp-report`) plus `X-Content-Type-Options` and
 * `X-Frame-Options` to every outgoing response.
 *
 * Serves a **strict** CSP for all paths except `/api/swagger*`, which receives
 * a relaxed policy that permits the `'unsafe-inline'` scripts/styles required
 * by swagger-ui-bundle.js.
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
        // Apply relaxed CSP only for Swagger UI paths; all other routes get the strict policy.
        const csp = c.req.path.startsWith('/api/swagger') ? CSP_SWAGGER : CSP_STRICT;
        c.header('Content-Security-Policy', csp);
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('X-Frame-Options', 'DENY');
    };
}

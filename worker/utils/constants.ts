/**
 * Shared worker constants
 */

/**
 * Target Angular route for the API documentation page.
 * Used for browser redirects from GET /api when assets are available.
 */
export const API_DOCS_REDIRECT = '/api-docs';

/**
 * Server-handled path prefixes that must NOT be intercepted by the SPA fallback.
 * Browser navigations to paths under these prefixes should return a real 404/error
 * rather than the Angular shell with a 200.
 * Note: use the most-specific prefix needed — e.g. '/admin/storage' (not '/admin') so
 * that the Angular /admin route is still served by the SPA fallback.
 */
export const SPA_SERVER_PREFIXES: readonly string[] = [
    '/api',
    '/docs',
    '/metrics',
    '/queue',
    '/admin/storage',
    '/workflow',
    '/health',
    '/ws',
    '/compile',
    '/ast',
    '/poc',
];

/** URL of the mdBook documentation site hosted on Cloudflare Pages. */
export const DOCS_SITE_URL = 'https://adblock-compiler-docs.pages.dev/';

/** Base URL used when constructing asset fetch requests to the ASSETS binding. */
export const ASSETS_BASE_URL = 'http://assets';

/** Matches paths that have a file extension (e.g. `.js`, `.css`, `.png`). */
export const FILE_EXTENSION_RE = /\.[^/]+$/;

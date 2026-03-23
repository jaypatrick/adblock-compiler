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
export const DOCS_SITE_URL_FALLBACK = 'https://adblock-compiler-docs.pages.dev/';

/**
 * @deprecated Use {@link getProjectUrls}`(env).docs` at runtime; this re-export exists only for
 * backward compatibility (e.g. legacy tests that import `DOCS_SITE_URL` by name).
 */
export const DOCS_SITE_URL = DOCS_SITE_URL_FALLBACK;

/**
 * Fallback URL for the frontend worker, used when env.URL_FRONTEND is absent.
 */
export const FRONTEND_URL_FALLBACK = 'https://adblock-frontend.jayson-knight.workers.dev';

/**
 * Fallback URL for the backend / API worker, used when env.URL_API is absent.
 */
export const API_URL_FALLBACK = 'https://adblock-compiler.jayson-knight.workers.dev';

/**
 * Returns the project URLs from the worker env, falling back to the hardcoded
 * defaults when running outside the Workers runtime (tests, CLI).
 */
export function getProjectUrls(env: { URL_FRONTEND?: string; URL_API?: string; URL_DOCS?: string }) {
    const rawDocs = env.URL_DOCS ?? DOCS_SITE_URL_FALLBACK;
    return {
        frontend: env.URL_FRONTEND ?? FRONTEND_URL_FALLBACK,
        api: env.URL_API ?? API_URL_FALLBACK,
        docs: rawDocs.endsWith('/') ? rawDocs : rawDocs + '/', // ensure trailing slash
    } as const;
}

/** Base URL used when constructing asset fetch requests to the ASSETS binding. */
export const ASSETS_BASE_URL = 'http://assets';

/** Matches paths that have a file extension (e.g. `.js`, `.css`, `.png`). */
export const FILE_EXTENSION_RE = /\.[^/]+$/;

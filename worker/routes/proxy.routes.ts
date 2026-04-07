/// <reference types="@cloudflare/workers-types" />

/**
 * CORS Proxy routes — unblocks local and hybrid compilation modes.
 *
 * Routes:
 *   GET  /proxy/fetch               — single URL, anonymous + Turnstile
 *   POST /proxy/fetch/batch         — batch URLs, Pro tier only (hybrid mode)
 *
 * ## Security
 * - SSRF protection: only HTTPS URLs to public internet addresses are allowed.
 *   Internally reuses `HttpFetcher.isSafeUrl()` from `src/platform/HttpFetcher.ts`.
 * - Rate limiting: `rateLimitMiddleware()` applied to both routes.
 * - Turnstile: `turnstileMiddleware()` applied to the anonymous single-fetch route.
 * - The batch route requires Pro tier (enforced by `ROUTE_PERMISSION_REGISTRY`).
 *
 * ## Caching
 * Fetched content is cached in `COMPILATION_CACHE` KV with a 5-minute TTL to
 * deduplicate repeated browser requests for the same source URL.
 *
 * ## ZTA checklist
 * - [x] Auth/Turnstile verified before any external network call
 * - [x] All external inputs (query param, body) validated with Zod
 * - [x] SSRF protection on every outbound fetch
 * - [x] Rate limiting on both routes
 * - [x] Security events emitted on auth/Turnstile failures
 * - [x] CORS origin allowlist enforced (no `*` for authenticated routes)
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import { UserTier } from '../types.ts';
import type { Variables } from './shared.ts';
import { verifyTurnstileInline } from './shared.ts';

import { rateLimitMiddleware } from '../middleware/hono-middleware.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { HttpFetcher } from '../../src/platform/HttpFetcher.ts';

export const proxyRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Constants ─────────────────────────────────────────────────────────────────

/** KV cache TTL for fetched content — 5 minutes. */
const PROXY_CACHE_TTL_SECONDS = 300;

/** Maximum number of URLs allowed in a single batch request. */
const BATCH_MAX_URLS = 20;

/** Maximum response size accepted from a proxied URL (5 MB). */
const MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024;

/** User-Agent header sent to upstream servers. */
const PROXY_USER_AGENT = 'AdblockCompiler-Proxy/2.0 (+https://github.com/jaypatrick/adblock-compiler)';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a KV cache key from a URL. */
function proxyCacheKey(url: string): string {
    return `proxy:${url}`;
}

/**
 * Validate that the target URL is safe to proxy.
 *
 * Returns an error string on failure, or `null` when the URL is allowed.
 */
function validateProxyUrl(url: string): string | null {
    if (!url) return 'Missing url parameter';

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return 'Invalid URL';
    }

    if (parsed.protocol !== 'https:') {
        return 'Only HTTPS URLs are allowed';
    }

    if (!HttpFetcher.isSafeUrl(url)) {
        return 'URL targets a private or restricted address';
    }

    return null;
}

/**
 * Fetch the content of a remote URL, with KV caching.
 *
 * @throws {Error} When the upstream request fails or the response is too large.
 */
async function fetchAndCache(url: string, env: Env): Promise<string> {
    const cacheKey = proxyCacheKey(url);

    // KV cache hit
    if (env.COMPILATION_CACHE) {
        const cached = await env.COMPILATION_CACHE.get(cacheKey);
        if (cached !== null) return cached;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let content: string;
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': PROXY_USER_AGENT },
            redirect: 'follow',
        });

        if (!response.ok) {
            throw new Error(`Upstream HTTP ${response.status}: ${response.statusText}`);
        }

        // Guard against suspiciously large responses before buffering
        const contentLength = Number(response.headers.get('Content-Length') ?? '0');
        if (contentLength > MAX_PROXY_RESPONSE_BYTES) {
            throw new Error(`Response too large (Content-Length: ${contentLength} bytes)`);
        }

        content = await response.text();

        if (content.length > MAX_PROXY_RESPONSE_BYTES) {
            throw new Error(`Response too large (${content.length} bytes)`);
        }
    } finally {
        clearTimeout(timeoutId);
    }

    // Populate KV cache (non-blocking)
    if (env.COMPILATION_CACHE) {
        env.COMPILATION_CACHE.put(cacheKey, content, { expirationTtl: PROXY_CACHE_TTL_SECONDS }).catch(() => undefined);
    }

    return content;
}

// ── GET /proxy/fetch ──────────────────────────────────────────────────────────

const proxyFetchRoute = createRoute({
    method: 'get',
    path: '/proxy/fetch',
    tags: ['Proxy'],
    summary: 'Proxy fetch a single URL',
    description: [
        'Fetches the content of a remote HTTPS URL on behalf of the client.',
        '',
        'This endpoint exists to allow browser-based (local mode) and hybrid mode',
        'compilation to download source filter lists that would otherwise be blocked',
        'by browser CORS policies.',
        '',
        '**SSRF protection** — private/loopback/link-local IP ranges and cloud metadata',
        'endpoints (`169.254.169.254`, `metadata.google.internal`) are blocked.',
        '',
        '**Caching** — responses are cached in KV for 5 minutes to reduce upstream load.',
        '',
        '**Auth** — anonymous callers must pass a valid Cloudflare Turnstile token via the',
        '`X-Turnstile-Token` request header. Authenticated (Free+) callers are exempt.',
    ].join('\n'),
    request: {
        query: z.object({
            url: z.string().url().describe('Fully-qualified HTTPS URL to fetch (URL-encoded)'),
            turnstileToken: z.string().optional().describe('Turnstile token for anonymous callers'),
        }),
    },
    responses: {
        200: {
            description: 'Raw text content of the proxied URL',
            content: {
                'text/plain': {
                    schema: z.string(),
                },
            },
        },
        400: {
            description: 'Invalid or unsafe URL',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        403: {
            description: 'Turnstile verification failed',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        429: {
            description: 'Rate limit exceeded',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        502: {
            description: 'Upstream fetch failed',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

proxyRoutes.use('/proxy/fetch', rateLimitMiddleware());
proxyRoutes.openapi(proxyFetchRoute, async (c) => {
    const { url, turnstileToken } = c.req.valid('query');
    const analytics = c.get('analytics');
    const authContext = c.get('authContext');
    const ip = c.get('ip');

    // ── Turnstile check for anonymous callers ──────────────────────────────
    // Authenticated (Free+) users are exempt; anonymous callers must present
    // a valid Turnstile token via query param or X-Turnstile-Token header.
    const isAnonymous = authContext.tier === UserTier.Anonymous;
    if (isAnonymous) {
        const token = turnstileToken ?? c.req.header('X-Turnstile-Token') ?? '';
        const tsErr = await verifyTurnstileInline(c, token);
        // deno-lint-ignore no-explicit-any
        if (tsErr) return tsErr as any;
    }

    // ── SSRF + scheme validation ───────────────────────────────────────────
    const urlError = validateProxyUrl(url);
    if (urlError) {
        analytics.trackSecurityEvent({
            eventType: 'auth_failure',
            path: c.req.path,
            method: 'GET',
            clientIpHash: AnalyticsService.hashIp(ip),
            tier: authContext.tier,
            reason: `proxy_ssrf_blocked:${urlError}`,
        });
        // deno-lint-ignore no-explicit-any
        return c.json({ success: false, error: urlError }, 400) as any;
    }

    // ── Fetch (with KV cache) ──────────────────────────────────────────────
    try {
        const content = await fetchAndCache(url, c.env);
        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': `public, max-age=${PROXY_CACHE_TTL_SECONDS}`,
                'X-Proxy-Source': 'adblock-compiler-proxy',
            },
            // deno-lint-ignore no-explicit-any
        }) as any;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // deno-lint-ignore no-explicit-any
        return c.json({ success: false, error: `Upstream fetch failed: ${message}` }, 502) as any;
    }
});

// ── POST /proxy/fetch/batch ───────────────────────────────────────────────────

const proxyFetchBatchRoute = createRoute({
    method: 'post',
    path: '/proxy/fetch/batch',
    tags: ['Proxy'],
    summary: 'Batch proxy fetch multiple URLs',
    description: [
        'Fetches the content of multiple remote HTTPS URLs in parallel.',
        '',
        'Used by **hybrid mode**: the Worker fetches source filter lists and returns',
        'the raw content to the browser, which then runs the transformation pipeline',
        'locally via `WorkerCompiler`.',
        '',
        'Requires **Pro tier** — enforced by the route permission registry.',
        '',
        `Maximum **${BATCH_MAX_URLS} URLs** per request.`,
    ].join('\n'),
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        urls: z.array(z.string().url()).min(1).max(BATCH_MAX_URLS).describe('HTTPS URLs to fetch'),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Map of URL → fetched content (or error message)',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        results: z.record(
                            z.string(),
                            z.object({
                                content: z.string().optional(),
                                error: z.string().optional(),
                            }),
                        ),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid request body',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

proxyRoutes.use('/proxy/fetch/batch', rateLimitMiddleware());
proxyRoutes.openapi(proxyFetchBatchRoute, async (c) => {
    const { urls } = c.req.valid('json');
    const analytics = c.get('analytics');
    const authContext = c.get('authContext');
    const ip = c.get('ip');

    // Validate all URLs before initiating any fetches
    for (const url of urls) {
        const urlError = validateProxyUrl(url);
        if (urlError) {
            analytics.trackSecurityEvent({
                eventType: 'auth_failure',
                path: c.req.path,
                method: 'POST',
                clientIpHash: AnalyticsService.hashIp(ip),
                tier: authContext.tier,
                reason: `proxy_ssrf_blocked:${urlError}`,
            });
            // deno-lint-ignore no-explicit-any
            return c.json({ success: false, error: `Invalid URL "${url}": ${urlError}` }, 400) as any;
        }
    }

    // Fetch all URLs in parallel; individual errors are captured per-URL
    const settled = await Promise.allSettled(
        urls.map((url) => fetchAndCache(url, c.env)),
    );

    const results: Record<string, { content?: string; error?: string }> = {};
    for (let i = 0; i < urls.length; i++) {
        const outcome = settled[i];
        if (outcome.status === 'fulfilled') {
            results[urls[i]] = { content: outcome.value };
        } else {
            const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
            results[urls[i]] = { error: `Fetch failed: ${message}` };
        }
    }

    // deno-lint-ignore no-explicit-any
    return c.json({ success: true, results }) as any;
});

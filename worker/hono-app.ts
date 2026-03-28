/**
 * Hono application — Phase 3 migration (progressive enhancement).
 *
 * All routing logic from `worker/handlers/router.ts` has been migrated to
 * Hono route declarations.  Handler function signatures are UNCHANGED.
 *
 * Phase 2 extracts repeated inline middleware into reusable factories
 * (`bodySizeMiddleware`, `rateLimitMiddleware`, `turnstileMiddleware`,
 * `requireAuthMiddleware`) defined in `worker/middleware/hono-middleware.ts`.
 *
 * Phase 3 progressive enhancements:
 *  - Migrates `app` and `routes` to `OpenAPIHono` (from `@hono/zod-openapi`)
 *  - Shared helpers: `zodValidationError`, `verifyTurnstileInline`, `buildSyntheticRequest`
 *  - `timing()` middleware adds `Server-Timing` headers to every response
 *  - `prettyJSON()` globally (activate with `?pretty=true`)
 *  - `compress()` on the `routes` sub-app for automatic response compression (gzip/deflate)
 *  - `logger()` on the `routes` sub-app for standardized request/response logging
 *  - `GET /api/openapi.json` serves the auto-generated OpenAPI 3.0 spec
 *  - `AppType` export enables `hc<AppType>()` typed RPC client in Angular
 *
 * @see docs/architecture/hono-routing.md — architecture overview
 * @see docs/architecture/hono-rpc-client.md — typed RPC client pattern
 * @see worker/handlers/router.ts — thin re-export shim (backward compat)
 * @see worker/middleware/hono-middleware.ts — Phase 2 middleware factories
 * @see worker/routes/ — domain-scoped route modules
 */

/// <reference types="@cloudflare/workers-types" />

import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Context } from 'hono';
import { endTime, startTime, timing } from 'hono/timing';
import { prettyJSON } from 'hono/pretty-json';
import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { OpenAPIHono } from '@hono/zod-openapi';

// Types
import type { Env } from './types.ts';
import { ANONYMOUS_AUTH_CONTEXT } from './types.ts';

// Services
import { AnalyticsService } from '../src/services/AnalyticsService.ts';
import { WORKER_DEFAULTS } from '../src/config/defaults.ts';

// Middleware
import { checkRateLimitTiered } from './middleware/index.ts';
import { authenticateRequestUnified } from './middleware/auth.ts';
import { BetterAuthProvider } from './middleware/better-auth-provider.ts';

// Auth
import { createAuth } from './lib/auth.ts';

// Utils
import { generateRequestId } from './utils/index.ts';
import { createAnalyticsService } from './utils/analytics.ts';
import { createPgPool } from './utils/pg-pool.ts';
import { getProjectUrls } from './utils/constants.ts';
import { checkRoutePermission } from './utils/route-permissions.ts';
import { checkUserApiAccess } from './utils/user-access.ts';
import { trackApiUsage } from './utils/api-usage.ts';
import { isPublicEndpoint, matchOrigin } from './utils/cors.ts';

// Handlers (pre-auth meta routes — eagerly imported)
import { handleAuthProviders } from './handlers/auth-providers.ts';

// Agent routing (authenticated)
import { agentRouter } from './agents/index.ts';

// Route modules
import { adminRoutes } from './routes/admin.routes.ts';
import { apiKeysRoutes } from './routes/api-keys.routes.ts';
import { browserRoutes } from './routes/browser.routes.ts';
import { compileRoutes } from './routes/compile.routes.ts';
import { configurationRoutes } from './routes/configuration.routes.ts';
import { monitoringRoutes } from './routes/monitoring.routes.ts';
import { queueRoutes } from './routes/queue.routes.ts';
import { rulesRoutes } from './routes/rules.routes.ts';
import { webhookRoutes } from './routes/webhook.routes.ts';
import { workflowRoutes } from './routes/workflow.routes.ts';

// Shared types — re-exported for backward compatibility
export type { Variables } from './routes/shared.ts';
import type { Variables } from './routes/shared.ts';

// ============================================================================
// Constants
// ============================================================================

const RATE_LIMIT_WINDOW = WORKER_DEFAULTS.RATE_LIMIT_WINDOW_SECONDS;

// Dashboard monitoring endpoints — read-only, no PII, publicly accessible by design.
const MONITORING_API_PATHS = [
    '/api/health',
    '/api/health/latest',
    '/api/health/db-smoke',
    '/api/metrics',
] as const;

// Pre-auth API meta paths (bypass unified auth, use anonymous context)
const PRE_AUTH_PATHS = [
    '/api',
    '/api/version',
    '/api/schemas',
    '/api/turnstile-config',
    '/api/sentry-config',
    '/api/openapi.json',
    '/api/auth/providers',
    ...MONITORING_API_PATHS,
] as const;

// Bare-path variants of MONITORING_API_PATHS — retained for request matching
// in the unified auth middleware. The bare-path double-mount (`app.route('/', routes)`)
// was removed in Phase 4; this constant is kept so that any cached proxy/CDN
// requests arriving without the /api prefix continue to bypass auth correctly.
const MONITORING_BARE_PATHS = new Set(MONITORING_API_PATHS.map((p) => p.slice(4)));

// ============================================================================
// Helper functions
// ============================================================================

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Normalise the route path for permission/ZTA checks inside the `routes` sub-app.
 */
function routesPath(c: AppContext): string {
    const p = c.req.path;
    return p.startsWith('/api/') ? p.slice(4) : p;
}

/**
 * Applies CORS headers to an error response using the same allowlist-based
 * policy as the CORS middleware.
 */
function applyErrorCorsHeaders(c: AppContext): void {
    const origin = c.req.header('Origin');
    if (!origin) return;
    const allowed = matchOrigin(origin, c.env as Env);
    if (!allowed) return;
    c.header('Access-Control-Allow-Origin', allowed);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

// ============================================================================
// App setup
// ============================================================================

export const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Global error handler ─────────────────────────────────────────────────────
app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    let errorDetails: string;
    if (err instanceof Error) {
        errorDetails = err.stack || err.message || String(err);
    } else if (typeof err === 'string') {
        errorDetails = err;
    } else {
        try {
            errorDetails = JSON.stringify(err);
        } catch {
            errorDetails = String(err);
        }
    }
    // deno-lint-ignore no-console
    console.error(`[${requestId}] Unhandled error on ${c.req.method} ${c.req.path}:`, errorDetails);
    applyErrorCorsHeaders(c);
    return c.json(
        { success: false, error: 'Internal server error', requestId },
        500,
    );
});

// ── 0. Server-Timing middleware ───────────────────────────────────────────────
app.use('*', timing());

// ── 1. Request metadata middleware ────────────────────────────────────────────
app.use('*', async (c, next) => {
    c.set('requestId', generateRequestId('api'));
    c.set('ip', c.req.raw.headers.get('CF-Connecting-IP') || 'unknown');
    c.set('analytics', createAnalyticsService(c.env));
    await next();
});

// ── 1a. SSR origin detection ──────────────────────────────────────────────────
app.use('*', async (c, next) => {
    c.set('isSSR', c.req.header('CF-Worker-Source') === 'ssr');
    await next();
});

// ── 1b. Better Auth route handler ─────────────────────────────────────────────
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    if (!c.env.BETTER_AUTH_SECRET) return c.notFound();
    if (!c.env.HYPERDRIVE) {
        return c.json({ error: 'Authentication service is temporarily unavailable' }, 503);
    }
    const url = new URL(c.req.url);
    const auth = createAuth(c.env, url.origin);

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const betterAuthRequest = new Request(c.req.raw, { signal: abortController.signal });

    try {
        const response = await Promise.race([
            auth.handler(betterAuthRequest),
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    abortController.abort();
                    reject(new DOMException('DB call exceeded 10s', 'TimeoutError'));
                }, 10_000);
            }),
        ]).finally(() => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        });
        return response;
    } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            // deno-lint-ignore no-console
            console.error('[better-auth] Handler timeout: DB call exceeded 10s on', url.pathname);
            c.get('analytics')?.trackSecurityEvent({
                eventType: 'auth_failure',
                authMethod: 'better-auth',
                reason: 'better_auth_timeout',
                path: url.pathname,
                method: c.req.method,
                clientIpHash: AnalyticsService.hashIp(c.get('ip') ?? 'unknown'),
            });
            return c.json({ error: 'Authentication timed out' }, 504);
        }
        throw error;
    }
});

// ── 2. Agent router (authenticated) ──────────────────────────────────────────
app.use(
    '/agents/*',
    cors({
        origin: (origin, c) => {
            if (isPublicEndpoint(new URL(c.req.url).pathname)) return '*';
            return matchOrigin(origin, c.env as Env) ?? undefined;
        },
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400,
        credentials: true,
    }),
);
app.use('/agents/*', secureHeaders());
app.route('/', agentRouter);

// ── 3. Unified auth + rate limiting ──────────────────────────────────────────
app.use('*', async (c, next) => {
    const pathname = c.req.path;
    const ip = c.get('ip');
    const analytics = c.get('analytics');
    const requestId = c.get('requestId');

    if (pathname.startsWith('/poc/') || pathname === '/poc') {
        const rl = await checkRateLimitTiered(c.env, ip, ANONYMOUS_AUTH_CONTEXT);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return c.json(
                { success: false, error: `Rate limit exceeded.` },
                429,
                {
                    'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                    'X-RateLimit-Limit': String(rl.limit),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(rl.resetAt),
                },
            );
        }
        c.set('authContext', { ...ANONYMOUS_AUTH_CONTEXT });
        await next();
        return;
    }

    const isPreAuth = c.req.method === 'GET' && (
        PRE_AUTH_PATHS.includes(pathname as typeof PRE_AUTH_PATHS[number]) ||
        pathname.startsWith('/api/deployments') ||
        MONITORING_BARE_PATHS.has(pathname)
    );
    if (isPreAuth) {
        const rl = await checkRateLimitTiered(c.env, ip, ANONYMOUS_AUTH_CONTEXT);
        if (!rl.allowed) {
            const clientIpHash = AnalyticsService.hashIp(ip);
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash,
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            analytics.trackSecurityEvent({
                eventType: 'rate_limit',
                path: pathname,
                method: c.req.method,
                clientIpHash,
                tier: ANONYMOUS_AUTH_CONTEXT.tier,
                reason: 'rate_limit_exceeded',
            });
            return c.json(
                { success: false, error: `Rate limit exceeded. Maximum ${rl.limit} requests per ${RATE_LIMIT_WINDOW} seconds.` },
                429,
                {
                    'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                    'X-RateLimit-Limit': String(rl.limit),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(rl.resetAt),
                },
            );
        }
        c.set('authContext', { ...ANONYMOUS_AUTH_CONTEXT });
        await next();
        return;
    }

    startTime(c, 'auth', 'Authentication');
    const authProvider = new BetterAuthProvider(c.env);
    const authResult = await authenticateRequestUnified(
        c.req.raw,
        c.env,
        createPgPool,
        authProvider,
    );
    endTime(c, 'auth');
    if (authResult.response) return authResult.response;
    c.set('authContext', authResult.context);
    await next();
});

// ── 4. CORS middleware ────────────────────────────────────────────────────────
app.use(
    '*',
    cors({
        origin: (origin, c) => {
            const pathname = new URL(c.req.url).pathname;
            if (isPublicEndpoint(pathname)) return '*';
            return matchOrigin(origin, c.env as Env) ?? undefined;
        },
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'],
        maxAge: 86400,
        credentials: true,
    }),
);

// ── 5. Secure headers ─────────────────────────────────────────────────────────
app.use('*', secureHeaders());

// ── 6. Pretty JSON ────────────────────────────────────────────────────────────
app.use('*', prettyJSON());

// ============================================================================
// PoC routes
// ============================================================================

app.all('/poc', async (c) => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.json({ success: false, error: 'PoC assets not available in this deployment' }, 503);
});

app.all('/poc/*', async (c) => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.json({ success: false, error: 'PoC assets not available in this deployment' }, 503);
});

// ============================================================================
// Pre-auth API meta routes
// ============================================================================

async function handleApiMeta(c: AppContext): Promise<Response> {
    const { routeApiMeta } = await import('./handlers/info.ts');
    const url = new URL(c.req.url);
    const res = await routeApiMeta(c.req.path, c.req.raw, url, c.env);
    return res ?? c.json({ success: false, error: 'Not found' }, 404);
}

app.get('/api', handleApiMeta);
app.get('/api/version', handleApiMeta);
app.get('/api/schemas', handleApiMeta);
app.get('/api/deployments', handleApiMeta);
app.get('/api/deployments/*', handleApiMeta);
app.get('/api/turnstile-config', handleApiMeta);
app.get('/api/sentry-config', handleApiMeta);
app.get('/api/auth/providers', (c) => handleAuthProviders(c.req.raw, c.env));

// ============================================================================
// Business routes sub-app (with ZTA + permission check middleware)
// ============================================================================

const routes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

routes.use('*', logger());

const NO_COMPRESS_PATHS = new Set(['/health', '/health/db-smoke', '/health/latest', '/metrics']);
const compressMiddleware = compress();
routes.use('*', async (c, next) => {
    const path = routesPath(c);
    if (NO_COMPRESS_PATHS.has(path)) {
        await next();
        return;
    }
    return compressMiddleware(c, next);
});

routes.use('*', async (c, next) => {
    const authContext = c.get('authContext');
    const analytics = c.get('analytics');
    const ip = c.get('ip');
    const path = routesPath(c);

    const accessDenied = await checkUserApiAccess(authContext, c.env);
    if (accessDenied) {
        analytics.trackSecurityEvent({
            eventType: 'auth_failure',
            path,
            method: c.req.method,
            clientIpHash: AnalyticsService.hashIp(ip),
            reason: 'api_disabled',
        });
        return accessDenied;
    }
    c.executionCtx.waitUntil(trackApiUsage(authContext, path, c.req.method, c.env));
    await next();
});

routes.use('*', async (c, next) => {
    const path = routesPath(c);
    if (path.startsWith('/auth/')) {
        await next();
        return;
    }
    const authContext = c.get('authContext');
    const analytics = c.get('analytics');
    const ip = c.get('ip');

    const permDenied = checkRoutePermission(path, authContext);
    if (permDenied) {
        analytics.trackSecurityEvent({
            eventType: 'auth_failure',
            path,
            method: c.req.method,
            clientIpHash: AnalyticsService.hashIp(ip),
            reason: 'route_permission_denied',
        });
        return permDenied;
    }
    await next();
});

// ── Mount domain route modules ────────────────────────────────────────────────
routes.route('/', compileRoutes);
routes.route('/', rulesRoutes);
routes.route('/', queueRoutes);
routes.route('/', configurationRoutes);
routes.route('/', adminRoutes);
routes.route('/', monitoringRoutes);
routes.route('/', apiKeysRoutes);
routes.route('/', webhookRoutes);
routes.route('/', workflowRoutes);
routes.route('/', browserRoutes);

// ── Docs redirect ─────────────────────────────────────────────────────────────

function buildDocsRedirectUrl(c: AppContext): string {
    const pathname = c.req.path;
    const docsSubpath = pathname.startsWith('/docs/') ? pathname.slice('/docs'.length) : '/';
    const url = new URL(c.req.url);
    const target = new URL(docsSubpath, getProjectUrls(c.env).docs);
    if (url.search) target.search = url.search;
    return target.toString();
}

routes.on(['GET', 'HEAD'], '/docs', (c) => c.redirect(buildDocsRedirectUrl(c), 302));
routes.on(['GET', 'HEAD'], '/docs/*', (c) => c.redirect(buildDocsRedirectUrl(c), 302));

// ── Static assets / SPA (catch-all) ──────────────────────────────────────────

routes.get('*', async (c) => {
    const { serveStaticAsset } = await import('./handlers/assets.ts');
    return serveStaticAsset(c.req.raw, c.env, c.req.path);
});

// ── Mount routes ──────────────────────────────────────────────────────────────

// ============================================================================
// OpenAPI Spec endpoint
// ============================================================================

export const OPENAPI_DOCUMENT_ARGS = {
    openapi: '3.0.0' as const,
    info: {
        title: 'Adblock Compiler API',
        version: '2.0.0',
        description: 'Compiler-as-a-Service for adblock filter lists. Transform, optimize, and combine filter lists from multiple sources with real-time progress tracking.',
        license: { name: 'GPL-3.0', url: 'https://github.com/jaypatrick/adblock-compiler/blob/master/LICENSE' },
        contact: { name: 'Jayson Knight', url: 'https://github.com/jaypatrick/adblock-compiler' },
    },
    servers: [{ url: 'https://adblock-compiler.jayson-knight.workers.dev', description: 'Production server' }],
};

app.get('/api/openapi.json', (c) => {
    const spec = app.getOpenAPIDocument(OPENAPI_DOCUMENT_ARGS);
    if (!spec.paths || Object.keys(spec.paths).length === 0) {
        return c.json(
            {
                error: 'OpenAPI specification is not yet configured for this deployment.',
                status: 501,
                detail: 'No OpenAPI routes are currently registered. Migrate key endpoints to use .openapi(createRoute(...)) before relying on this schema.',
            },
            501,
        );
    }
    return c.json(spec);
});

app.route('/api', routes);

// NOTE: app.route('/', routes) was intentionally removed in Phase 4 (domain route split).
// /api is the canonical base path. Legacy bare-path requests (/compile, /health, etc.)
// are no longer served. Update any client using bare paths to use /api/* instead.

// ============================================================================
// Exports
// ============================================================================

export async function handleRequest(
    request: Request,
    env: Env,
    _url: URL,
    _pathname: string,
    ctx: ExecutionContext,
): Promise<Response> {
    return app.fetch(request, env, ctx);
}

export type AppType = typeof app;

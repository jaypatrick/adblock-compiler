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
 *  - Extends `zValidator` to POST /compile/stream, /compile/batch, /configuration/validate
 *  - Shared helpers: `zodValidationError`, `verifyTurnstileInline`, `buildSyntheticRequest`, `buildHonoRequest`
 *  - `timing()` middleware adds `Server-Timing` headers to every response
 *  - `X-API-Version: v1` response header on every response
 *  - tRPC v11 handler mounted at `/api/trpc/*` (see `worker/trpc/`)
 *  - `etag()` on GET /metrics and GET /health for conditional request support
 *  - `prettyJSON()` globally (activate with `?pretty=true`)
 *  - `compress()` on the `routes` sub-app for automatic response compression (gzip/deflate) — scoped to business routes, never touches /api/auth/*
 *  - `logger()` on the `routes` sub-app for standardized request/response logging — scoped to business routes, never touches /api/auth/*
 *  - `cache()` middleware on /configuration/defaults (300s), /api/version (3600s), /api/schemas (3600s)
 *  - Cache-Control headers on /health (30 s) and /configuration/defaults (300 s)
 *  - `GET /api/openapi.json` serves the auto-generated OpenAPI 3.0 spec
 *  - `AppType` export enables `hc<AppType>()` typed RPC client in Angular
 *
 * @see docs/architecture/hono-routing.md — architecture overview
 * @see docs/architecture/hono-rpc-client.md — typed RPC client pattern
 * @see docs/architecture/trpc.md — tRPC API layer
 * @see worker/handlers/router.ts — thin re-export shim (backward compat)
 * @see worker/middleware/hono-middleware.ts — Phase 2 middleware factories
 * @see worker/trpc/ — tRPC routers, context, and handler
 */

/// <reference types="@cloudflare/workers-types" />

import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Context } from 'hono';
import { endTime, startTime, timing } from 'hono/timing';
import { etag } from 'hono/etag';
import { prettyJSON } from 'hono/pretty-json';
import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { cache } from 'hono/cache';
import { OpenAPIHono } from '@hono/zod-openapi';

// Types
import type { Env, IAuthContext } from './types.ts';
import { ANONYMOUS_AUTH_CONTEXT } from './types.ts';

// Services
import { AnalyticsService } from '../src/services/AnalyticsService.ts';
import { WORKER_DEFAULTS } from '../src/config/defaults.ts';

// Middleware
import { checkRateLimitTiered, verifyTurnstileToken } from './middleware/index.ts';
import { authenticateRequestUnified } from './middleware/auth.ts';
import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware, turnstileMiddleware } from './middleware/hono-middleware.ts';
import { BetterAuthProvider } from './middleware/better-auth-provider.ts';
import { verifyCfAccessJwt } from './middleware/cf-access.ts';

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
import { JsonResponse } from './utils/response.ts';

// Handlers (eagerly imported — on the hot path)
import {
    handleASTParseRequest,
    handleCompileAsync,
    handleCompileBatch,
    handleCompileBatchAsync,
    handleCompileJson,
    handleCompileStream,
    handleValidate,
} from './handlers/compile.ts';
import { handleValidateRule } from './handlers/validate-rule.ts';
import { handleRulesCreate, handleRulesDelete, handleRulesGet, handleRulesList, handleRulesUpdate } from './handlers/rules.ts';
import { handleNotify } from './handlers/webhook.ts';
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey, handleUpdateApiKey } from './handlers/api-keys.ts';
import { handleAdminBanUser, handleAdminDeleteUser, handleAdminGetUser, handleAdminListUsers, handleAdminUnbanUser, handleAdminUpdateUser } from './handlers/admin-users.ts';
import { handleAdminAuthConfig } from './handlers/auth-config.ts';
import { handleAuthProviders } from './handlers/auth-providers.ts';
import { handleAdminGetUserUsage } from './handlers/admin-usage.ts';
import {
    handleAdminNeonCreateBranch,
    handleAdminNeonDeleteBranch,
    handleAdminNeonGetBranch,
    handleAdminNeonGetProject,
    handleAdminNeonListBranches,
    handleAdminNeonListDatabases,
    handleAdminNeonListEndpoints,
    handleAdminNeonQuery,
} from './handlers/admin-neon.ts';
import { handleAdminGetAgentSession, handleAdminListAgentAuditLog, handleAdminListAgentSessions, handleAdminTerminateAgentSession } from './handlers/admin-agents.ts';
import { handlePrometheusMetrics } from './handlers/prometheus-metrics.ts';
import { handleMetrics } from './handlers/metrics.ts';
import { handleConfigurationDefaults, handleConfigurationResolve, handleConfigurationValidate } from './handlers/configuration.ts';

import { zValidator } from '@hono/zod-validator';
import { BatchRequestAsyncSchema, BatchRequestSyncSchema, CompileRequestSchema } from '../src/configuration/schemas.ts';
import { ConfigurationValidateRequestSchema, ResolveRequestSchema } from './handlers/configuration.ts';
import {
    AdminBanUserSchema,
    AdminNeonCreateBranchSchema,
    AdminNeonQuerySchema,
    AdminUnbanUserSchema,
    AdminUpdateUserSchema,
    AstParseRequestSchema,
    CreateApiKeyRequestSchema,
    RuleSetCreateSchema,
    RuleSetUpdateSchema,
    UpdateApiKeyRequestSchema,
    ValidateRequestSchema,
    ValidateRuleRequestSchema,
    WebhookNotifyRequestSchema,
} from './schemas.ts';

// tRPC
import { handleTrpcRequest } from './trpc/handler.ts';

// Agent routing (authenticated)
import { agentRouter } from './agents/index.ts';
import { handleWebSocketUpgrade } from './websocket.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Hono context variables set by middleware and available in route handlers.
 */
export interface Variables {
    authContext: IAuthContext;
    analytics: AnalyticsService;
    requestId: string;
    ip: string;
    isSSR: boolean; // true when the request originated from the SSR Worker via env.API.fetch()
}

// ============================================================================
// Constants
// ============================================================================

const RATE_LIMIT_WINDOW = WORKER_DEFAULTS.RATE_LIMIT_WINDOW_SECONDS;

// Dashboard monitoring endpoints — read-only, no PII, publicly accessible by design.
// Used by Angular MetricsStore (unauthenticated SWR polling).
// Anonymous-tier rate limiting (ANONYMOUS_AUTH_CONTEXT) is still applied via
// `checkRateLimitTiered`, so abuse is throttled despite the auth bypass.
//
// NOTE: /api/queue/stats and /api/queue/history are intentionally excluded because
// they require UserTier.Free per ROUTE_PERMISSION_REGISTRY. Including them here
// would force ANONYMOUS_AUTH_CONTEXT and break them for authenticated callers.
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

// Bare-path variants of MONITORING_API_PATHS — needed when the `routes` sub-app
// is mounted at `/` (in addition to `/api`), so that requests arriving as
// `/health`, `/metrics`, etc. also bypass auth.
const MONITORING_BARE_PATHS = new Set(MONITORING_API_PATHS.map((p) => p.slice(4)));

// ============================================================================
// Helper functions
// ============================================================================

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Normalise the route path for permission/ZTA checks inside the `routes` sub-app.
 *
 * Hono *route handlers* receive the prefix-stripped path (e.g. `/health` when the
 * sub-app is mounted under `/api`), but *middleware* registered with `routes.use()`
 * still sees the original request path (e.g. `/api/health`).  This helper strips
 * the `/api` prefix so both layers always work with the canonical path that matches
 * entries in `ROUTE_PERMISSION_REGISTRY`.
 */
function routesPath(c: AppContext): string {
    const p = c.req.path;
    return p.startsWith('/api/') ? p.slice(4) : p;
}

/**
 * Shared zValidator error callback — returns a 422 JSON response when Zod
 * validation fails.  Used across all `zValidator('json', ...)` calls.
 *
 * @hono/zod-validator types against npm:zod while this project uses
 * jsr:@zod/zod — both are Zod v4 with identical runtime APIs; the cast
 * to `any` avoids a module-identity mismatch that is type-only.
 *
 * When validation fails, `result.error` is a `ZodError` instance from
 * jsr:@zod/zod — typed as `unknown` here to bridge the module identity gap,
 * but serialised as-is into the 422 response body so callers receive full
 * structured error details.
 *
 * @example
 * ```ts
 * zValidator('json', SomeSchema as any, zodValidationError)
 * ```
 */
// deno-lint-ignore no-explicit-any
function zodValidationError(result: { success: boolean; error?: unknown }, c: AppContext): Response | void {
    if (!result.success) {
        return c.json({ success: false, error: 'Invalid request body', details: result.error }, 422);
    }
}

/**
 * Verify a Turnstile token extracted from an already-validated JSON body.
 *
 * Must be called AFTER `zValidator` has consumed the body stream (when the
 * `turnstileToken` field is accessed via `c.req.valid('json')`).
 *
 * Returns the error `Response` (403) on rejection, or `null` when the
 * Turnstile check passes (or when Turnstile is not configured).
 */
async function verifyTurnstileInline(c: AppContext, token: string): Promise<Response | null> {
    if (!c.env.TURNSTILE_SECRET_KEY) return null;
    const tsResult = await verifyTurnstileToken(c.env, token, c.get('ip'));
    if (!tsResult.success) {
        c.get('analytics').trackSecurityEvent({
            eventType: 'turnstile_rejection',
            path: c.req.path,
            method: c.req.method,
            clientIpHash: AnalyticsService.hashIp(c.get('ip')),
            tier: c.get('authContext').tier,
            reason: tsResult.error ?? 'turnstile_verification_failed',
        });
        return c.json({ success: false, error: tsResult.error ?? 'Turnstile verification failed' }, 403);
    }
    return null;
}

/**
 * Reconstruct a synthetic `Request` from a validated body.
 *
 * When `zValidator` consumes the original body stream, the existing handler
 * functions (which accept a `Request`) cannot re-read `c.req.raw`.  This
 * helper creates a new `Request` that re-serialises the validated body so the
 * handlers can continue using their existing `request.json()` API.
 */
function buildHonoRequest(c: AppContext, validatedBody: unknown): Request {
    return new Request(c.req.url, {
        method: 'POST',
        headers: c.req.raw.headers,
        body: JSON.stringify(validatedBody),
    });
}

/**
 * Create a minimal synthetic POST Request from a JSON body string.
 *
 * Used by tRPC procedures to pass a Request object to existing handler
 * functions that expect the legacy `(Request, Env, ...)` signature.
 * Re-exported from `./utils/synthetic-request.ts` so the public API surface
 * remains on `hono-app.ts`.
 */
export { buildSyntheticRequest } from './utils/synthetic-request.ts';

// ============================================================================
// App setup
// ============================================================================

/**
 * Applies CORS headers to an error response using the same allowlist-based
 * policy as the CORS middleware. Called from `app.onError()` because the CORS
 * middleware runs as a regular handler and has not yet executed when the global
 * error handler fires.
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

export const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Global error handler — catches unhandled exceptions in all routes ─────────
app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';

    // Normalize error details — handle non-Error throwables gracefully and
    // preserve stack traces so production incidents can be traced in logs.
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

// ── 0. Server-Timing middleware (must be first to wrap all operations) ────────
app.use('*', timing());

// ── 0a. API versioning header — set on every response ────────────────────────
app.use('*', async (c, next) => {
    await next();
    c.header('X-API-Version', 'v1');
});

// ── 1. Request metadata middleware ────────────────────────────────────────────
app.use('*', async (c, next) => {
    c.set('requestId', generateRequestId('api'));
    c.set('ip', c.req.raw.headers.get('CF-Connecting-IP') || 'unknown');
    c.set('analytics', createAnalyticsService(c.env));
    await next();
});

// ── 1a. SSR origin detection ──────────────────────────────────────────────────
// Identifies requests forwarded internally from the adblock-frontend
// SSR Worker via env.API.fetch(). These are trusted internal calls — Turnstile
// and rate limiting are not applicable to them.
app.use('*', async (c, next) => {
    c.set('isSSR', c.req.header('CF-Worker-Source') === 'ssr');
    await next();
});

// ── 1b. Better Auth route handler ──────────────────────────────────────────────
// Better Auth handles its own routes (sign-up, sign-in, sign-out, get-session,
// etc.) — these must bypass unified auth because they CREATE sessions rather
// than verifying existing ones.
//
// A 10s timeout guard is applied here (mirroring BetterAuthProvider.verifyToken)
// so that a hung Hyperdrive/Prisma call cannot stall the Worker CPU indefinitely.
// AbortController.abort() is called on timeout to signal cancellation to the
// underlying fetch plumbing used by Better Auth / Prisma.
//
// IMPORTANT: This handler is registered BEFORE the global logger() and compress()
// middleware to avoid interfering with Better Auth's response handling. Better Auth
// returns responses directly without calling next(), and applying compression/logging
// middleware before this handler can cause response stream conflicts.
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    if (!c.env.BETTER_AUTH_SECRET) return c.notFound();
    if (!c.env.HYPERDRIVE) {
        // Misconfigured deployment: Hyperdrive (Neon PostgreSQL) binding is missing.
        // Better Auth uses PostgreSQL via Hyperdrive, not D1.
        return c.json({ error: 'Authentication service is temporarily unavailable' }, 503);
    }
    const url = new URL(c.req.url);
    const auth = createAuth(c.env, url.origin);

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    // Preserve all request properties (method, headers, body) but attach the
    // abort signal so Better Auth's underlying fetch can be cancelled on timeout.
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
// Agent routes are handled by the dedicated agent sub-app, which enforces ZTA
// authentication BEFORE forwarding requests to the Durable Object.  This
// replaces the previous pattern where routeAgentRequest() was called before
// auth ran, creating a security gap where any unauthenticated request could
// reach agent endpoints.
//
// The agent router is mounted directly on `app` (not under `/api`) so the
// agents SDK URL pattern `/agents/{slug}/{instanceId}` is preserved exactly.
//
// NOTE: agentRouter handlers return a Response without calling `next()`, so
// the global CORS and secureHeaders middlewares (registered below) never run
// for `/agents/*` requests.  We must attach them explicitly here — before the
// sub-app mount — so browser clients (SSE connections in particular) receive
// the correct CORS allowlist enforcement and security headers.
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

    // PoC routes: skip auth, use anonymous context with rate limiting
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

    // Pre-auth API meta routes: apply anonymous-tier rate limiting, skip unified auth
    const isPreAuth = c.req.method === 'GET' && (
        PRE_AUTH_PATHS.includes(pathname as typeof PRE_AUTH_PATHS[number]) ||
        pathname.startsWith('/api/deployments') ||
        // Bare-path monitoring endpoints (routes sub-app mounted at /)
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
            // ZTA security event — feeds real-time Zero Trust dashboards and SIEM pipelines.
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

    // ── Better Auth session provider ──────────────────────────────────────────
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

// ── 6. Pretty JSON (debug mode: add ?pretty=true to any response) ─────────────
app.use('*', prettyJSON());

// ============================================================================
// PoC routes (static assets or 503) — handled in auth middleware
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

/**
 * Shared handler for all pre-auth API meta paths.
 * Lazily imports `routeApiMeta` so the deployment/version code is NOT
 * bundled into the isolate for unrelated requests.
 */
async function handleApiMeta(c: AppContext): Promise<Response> {
    const { routeApiMeta } = await import('./handlers/info.ts');
    const url = new URL(c.req.url);
    const res = await routeApiMeta(c.req.path, c.req.raw, url, c.env);
    return res ?? c.json({ success: false, error: 'Not found' }, 404);
}

/**
 * Admin session revocation handler — revoke all sessions for a specific user.
 *
 * ZTA compliance:
 *  - Requires admin role
 *  - Verifies Cloudflare Access JWT (defense-in-depth)
 *  - Emits `cf_access_denial` security event on CF Access failure
 */
export async function handleAdminRevokeUserSessions(c: AppContext): Promise<Response> {
    const authContext = c.get('authContext');
    if (authContext.role !== 'admin') {
        return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    // Defense-in-depth: verify CF Access JWT when configured
    const cfAccess = await verifyCfAccessJwt(c.req.raw, c.env);
    if (!cfAccess.valid) {
        if (c.env.ANALYTICS_ENGINE) {
            new AnalyticsService(c.env.ANALYTICS_ENGINE).trackSecurityEvent({
                eventType: 'cf_access_denial',
                path: c.req.path,
                method: c.req.method,
                reason: cfAccess.error ?? 'CF Access verification failed',
            });
        }
        return c.json({ success: false, error: cfAccess.error ?? 'CF Access verification failed' }, 403);
    }

    const userId = c.req.param('id')!;
    try {
        if (!c.env.HYPERDRIVE) {
            return c.json({ success: false, error: 'Database not configured' }, 503);
        }
        const pool = createPgPool(c.env.HYPERDRIVE.connectionString);
        const result = await pool.query(
            'DELETE FROM sessions WHERE user_id = $1',
            [userId],
        );
        return c.json({
            success: true,
            message: `Revoked ${result.rowCount ?? 0} session(s) for user ${userId}`,
        });
    } catch (error) {
        // deno-lint-ignore no-console
        console.error('[admin] Session revocation error:', error instanceof Error ? error.message : 'unknown');
        return c.json({ success: false, error: 'Failed to revoke sessions' }, 500);
    }
}

app.get('/api', handleApiMeta);
app.get('/api/version', cache({ cacheName: 'api-version', cacheControl: 'public, max-age=3600' }), handleApiMeta);
app.get('/api/schemas', cache({ cacheName: 'api-schemas', cacheControl: 'public, max-age=3600' }), handleApiMeta);
app.get('/api/deployments', handleApiMeta);
app.get('/api/deployments/*', handleApiMeta);
app.get('/api/turnstile-config', handleApiMeta);
app.get('/api/sentry-config', handleApiMeta);
// Public: returns which auth providers are active — used by frontend to conditionally render social login buttons.
app.get('/api/auth/providers', (c) => handleAuthProviders(c.req.raw, c.env));

// ============================================================================
// Business routes sub-app (with ZTA + permission check middleware)
// ============================================================================

const routes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── logger + compress scoped to the business routes sub-app ──────────────────
// Registered on `routes` (not on `app`) so these middleware never wrap the
// Better Auth handler responses.  app.on('/api/auth/*') is resolved before the
// routes sub-app mount, so auth traffic is completely unaffected.
routes.use('*', logger());

// Compress all routes EXCEPT health/smoke diagnostics — those must return
// raw JSON so curl | jq works without Accept-Encoding negotiation.
// Cloudflare's edge can strip or re-encode Accept-Encoding before it reaches
// the Worker, which means compress() would encode /health even for plain curl.
const NO_COMPRESS_PATHS = new Set(['/health', '/health/db-smoke', '/health/latest', '/metrics']);
// Instantiate once — avoids creating a new closure on every request.
const compressMiddleware = compress();
routes.use('*', async (c, next) => {
    // routesPath() strips the /api prefix so the path matches the canonical
    // route registered in ROUTE_PERMISSION_REGISTRY (e.g. /health not /api/health).
    const path = routesPath(c);
    if (NO_COMPRESS_PATHS.has(path)) {
        await next();
        return;
    }
    return compressMiddleware(c, next);
});

// ZTA: per-user API access gate + usage tracking
routes.use('*', async (c, next) => {
    const authContext = c.get('authContext');
    const analytics = c.get('analytics');
    const ip = c.get('ip');
    // Middleware receives the original path (before prefix-stripping); normalise it
    // so permission/usage records use the canonical path (e.g. /health, not /api/health).
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

// Route permission check
routes.use('*', async (c, next) => {
    const path = routesPath(c);
    // Skip permission check for /auth/* — Better Auth handles its own routing
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

// ── Admin routes ──────────────────────────────────────────────────────────────

routes.get('/admin/auth/config', (c) => handleAdminAuthConfig(c.req.raw, c.env, c.get('authContext')));

routes.get('/admin/users', (c) => handleAdminListUsers(c.req.raw, c.env, c.get('authContext')));
routes.get('/admin/users/:id', (c) => handleAdminGetUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!));
routes.patch(
    '/admin/users/:id',
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminUpdateUserSchema as any, zodValidationError),
    (c) => handleAdminUpdateUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);
routes.delete(
    '/admin/users/:id',
    rateLimitMiddleware(),
    (c) => handleAdminDeleteUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);
routes.post(
    '/admin/users/:id/ban',
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminBanUserSchema as any, zodValidationError),
    (c) => handleAdminBanUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);
routes.post(
    '/admin/users/:id/unban',
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminUnbanUserSchema as any, zodValidationError),
    (c) => handleAdminUnbanUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);

// Admin session revocation — revoke all sessions for a specific user
// Extracted to a named handler for testability and ZTA compliance.
routes.delete(
    '/admin/users/:id/sessions',
    rateLimitMiddleware(),
    async (c) => handleAdminRevokeUserSessions(c),
);

routes.get('/admin/usage/:userId', (c) => handleAdminGetUserUsage(c.req.raw, c.env, c.get('authContext'), c.req.param('userId')!));

routes.all('/admin/storage/*', async (c) => {
    // Permission check already ran in the routes middleware above; this handler
    // only runs when access is granted (admin tier + admin role).
    const { routeAdminStorage } = await import('./handlers/admin.ts');
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext'));
});

// ── Admin Neon reporting ─────────────────────────────────────────────────────

routes.get('/admin/neon/project', (c) => handleAdminNeonGetProject(c.req.raw, c.env, c.get('authContext')));
routes.get('/admin/neon/branches', (c) => handleAdminNeonListBranches(c.req.raw, c.env, c.get('authContext')));
routes.get('/admin/neon/branches/:branchId', (c) => handleAdminNeonGetBranch(c.req.raw, c.env, c.get('authContext'), c.req.param('branchId')!));
routes.post(
    '/admin/neon/branches',
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminNeonCreateBranchSchema as any, zodValidationError),
    (c) => handleAdminNeonCreateBranch(c.req.raw, c.env, c.get('authContext')),
);
routes.delete('/admin/neon/branches/:branchId', (c) => handleAdminNeonDeleteBranch(c.req.raw, c.env, c.get('authContext'), c.req.param('branchId')!));
routes.get('/admin/neon/endpoints', (c) => handleAdminNeonListEndpoints(c.req.raw, c.env, c.get('authContext')));
routes.get('/admin/neon/databases/:branchId', (c) => handleAdminNeonListDatabases(c.req.raw, c.env, c.get('authContext'), c.req.param('branchId')!));
routes.post(
    '/admin/neon/query',
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminNeonQuerySchema as any, zodValidationError),
    (c) => handleAdminNeonQuery(c.req.raw, c.env, c.get('authContext')),
);

// ── Admin agent data ──────────────────────────────────────────────────────────

routes.get('/admin/agents/sessions', (c) => handleAdminListAgentSessions(c.req.raw, c.env, c.get('authContext')));
routes.get('/admin/agents/sessions/:sessionId', (c) => handleAdminGetAgentSession(c.req.raw, c.env, c.get('authContext'), c.req.param('sessionId')!));
routes.get('/admin/agents/audit', (c) => handleAdminListAgentAuditLog(c.req.raw, c.env, c.get('authContext')));
routes.delete(
    '/admin/agents/sessions/:sessionId',
    rateLimitMiddleware(),
    (c) => handleAdminTerminateAgentSession(c.req.raw, c.env, c.get('authContext'), c.req.param('sessionId')!),
);

// ── Metrics ───────────────────────────────────────────────────────────────────

routes.get('/metrics/prometheus', etag(), (c) => handlePrometheusMetrics(c.req.raw, c.env));
routes.get('/metrics', etag(), (c) => handleMetrics(c.env));

// ── Queue (lazy) ──────────────────────────────────────────────────────────────

routes.all('/queue/*', async (c) => {
    const { routeQueue } = await import('./handlers/queue.ts');
    return routeQueue(c.req.path, c.req.raw, c.env, c.get('authContext'), c.get('analytics'), c.get('ip'));
});

// ── Compile routes ────────────────────────────────────────────────────────────
//
// All primary compile/validate routes share the same Phase 2 middleware stack:
//   1. bodySizeMiddleware()    — reject oversized payloads (413) via clone
//   2. rateLimitMiddleware()   — per-user/IP tiered quota (429)
//   3. zValidator()            — structural body validation (422) — consumes body
//   4. Inline Turnstile check  — reads token from c.req.valid('json')
//   5. buildHonoRequest() — re-creates the Request for the handler
//
// These routes use `zValidator` BEFORE Turnstile verification so the body
// stream is consumed exactly once.  `turnstileMiddleware()` would clone+parse,
// then zValidator would parse again — doubling the work.  Instead, Turnstile
// verification is inlined via `verifyTurnstileInline()` which reads the token
// from the already-validated `c.req.valid('json')`.
//
// See docs/architecture/hono-routing.md — Phase 2 for the full middleware
// extraction rationale and execution-order guarantees.

routes.post(
    '/compile',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    async (c) => {
        // Turnstile verification — reads token from the already-validated body
        // (c.req.raw body stream was consumed by zValidator above).
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        // Reconstruct a Request from the validated (and sanitised) data so the
        // existing handler signature (Request, Env, ...) is preserved.
        return handleCompileJson(buildHonoRequest(c, c.req.valid('json')), c.env, c.get('analytics'), c.get('requestId'));
    },
);

routes.post(
    '/compile/stream',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleCompileStream(buildHonoRequest(c, c.req.valid('json')), c.env);
    },
);

routes.post(
    '/compile/batch',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', BatchRequestSyncSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleCompileBatch(buildHonoRequest(c, c.req.valid('json')), c.env);
    },
);

routes.post(
    '/ast/parse',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', AstParseRequestSchema as any, zodValidationError),
    turnstileMiddleware(),
    (c) => handleASTParseRequest(c.req.raw, c.env),
);

routes.post(
    '/validate',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ValidateRequestSchema as any, zodValidationError),
    turnstileMiddleware(),
    (c) => handleValidate(buildHonoRequest(c, c.req.valid('json')), c.env),
);

// ── WebSocket ─────────────────────────────────────────────────────────────────

routes.get('/ws/compile', async (c) => {
    if (c.env.TURNSTILE_SECRET_KEY) {
        const url = new URL(c.req.url);
        const token = url.searchParams.get('turnstileToken') || '';
        const result = await verifyTurnstileToken(c.env, token, c.get('ip'));
        if (!result.success) {
            return c.json({ success: false, error: result.error || 'Turnstile verification failed' }, 403);
        }
    }
    return handleWebSocketUpgrade(c.req.raw, c.env);
});

// ── Validate-rule ─────────────────────────────────────────────────────────────

routes.post(
    '/validate-rule',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ValidateRuleRequestSchema as any, zodValidationError),
    (c) => handleValidateRule(c.req.raw, c.env),
);

// ── Configuration ─────────────────────────────────────────────────────────────

routes.get(
    '/configuration/defaults',
    cache({ cacheName: 'config-defaults', cacheControl: 'public, max-age=300' }),
    rateLimitMiddleware(),
    async (c) => {
        const res = await handleConfigurationDefaults(c.req.raw, c.env);
        return new Response(res.body, {
            status: res.status,
            headers: {
                ...Object.fromEntries(res.headers),
                'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
            },
        });
    },
);

routes.post(
    '/configuration/validate',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ConfigurationValidateRequestSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleConfigurationValidate(buildHonoRequest(c, c.req.valid('json')), c.env);
    },
);

routes.post(
    '/configuration/resolve',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ResolveRequestSchema as any, zodValidationError),
    turnstileMiddleware(),
    (c) => handleConfigurationResolve(c.req.raw, c.env),
);

// ── Rules (requireAuth) ───────────────────────────────────────────────────────

routes.get(
    '/rules',
    requireAuthMiddleware(),
    (c) => handleRulesList(c.req.raw, c.env),
);

routes.post(
    '/rules',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', RuleSetCreateSchema as any, zodValidationError),
    (c) => handleRulesCreate(c.req.raw, c.env),
);

routes.get(
    '/rules/:id',
    requireAuthMiddleware(),
    (c) => handleRulesGet(c.req.param('id')!, c.env),
);

routes.put(
    '/rules/:id',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', RuleSetUpdateSchema as any, zodValidationError),
    (c) => handleRulesUpdate(c.req.param('id')!, c.req.raw, c.env),
);

routes.delete(
    '/rules/:id',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    (c) => handleRulesDelete(c.req.param('id')!, c.env),
);

// ── API Keys (requireAuth + interactive session — Better Auth only) ──
//
// Only interactive user sessions (Better Auth cookie/bearer) may manage
// API keys. API-key-on-API-key and anonymous requests are rejected.

/** Auth methods that represent an interactive user session (not API key or anonymous). */
const INTERACTIVE_AUTH_METHODS = new Set(['better-auth']);

routes.post(
    '/keys',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CreateApiKeyRequestSchema as any, zodValidationError),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleCreateApiKey(c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

routes.get(
    '/keys',
    requireAuthMiddleware(),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleListApiKeys(c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

routes.delete(
    '/keys/:id',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleRevokeApiKey(c.req.param('id')!, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

routes.patch(
    '/keys/:id',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', UpdateApiKeyRequestSchema as any, zodValidationError),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleUpdateApiKey(c.req.param('id')!, c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

// ── Webhooks ──────────────────────────────────────────────────────────────────

routes.post(
    '/notify',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', WebhookNotifyRequestSchema as any, zodValidationError),
    (c) => handleNotify(c.req.raw, c.env),
);

// ── Async compile ─────────────────────────────────────────────────────────────

routes.post(
    '/compile/async',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    turnstileMiddleware(),
    (c) => handleCompileAsync(c.req.raw, c.env),
);

routes.post(
    '/compile/batch/async',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', BatchRequestAsyncSchema as any, zodValidationError),
    turnstileMiddleware(),
    (c) => handleCompileBatchAsync(c.req.raw, c.env),
);

routes.post(
    '/compile/container',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    turnstileMiddleware(),
    async (c) => {
        if (!c.env.ADBLOCK_COMPILER) {
            return c.json({ success: false, error: 'Container binding (ADBLOCK_COMPILER) is not available in this deployment' }, 503);
        }
        if (!c.env.CONTAINER_SECRET) {
            return c.json({ success: false, error: 'CONTAINER_SECRET is not configured' }, 503);
        }
        const id = c.env.ADBLOCK_COMPILER.idFromName('default');
        const stub = c.env.ADBLOCK_COMPILER.get(id);
        const containerReq = new Request('http://container/compile', {
            // Note: the URL hostname/scheme is irrelevant for DO stub.fetch() — the stub
            // intercepts the call and routes it to the container's internal server.
            // The path '/compile' maps to the POST /compile handler in container-server.ts.
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Container-Secret': c.env.CONTAINER_SECRET,
            },
            body: c.req.raw.body,
        });
        const containerRes = await stub.fetch(containerReq);
        return new Response(containerRes.body, {
            status: containerRes.status,
            headers: containerRes.headers,
        });
    },
);

// ── Workflow (lazy) ───────────────────────────────────────────────────────────

routes.all('/workflow/*', async (c) => {
    const { routeWorkflow } = await import('./handlers/workflow.ts');
    const url = new URL(c.req.url);
    return routeWorkflow(c.req.path, c.req.raw, c.env, c.get('authContext'), c.get('analytics'), c.get('ip'), url);
});

// ── Health (lazy) ─────────────────────────────────────────────────────────────

routes.get('/health', async (c) => {
    const { handleHealth } = await import('./handlers/health.ts');
    const res = await handleHealth(c.env);
    // Cache health checks for 30 seconds — stale-while-revalidate for availability
    return new Response(res.body, {
        status: res.status,
        headers: {
            ...Object.fromEntries(res.headers),
            'Cache-Control': 'public, max-age=30, stale-while-revalidate=10',
        },
    });
});

routes.get('/health/latest', async (c) => {
    const { handleHealthLatest } = await import('./handlers/health.ts');
    return handleHealthLatest(c.env);
});

routes.get('/health/db-smoke', async (c) => {
    const { handleDbSmoke } = await import('./handlers/health.ts');
    return handleDbSmoke(c.env);
});

routes.get('/container/status', etag(), async (c) => {
    const { handleContainerStatus } = await import('./handlers/container-status.ts');
    const res = await handleContainerStatus(c.env);
    // Cache container status briefly to reduce DO load from frequent polling
    return new Response(res.body, {
        status: res.status,
        headers: {
            ...Object.fromEntries(res.headers),
            'Cache-Control': 'public, max-age=15, stale-while-revalidate=5',
        },
    });
});

// ── Docs redirect ─────────────────────────────────────────────────────────────

/**
 * Build the external docs redirect target from a `/docs[/*]` request path.
 * Shared by GET and HEAD handlers to keep the redirect logic in one place.
 */
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

// ── Mount routes under both / and /api/ ──────────────────────────────────────
// This means /compile and /api/compile both work (frontend uses API_BASE_URL = '/api').
//
// Design note: double-mounting the same sub-app causes its middleware to run twice
// for /api/* requests — once via the /api mount (path stripped) and once via the /
// mount (full path).  Upstream ZTA middleware MUST ensure any permission checks or
// usage tracking are effectively applied once per request, and both middleware layers
// normalise the path by stripping any /api prefix so the permission registry is
// consulted with the canonical path (e.g. /health, not /api/health).
//
// /api is registered first so that /api/* requests get correct Hono prefix-stripping
// before the root-mount sub-app can intercept them as unrecognised paths.

// ============================================================================
// OpenAPI Spec endpoint — served at /api/openapi.json without authentication
// so it is publicly discoverable.
// ============================================================================

/**
 * Canonical OpenAPI document metadata shared between the live `/api/openapi.json`
 * endpoint and the `deno task generate:schema` script.
 *
 * Import this in `scripts/generate-openapi-schema.ts` instead of duplicating
 * the fields so the server URL, version, and info block never drift.
 */
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

// tRPC — all versions, public + authenticated
// Auth context is already set by the global middleware chain above.
// Mounted directly on `app` (not the `routes` sub-app) to avoid the
// compress/logger middleware that is scoped to business routes.
app.all('/api/trpc/*', (c) => handleTrpcRequest(c));

app.route('/api', routes);
app.route('/', routes);

// ============================================================================
// Exports
// ============================================================================

/**
 * Handle a single fetch request using the Hono app.
 * Exported for backward compatibility with `worker/handlers/router.ts`.
 *
 * `_url` and `_pathname` are accepted to match the original signature used in
 * the if/else router — callers do not need updating.  The Hono app re-derives
 * these from the request URL internally.
 */
export async function handleRequest(
    request: Request,
    env: Env,
    _url: URL,
    _pathname: string,
    ctx: ExecutionContext,
): Promise<Response> {
    return app.fetch(request, env, ctx);
}

/**
 * Typed RPC client type for use with `hono/client`'s `hc<AppType>()`.
 *
 * @see docs/architecture/hono-rpc-client.md
 */
export type AppType = typeof app;

/**
 * Hono application — Phase 2 routing migration.
 *
 * All routing logic from `worker/handlers/router.ts` has been migrated to
 * Hono route declarations.  Handler function signatures are UNCHANGED.
 *
 * Phase 2 extracts repeated inline middleware into reusable factories
 * (`bodySizeMiddleware`, `rateLimitMiddleware`, `turnstileMiddleware`,
 * `requireAuthMiddleware`) defined in `worker/middleware/hono-middleware.ts`.
 * POST /compile also applies `@hono/zod-validator` for structural validation.
 *
 * @see docs/architecture/hono-routing.md — architecture overview
 * @see worker/handlers/router.ts — thin re-export shim (backward compat)
 * @see worker/middleware/hono-middleware.ts — Phase 2 middleware factories
 */

/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Context } from 'hono';

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
import { ClerkAuthProvider } from './middleware/clerk-auth-provider.ts';
import { LocalJwtAuthProvider } from './middleware/local-jwt-auth-provider.ts';

// Utils
import { generateRequestId } from './utils/index.ts';
import { createAnalyticsService } from './utils/analytics.ts';
import { createPgPool } from './utils/pg-pool.ts';
import { DOCS_SITE_URL } from './utils/constants.ts';
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
import { handleClerkWebhook } from './handlers/clerk-webhook.ts';
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey, handleUpdateApiKey } from './handlers/api-keys.ts';
import { handleLocalBootstrapAdmin, handleLocalChangePassword, handleLocalLogin, handleLocalMe, handleLocalSignup, handleLocalUpdateProfile } from './handlers/local-auth.ts';
import { handleAdminCreateLocalUser, handleAdminDeleteLocalUser, handleAdminGetLocalUser, handleAdminListLocalUsers, handleAdminUpdateLocalUser } from './handlers/admin-users.ts';
import { handleAdminAuthConfig } from './handlers/auth-config.ts';
import { handleAdminGetUserUsage } from './handlers/admin-usage.ts';
import { handlePrometheusMetrics } from './handlers/prometheus-metrics.ts';
import { handleMetrics } from './handlers/metrics.ts';
import { handleConfigurationDefaults, handleConfigurationResolve, handleConfigurationValidate } from './handlers/configuration.ts';

import { zValidator } from '@hono/zod-validator';
import { CompileRequestSchema } from '../src/configuration/schemas.ts';

// Agent routing
import { routeAgentRequest } from './agent-routing.ts';
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
}

// ============================================================================
// Constants
// ============================================================================

const RATE_LIMIT_WINDOW = WORKER_DEFAULTS.RATE_LIMIT_WINDOW_SECONDS;

// Pre-auth API meta paths (bypass unified auth, use anonymous context)
const PRE_AUTH_PATHS = [
    '/api',
    '/api/version',
    '/api/schemas',
    '/api/turnstile-config',
    '/api/clerk-config',
    '/api/sentry-config',
] as const;

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

// ============================================================================
// App setup
// ============================================================================

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── 1. Request metadata middleware ────────────────────────────────────────────
app.use('*', async (c, next) => {
    c.set('requestId', generateRequestId('api'));
    c.set('ip', c.req.raw.headers.get('CF-Connecting-IP') || 'unknown');
    c.set('analytics', createAnalyticsService(c.env));
    await next();
});

// ── 2. MCP Agent routing + auth (combined to avoid double-pass) ──────────────
app.use('*', async (c, next) => {
    // MCP Agent routes: must run before auth
    const agentResponse = await routeAgentRequest(c.req.raw, c.env);
    if (agentResponse) return agentResponse;

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
        pathname.startsWith('/api/deployments')
    );
    if (isPreAuth) {
        const rl = await checkRateLimitTiered(c.env, ip, ANONYMOUS_AUTH_CONTEXT);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
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

    // Standard unified authentication
    const authProvider = c.env.CLERK_JWKS_URL ? new ClerkAuthProvider(c.env) : new LocalJwtAuthProvider(c.env);
    const authResult = await authenticateRequestUnified(c.req.raw, c.env, createPgPool, authProvider);
    if (authResult.response) return authResult.response;
    c.set('authContext', authResult.context);
    await next();
});

// ── 3. CORS middleware ────────────────────────────────────────────────────────
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
    }),
);

// ── 4. Secure headers ─────────────────────────────────────────────────────────
app.use('*', secureHeaders());

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

app.get('/api', handleApiMeta);
app.get('/api/version', handleApiMeta);
app.get('/api/schemas', handleApiMeta);
app.get('/api/deployments', handleApiMeta);
app.get('/api/deployments/*', handleApiMeta);
app.get('/api/turnstile-config', handleApiMeta);
app.get('/api/clerk-config', handleApiMeta);
app.get('/api/sentry-config', handleApiMeta);

// ============================================================================
// Business routes sub-app (with ZTA + permission check middleware)
// ============================================================================

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();

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

// Route permission check (skip for auth/* routes which handle their own 404 for Clerk)
routes.use('*', async (c, next) => {
    const path = routesPath(c);
    // Skip permission check for /auth/* — the route handlers return 404 when Clerk is active
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

// ── Auth routes (local JWT only; 404 when Clerk is active) ───────────────────

routes.post('/auth/signup', (c) => {
    if (c.env.CLERK_JWKS_URL) return c.json({ success: false, error: 'Not found' }, 404);
    return handleLocalSignup(c.req.raw, c.env, c.get('analytics'), c.get('ip'));
});

routes.post('/auth/login', (c) => {
    if (c.env.CLERK_JWKS_URL) return c.json({ success: false, error: 'Not found' }, 404);
    return handleLocalLogin(c.req.raw, c.env, c.get('analytics'), c.get('ip'));
});

routes.get('/auth/me', (c) => {
    if (c.env.CLERK_JWKS_URL) return c.json({ success: false, error: 'Not found' }, 404);
    return handleLocalMe(c.req.raw, c.env, c.get('authContext'));
});

routes.post('/auth/change-password', (c) => {
    if (c.env.CLERK_JWKS_URL) return c.json({ success: false, error: 'Not found' }, 404);
    return handleLocalChangePassword(c.req.raw, c.env, c.get('authContext'), c.get('analytics'), c.get('ip'));
});

routes.post('/auth/bootstrap-admin', (c) => {
    if (c.env.CLERK_JWKS_URL) return c.json({ success: false, error: 'Not found' }, 404);
    return handleLocalBootstrapAdmin(c.req.raw, c.env, c.get('authContext'), c.get('analytics'), c.get('ip'));
});

routes.patch('/auth/profile', (c) => {
    if (c.env.CLERK_JWKS_URL) return c.json({ success: false, error: 'Not found' }, 404);
    return handleLocalUpdateProfile(c.req.raw, c.env, c.get('authContext'), c.get('analytics'), c.get('ip'));
});

// ── Admin routes ──────────────────────────────────────────────────────────────

routes.get('/admin/auth/config', (c) => handleAdminAuthConfig(c.req.raw, c.env, c.get('authContext')));

routes.get('/admin/local-users', (c) => handleAdminListLocalUsers(c.req.raw, c.env, c.get('authContext')));
routes.post('/admin/local-users', (c) => handleAdminCreateLocalUser(c.req.raw, c.env, c.get('authContext')));
routes.get('/admin/local-users/:id', (c) => handleAdminGetLocalUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')));
routes.patch('/admin/local-users/:id', (c) => handleAdminUpdateLocalUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')));
routes.delete('/admin/local-users/:id', (c) => handleAdminDeleteLocalUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')));

routes.get('/admin/usage/:userId', (c) => handleAdminGetUserUsage(c.req.raw, c.env, c.get('authContext'), c.req.param('userId')));

routes.all('/admin/storage/*', async (c) => {
    // Permission check already ran in the routes middleware above; this handler
    // only runs when access is granted (admin tier + admin role).
    const { routeAdminStorage } = await import('./handlers/admin.ts');
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext'));
});

// ── Metrics ───────────────────────────────────────────────────────────────────

routes.get('/metrics/prometheus', (c) => handlePrometheusMetrics(c.req.raw, c.env));
routes.get('/metrics', (c) => handleMetrics(c.env));

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
//   3. turnstileMiddleware()   — Cloudflare human verification (403) via clone
//
// POST /compile differs from the other compile routes:
//   - zValidator runs BEFORE Turnstile verification so the body stream is only
//     parsed once (zValidator consumes it; Turnstile reads from the cached
//     c.req.valid('json') in the final handler, avoiding a second clone+parse).
//   - Turnstile verification is inlined in the final handler step rather than
//     as a separate middleware, because it needs the already-validated body.
//
// See docs/architecture/hono-routing.md — Phase 2 for the full middleware
// extraction rationale and execution-order guarantees.

routes.post(
    '/compile',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // Zod body validation — rejects structurally invalid requests with 422
    // BEFORE Turnstile is checked.  Running zValidator here (rather than after
    // turnstileMiddleware) means the body stream is consumed exactly once:
    // turnstileMiddleware would clone+parse and then zValidator would parse
    // again, doubling the work for every compile request.
    //
    // @hono/zod-validator types against npm:zod while this project uses
    // jsr:@zod/zod — both are Zod v4 with identical runtime APIs; the cast
    // to `any` avoids a module-identity mismatch that is type-only.
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, (result, c) => {
        if (!result.success) {
            return c.json({ success: false, error: 'Invalid request body', details: result.error }, 422);
        }
    }),
    async (c) => {
        // Turnstile verification — reads token from the already-validated body
        // (c.req.raw body stream was consumed by zValidator above, so we must
        // not attempt to re-read c.req.raw here).
        if (c.env.TURNSTILE_SECRET_KEY) {
            // deno-lint-ignore no-explicit-any
            const token = (c.req.valid('json') as any).turnstileToken ?? '';
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
        }
        // Reconstruct a Request from the validated (and sanitised) data so the
        // existing handler signature (Request, Env, ...) is preserved.
        const validatedBody = c.req.valid('json');
        const syntheticReq = new Request(c.req.url, {
            method: 'POST',
            headers: c.req.raw.headers,
            body: JSON.stringify(validatedBody),
        });
        return handleCompileJson(syntheticReq, c.env, c.get('analytics'), c.get('requestId'));
    },
);

routes.post(
    '/compile/stream',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    turnstileMiddleware(),
    (c) => handleCompileStream(c.req.raw, c.env),
);

routes.post(
    '/compile/batch',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    turnstileMiddleware(),
    (c) => handleCompileBatch(c.req.raw, c.env),
);

routes.post(
    '/ast/parse',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    turnstileMiddleware(),
    (c) => handleASTParseRequest(c.req.raw, c.env),
);

routes.post(
    '/validate',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    turnstileMiddleware(),
    (c) => handleValidate(c.req.raw),
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
    rateLimitMiddleware(),
    bodySizeMiddleware(),
    (c) => handleValidateRule(c.req.raw, c.env),
);

// ── Configuration ─────────────────────────────────────────────────────────────

routes.get(
    '/configuration/defaults',
    rateLimitMiddleware(),
    (c) => handleConfigurationDefaults(c.req.raw, c.env),
);

routes.post(
    '/configuration/validate',
    rateLimitMiddleware(),
    bodySizeMiddleware(),
    turnstileMiddleware(),
    (c) => handleConfigurationValidate(c.req.raw, c.env),
);

routes.post(
    '/configuration/resolve',
    rateLimitMiddleware(),
    bodySizeMiddleware(),
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
    (c) => handleRulesCreate(c.req.raw, c.env),
);

routes.get(
    '/rules/:id',
    requireAuthMiddleware(),
    (c) => handleRulesGet(c.req.param('id'), c.env),
);

routes.put(
    '/rules/:id',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    (c) => handleRulesUpdate(c.req.param('id'), c.req.raw, c.env),
);

routes.delete(
    '/rules/:id',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    (c) => handleRulesDelete(c.req.param('id'), c.env),
);

// ── API Keys (requireAuth + Clerk JWT) ────────────────────────────────────────

routes.post(
    '/keys',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    async (c) => {
        if (c.get('authContext').authMethod !== 'clerk-jwt') return JsonResponse.forbidden('API key management requires Clerk authentication');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleCreateApiKey(c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

routes.get(
    '/keys',
    requireAuthMiddleware(),
    async (c) => {
        if (c.get('authContext').authMethod !== 'clerk-jwt') return JsonResponse.forbidden('API key management requires Clerk authentication');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleListApiKeys(c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

routes.delete(
    '/keys/:id',
    requireAuthMiddleware(),
    async (c) => {
        if (c.get('authContext').authMethod !== 'clerk-jwt') return JsonResponse.forbidden('API key management requires Clerk authentication');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleRevokeApiKey(c.req.param('id'), c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

routes.patch(
    '/keys/:id',
    requireAuthMiddleware(),
    async (c) => {
        if (c.get('authContext').authMethod !== 'clerk-jwt') return JsonResponse.forbidden('API key management requires Clerk authentication');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleUpdateApiKey(c.req.param('id'), c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

// ── Webhooks ──────────────────────────────────────────────────────────────────

routes.post('/webhooks/clerk', (c) => handleClerkWebhook(c.req.raw, c.env));

routes.post(
    '/notify',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    (c) => handleNotify(c.req.raw, c.env),
);

// ── Async compile ─────────────────────────────────────────────────────────────

routes.post(
    '/compile/async',
    bodySizeMiddleware(),
    turnstileMiddleware(),
    (c) => handleCompileAsync(c.req.raw, c.env),
);

routes.post(
    '/compile/batch/async',
    bodySizeMiddleware(),
    turnstileMiddleware(),
    (c) => handleCompileBatchAsync(c.req.raw, c.env),
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
    return handleHealth(c.env);
});

routes.get('/health/latest', async (c) => {
    const { handleHealthLatest } = await import('./handlers/health.ts');
    return handleHealthLatest(c.env);
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
    const target = new URL(docsSubpath, DOCS_SITE_URL);
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

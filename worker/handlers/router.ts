/**
 * Core request router for the Cloudflare Worker.
 *
 * `handleRequest` contains all business-logic routing that was previously
 * inlined in `workerHandler._handleRequest`.  `worker.ts` is now a thin
 * entry-point that delegates here.
 */

/// <reference types="@cloudflare/workers-types" />

// Types
import type { Env, IAuthContext } from '../types.ts';
import { ANONYMOUS_AUTH_CONTEXT } from '../types.ts';

// Middleware
import { checkRateLimitTiered, validateRequestSize, verifyTurnstileToken } from '../middleware/index.ts';
import { authenticateRequestUnified, requireAuth } from '../middleware/auth.ts';
import { ClerkAuthProvider } from '../middleware/clerk-auth-provider.ts';
import { LocalJwtAuthProvider } from '../middleware/local-jwt-auth-provider.ts';

// Utils
import { WORKER_DEFAULTS } from '../../src/config/defaults.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { JsonResponse } from '../utils/response.ts';
import { generateRequestId } from '../utils/index.ts';
import { createAnalyticsService } from '../utils/analytics.ts';
import { createPgPool } from '../utils/pg-pool.ts';
import { DOCS_SITE_URL } from '../utils/constants.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';
import { checkUserApiAccess } from '../utils/user-access.ts';
import { trackApiUsage } from '../utils/api-usage.ts';

// Handlers (eagerly imported — on the hot path)
import { handleASTParseRequest, handleCompileAsync, handleCompileBatch, handleCompileBatchAsync, handleCompileJson, handleCompileStream, handleValidate } from './compile.ts';
import { handleValidateRule } from './validate-rule.ts';
import { handleRulesCreate, handleRulesDelete, handleRulesGet, handleRulesList, handleRulesUpdate } from './rules.ts';
import { handleNotify } from './webhook.ts';
import { handleClerkWebhook } from './clerk-webhook.ts';
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey, handleUpdateApiKey } from './api-keys.ts';
import { handleLocalBootstrapAdmin, handleLocalChangePassword, handleLocalLogin, handleLocalMe, handleLocalSignup, handleLocalUpdateProfile } from './local-auth.ts';
import { handleAdminCreateLocalUser, handleAdminDeleteLocalUser, handleAdminGetLocalUser, handleAdminListLocalUsers, handleAdminUpdateLocalUser } from './admin-users.ts';
import { handleAdminAuthConfig } from './auth-config.ts';
import { handleAdminGetUserUsage } from './admin-usage.ts';
import { handlePrometheusMetrics } from './prometheus-metrics.ts';
import { handleMetrics } from './metrics.ts';
import { handleConfigurationDefaults, handleConfigurationResolve, handleConfigurationValidate } from './configuration.ts';

// Agent routing
import { routeAgentRequest } from '../agent-routing.ts';
import { handleWebSocketUpgrade } from '../websocket.ts';

// ── Internal helpers ─────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW = WORKER_DEFAULTS.RATE_LIMIT_WINDOW_SECONDS;

/** Returns a 413 Payload Too Large JSON response. */
function payloadTooLarge(error: string): Response {
    return Response.json({ success: false, error }, { status: 413 });
}

/**
 * Verify Turnstile token from a cloned request body.
 * Returns null on success; a Response on failure.
 *
 * When TURNSTILE_SECRET_KEY is configured, JSON parse failures are treated as
 * verification failures (400 Bad Request) so clients cannot skip the check by
 * sending a malformed body.
 */
async function checkTurnstile(
    request: Request,
    env: Env,
    ip: string,
): Promise<Response | null> {
    if (!env.TURNSTILE_SECRET_KEY) return null;
    let token = '';
    try {
        const body = await request.clone().json() as { turnstileToken?: string };
        token = body.turnstileToken || '';
    } catch {
        // Body is not valid JSON — treat as a missing token (verification will fail below)
        return Response.json(
            { success: false, error: 'Invalid request body — could not extract Turnstile token' },
            { status: 400 },
        );
    }
    const result = await verifyTurnstileToken(env, token, ip);
    if (!result.success) {
        return Response.json(
            { success: false, error: result.error || 'Turnstile verification failed' },
            { status: 403 },
        );
    }
    return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Core request handler — called by `workerHandler.fetch()` which wraps the
 * response with CORS headers.
 */
export async function handleRequest(
    request: Request,
    env: Env,
    url: URL,
    pathname: string,
    ctx: ExecutionContext,
): Promise<Response> {
    const requestId = generateRequestId('api');
    const analytics = createAnalyticsService(env);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // MCP Agent routing (must run before other routing)
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // Pre-auth API metadata routes (lazy import).
    // Narrowed to the exact paths served by routeApiMeta to avoid pulling the
    // deployment/version code into the isolate for unrelated API requests.
    const isApiMetaRoute = request.method === 'GET' &&
        (pathname === '/api' ||
            pathname === '/api/version' ||
            pathname.startsWith('/api/deployments') ||
            pathname === '/api/turnstile-config' ||
            pathname === '/api/clerk-config' ||
            pathname === '/api/sentry-config');
    if (isApiMetaRoute) {
        // ZTA: Apply anonymous-tier rate limiting before serving pre-auth config
        // endpoints. These routes bypass unified auth, so they need their own guard.
        const rl = await checkRateLimitTiered(env, ip, ANONYMOUS_AUTH_CONTEXT);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return Response.json(
                { success: false, error: `Rate limit exceeded. Maximum ${rl.limit} requests per ${RATE_LIMIT_WINDOW} seconds.` },
                {
                    status: 429,
                    headers: {
                        'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                        'X-RateLimit-Limit': String(rl.limit),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': String(rl.resetAt),
                    },
                },
            );
        }
        const { routeApiMeta } = await import('./info.ts');
        const metaResponse = await routeApiMeta(pathname, request, url, env);
        if (metaResponse) return metaResponse;
    }

    // Strip /api prefix — frontend uses API_BASE_URL = '/api'
    const routePath = pathname.startsWith('/api/') ? pathname.slice(4) : pathname;

    // ── Unified Authentication ──────────────────────────────────────────────
    const authProvider = env.CLERK_JWKS_URL ? new ClerkAuthProvider(env) : new LocalJwtAuthProvider(env);
    const authResult = await authenticateRequestUnified(request, env, createPgPool, authProvider);
    if (authResult.response) return authResult.response;
    const authContext: IAuthContext = authResult.context;

    // ── ZTA: Per-user API access gate ───────────────────────────────────────
    const accessDenied = await checkUserApiAccess(authContext, env);
    if (accessDenied) {
        analytics.trackSecurityEvent({
            eventType: 'auth_failure',
            path: routePath,
            method: request.method,
            clientIpHash: AnalyticsService.hashIp(ip),
            reason: 'api_disabled',
        });
        return accessDenied;
    }
    ctx.waitUntil(trackApiUsage(authContext, routePath, request.method, env));

    // ── Local JWT auth routes (pre-Clerk bridge) ────────────────────────────
    if (routePath.startsWith('/auth/')) {
        if (env.CLERK_JWKS_URL) return Response.json({ success: false, error: 'Not found' }, { status: 404 });
        if (routePath === '/auth/signup' && request.method === 'POST') return handleLocalSignup(request, env, analytics, ip);
        if (routePath === '/auth/login' && request.method === 'POST') return handleLocalLogin(request, env, analytics, ip);
        if (routePath === '/auth/me' && request.method === 'GET') return handleLocalMe(request, env, authContext);
        if (routePath === '/auth/change-password' && request.method === 'POST') return handleLocalChangePassword(request, env, authContext, analytics, ip);
        if (routePath === '/auth/bootstrap-admin' && request.method === 'POST') return handleLocalBootstrapAdmin(request, env, authContext, analytics, ip);
        if (routePath === '/auth/profile' && request.method === 'PATCH') return handleLocalUpdateProfile(request, env, authContext, analytics, ip);
    }

    // ── Admin storage (JWT admin auth, lazy) ──────────────────────────────
    if (routePath.startsWith('/admin/storage')) {
        // ZTA: check permissions before the dynamic import to avoid loading
        // the admin module for unauthorized requests and to emit centralized
        // security-event telemetry consistent with all other permission denials.
        const permDenied = checkRoutePermission(routePath, authContext);
        if (permDenied) {
            analytics.trackSecurityEvent({
                eventType: 'auth_failure',
                path: routePath,
                method: request.method,
                clientIpHash: AnalyticsService.hashIp(ip),
                reason: 'route_permission_denied',
            });
            return permDenied;
        }
        const { routeAdminStorage } = await import('./admin.ts');
        return routeAdminStorage(routePath, request, env, authContext);
    }

    // ── Route permission check ──────────────────────────────────────────────
    const permDenied = checkRoutePermission(routePath, authContext);
    if (permDenied) {
        analytics.trackSecurityEvent({
            eventType: 'auth_failure',
            path: routePath,
            method: request.method,
            clientIpHash: AnalyticsService.hashIp(ip),
            reason: 'route_permission_denied',
        });
        return permDenied;
    }

    // Admin local-users management
    if (routePath === '/admin/auth/config' && request.method === 'GET') return handleAdminAuthConfig(request, env, authContext);
    if (routePath === '/admin/local-users' && request.method === 'GET') return handleAdminListLocalUsers(request, env, authContext);
    if (routePath === '/admin/local-users' && request.method === 'POST') return handleAdminCreateLocalUser(request, env, authContext);
    const localUserMatch = routePath.match(/^\/admin\/local-users\/([0-9a-f-]{36})$/i);
    if (localUserMatch) {
        const userId = localUserMatch[1];
        if (request.method === 'GET') return handleAdminGetLocalUser(request, env, authContext, userId);
        if (request.method === 'PATCH') return handleAdminUpdateLocalUser(request, env, authContext, userId);
        if (request.method === 'DELETE') return handleAdminDeleteLocalUser(request, env, authContext, userId);
    }
    const usageMatch = routePath.match(/^\/admin\/usage\/([^/]+)$/);
    if (usageMatch && request.method === 'GET') return handleAdminGetUserUsage(request, env, authContext, usageMatch[1]);

    // Metrics
    if (routePath === '/metrics/prometheus' && request.method === 'GET') return handlePrometheusMetrics(request, env);
    if (routePath === '/metrics' && request.method === 'GET') return handleMetrics(env);

    // Queue routes (lazy)
    if (routePath.startsWith('/queue/')) {
        const { routeQueue } = await import('./queue.ts');
        return routeQueue(routePath, request, env, authContext, analytics, ip);
    }

    // ── Compile / AST / Validate routes ──────────────────────────────────────
    if (
        (routePath === '/compile' || routePath === '/compile/stream' || routePath === '/compile/batch') &&
        request.method === 'POST'
    ) {
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return Response.json(
                { success: false, error: `Rate limit exceeded. Maximum ${rl.limit} requests per ${RATE_LIMIT_WINDOW} seconds.` },
                {
                    status: 429,
                    headers: {
                        'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                        'X-RateLimit-Limit': String(rl.limit),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': String(rl.resetAt),
                    },
                },
            );
        }
        const tsError = await checkTurnstile(request, env, ip);
        if (tsError) return tsError;
        if (routePath === '/compile') return handleCompileJson(request, env, analytics, requestId);
        if (routePath === '/compile/stream') return handleCompileStream(request, env);
        return handleCompileBatch(request, env);
    }

    if (routePath === '/ast/parse' && request.method === 'POST') {
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return Response.json(
                { success: false, error: `Rate limit exceeded. Maximum ${rl.limit} requests per ${RATE_LIMIT_WINDOW} seconds.` },
                {
                    status: 429,
                    headers: {
                        'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                        'X-RateLimit-Limit': String(rl.limit),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': String(rl.resetAt),
                    },
                },
            );
        }
        const tsError = await checkTurnstile(request, env, ip);
        if (tsError) return tsError;
        return handleASTParseRequest(request, env);
    }

    if (routePath === '/validate' && request.method === 'POST') {
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return Response.json(
                { success: false, error: `Rate limit exceeded. Maximum ${rl.limit} requests per ${RATE_LIMIT_WINDOW} seconds.` },
                {
                    status: 429,
                    headers: {
                        'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                        'X-RateLimit-Limit': String(rl.limit),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': String(rl.resetAt),
                    },
                },
            );
        }
        const tsError = await checkTurnstile(request, env, ip);
        if (tsError) return tsError;
        return handleValidate(request);
    }

    if (routePath === '/ws/compile' && request.method === 'GET') {
        // Turnstile token for WebSocket comes from the query parameter (no request body on GET)
        if (env.TURNSTILE_SECRET_KEY) {
            const token = url.searchParams.get('turnstileToken') || '';
            const result = await verifyTurnstileToken(env, token, ip);
            if (!result.success) {
                return Response.json(
                    { success: false, error: result.error || 'Turnstile verification failed' },
                    { status: 403 },
                );
            }
        }
        return handleWebSocketUpgrade(request, env);
    }

    // Validate-rule (rate limited)
    if (routePath === '/validate-rule' && request.method === 'POST') {
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            analytics.trackSecurityEvent({
                eventType: 'rate_limit',
                path: '/validate-rule',
                method: 'POST',
                clientIpHash: AnalyticsService.hashIp(ip),
                tier: authContext.tier,
                reason: 'validate_rule_rate_limit_exceeded',
            });
            return Response.json({ success: false, error: 'Rate limit exceeded' }, {
                status: 429,
                headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
            });
        }
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        return handleValidateRule(request, env);
    }

    // Configuration management
    if (routePath === '/configuration/defaults' && request.method === 'GET') {
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
        }
        return handleConfigurationDefaults(request, env);
    }
    if (routePath === '/configuration/validate' && request.method === 'POST') {
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
        }
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        const tsError = await checkTurnstile(request, env, ip);
        if (tsError) {
            analytics.trackSecurityEvent({
                eventType: 'auth_failure',
                path: '/configuration/validate',
                method: 'POST',
                clientIpHash: AnalyticsService.hashIp(ip),
                tier: authContext.tier,
                reason: 'turnstile_failed',
            });
            return tsError;
        }
        return handleConfigurationValidate(request, env);
    }
    if (routePath === '/configuration/resolve' && request.method === 'POST') {
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            analytics.trackRateLimitExceeded({
                requestId,
                clientIpHash: AnalyticsService.hashIp(ip),
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
        }
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        const tsError = await checkTurnstile(request, env, ip);
        if (tsError) {
            analytics.trackSecurityEvent({
                eventType: 'auth_failure',
                path: '/configuration/resolve',
                method: 'POST',
                clientIpHash: AnalyticsService.hashIp(ip),
                tier: authContext.tier,
                reason: 'turnstile_failed',
            });
            return tsError;
        }
        return handleConfigurationResolve(request, env);
    }

    // Rules management (requires auth)
    if (routePath === '/rules') {
        const g = requireAuth(authContext);
        if (g) return g;
        if (request.method === 'GET') return handleRulesList(request, env);
        if (request.method === 'POST') {
            const sz = await validateRequestSize(request, env);
            if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
            const rl = await checkRateLimitTiered(env, ip, authContext);
            if (!rl.allowed) return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
            return handleRulesCreate(request, env);
        }
    }
    const rulesIdMatch = routePath.match(/^\/rules\/([0-9a-f-]{36})$/i);
    if (rulesIdMatch) {
        const g = requireAuth(authContext);
        if (g) return g;
        const ruleId = rulesIdMatch[1];
        if (request.method === 'GET') return handleRulesGet(ruleId, env);
        if (request.method === 'PUT') {
            const sz = await validateRequestSize(request, env);
            if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
            const rl = await checkRateLimitTiered(env, ip, authContext);
            if (!rl.allowed) return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
            return handleRulesUpdate(ruleId, request, env);
        }
        if (request.method === 'DELETE') {
            const rl = await checkRateLimitTiered(env, ip, authContext);
            if (!rl.allowed) return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
            return handleRulesDelete(ruleId, env);
        }
    }

    // API key management (Clerk JWT required)
    if (routePath === '/keys' || routePath.startsWith('/keys/')) {
        const g = requireAuth(authContext);
        if (g) return g;
        if (authContext.authMethod !== 'clerk-jwt') return JsonResponse.forbidden('API key management requires Clerk authentication');
        if (!env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        const connStr = env.HYPERDRIVE.connectionString;
        if (routePath === '/keys') {
            if (request.method === 'POST') {
                const rl = await checkRateLimitTiered(env, ip, authContext);
                if (!rl.allowed) return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
                return handleCreateApiKey(request, authContext, connStr, createPgPool);
            }
            if (request.method === 'GET') return handleListApiKeys(authContext, connStr, createPgPool);
        }
        const keyIdMatch = routePath.match(/^\/keys\/([0-9a-f-]{36})$/i);
        if (keyIdMatch) {
            const keyId = keyIdMatch[1];
            if (request.method === 'DELETE') return handleRevokeApiKey(keyId, authContext, connStr, createPgPool);
            if (request.method === 'PATCH') return handleUpdateApiKey(keyId, request, authContext, connStr, createPgPool);
        }
    }

    // Webhooks
    if (routePath === '/webhooks/clerk' && request.method === 'POST') return handleClerkWebhook(request, env);
    if (routePath === '/notify' && request.method === 'POST') {
        const g = requireAuth(authContext);
        if (g) return g;
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) return JsonResponse.rateLimited(RATE_LIMIT_WINDOW);
        return handleNotify(request, env);
    }

    // Async compile (Turnstile verified)
    if ((routePath === '/compile/async' || routePath === '/compile/batch/async') && request.method === 'POST') {
        const sz = await validateRequestSize(request, env);
        if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
        const tsError = await checkTurnstile(request, env, ip);
        if (tsError) return tsError;
        return routePath === '/compile/async' ? handleCompileAsync(request, env) : handleCompileBatchAsync(request, env);
    }

    // Workflow routes (auth + rate-limited, lazy)
    if (routePath.startsWith('/workflow/')) {
        const { routeWorkflow } = await import('./workflow.ts');
        return routeWorkflow(routePath, request, env, authContext, analytics, ip, url);
    }

    // Health checks (lazy)
    if (routePath === '/health' && request.method === 'GET') {
        const { handleHealth } = await import('./health.ts');
        return handleHealth(env);
    }
    if (routePath === '/health/latest' && request.method === 'GET') {
        const { handleHealthLatest } = await import('./health.ts');
        return handleHealthLatest(env);
    }

    // Docs redirect to mdBook site
    if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/docs' || pathname.startsWith('/docs/'))) {
        const docsSubpath = pathname.startsWith('/docs/') ? pathname.slice('/docs'.length) : '/';
        const target = new URL(docsSubpath, DOCS_SITE_URL);
        if (url.search) target.search = url.search;
        return Response.redirect(target.toString(), 302);
    }

    // Static assets / Angular SPA (lazy)
    if (request.method === 'GET') {
        const { serveStaticAsset } = await import('./assets.ts');
        return serveStaticAsset(request, env, pathname);
    }

    return new Response('Not Found', { status: 404 });
}

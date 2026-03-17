/**
 * Cloudflare Worker for compiling hostlists.
 *
 * Thin entry-point: imports from handler/utility modules, wires Sentry,
 * and delegates requests via a lean `_handleRequest` router.
 *
 * Features:
 * - Compile filter lists from remote URLs
 * - Support for pre-fetched content
 * - Real-time progress events via Server-Sent Events
 * - JSON API for programmatic access
 */

/// <reference types="@cloudflare/workers-types" />

// Types
import type { Env, IAuthContext, QueueMessage } from './types.ts';

// Container class for Cloudflare Containers deployment.
// @deno-types="./cloudflare-containers-types.d.ts"
import { Container } from '@cloudflare/containers';

/**
 * Cloudflare Container-enabled Durable Object for the Adblock Compiler.
 */
export class AdblockCompiler extends Container {
    override defaultPort = 8787;
    /** Stop the container after 10 minutes of inactivity to reduce cost. */
    override sleepAfter = '10m';

    override onStart(): void {
        console.log('[AdblockCompiler] Container started');
    }

    override onStop(_: { exitCode: number; reason: string }): void {
        console.log('[AdblockCompiler] Container stopped');
    }

    override onError(error: unknown): void {
        console.error('[AdblockCompiler] Container error:', error instanceof Error ? error.message : String(error));
    }
}

// Middleware
import { checkRateLimitTiered, validateRequestSize } from './middleware/index.ts';
import { authenticateRequestUnified, requireAuth } from './middleware/auth.ts';
import { ClerkAuthProvider } from './middleware/clerk-auth-provider.ts';
import { LocalJwtAuthProvider } from './middleware/local-jwt-auth-provider.ts';
import { verifyTurnstileToken } from './middleware/turnstile.ts';

// Utils
import { WORKER_DEFAULTS } from '../src/config/defaults.ts';
import { AnalyticsService } from '../src/services/AnalyticsService.ts';
import { getCorsHeaders, getPublicCorsHeaders, handleCorsPreflight, isPublicEndpoint } from './utils/cors.ts';
import { JsonResponse } from './utils/response.ts';
import { generateRequestId } from './utils/index.ts';
import { createAnalyticsService } from './utils/analytics.ts';
import { createPgPool } from './utils/pg-pool.ts';
import { DOCS_SITE_URL } from './utils/constants.ts';
import { checkRoutePermission } from './utils/route-permissions.ts';
import { checkUserApiAccess } from './utils/user-access.ts';
import { trackApiUsage } from './utils/api-usage.ts';

// Handlers (eagerly imported — on the hot path)
import { handleCompileJson, handleCompileStream, handleCompileBatch, handleCompileAsync, handleCompileBatchAsync, handleASTParseRequest, handleValidate } from './handlers/compile.ts';
import { handleValidateRule } from './handlers/validate-rule.ts';
import { handleRulesCreate, handleRulesDelete, handleRulesGet, handleRulesList, handleRulesUpdate } from './handlers/rules.ts';
import { handleNotify } from './handlers/webhook.ts';
import { handleClerkWebhook } from './handlers/clerk-webhook.ts';
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey, handleUpdateApiKey } from './handlers/api-keys.ts';
import { handleLocalChangePassword, handleLocalLogin, handleLocalMe, handleLocalSignup } from './handlers/local-auth.ts';
import { handleAdminCreateLocalUser, handleAdminDeleteLocalUser, handleAdminGetLocalUser, handleAdminListLocalUsers, handleAdminUpdateLocalUser } from './handlers/admin-users.ts';
import { handleAdminAuthConfig } from './handlers/auth-config.ts';
import { handleAdminGetUserUsage } from './handlers/admin-usage.ts';
import { handlePrometheusMetrics } from './handlers/prometheus-metrics.ts';
import { handleMetrics } from './handlers/metrics.ts';
import { handleQueue } from './handlers/queue.ts';

// Services
import { createDiagnosticsProvider } from './services/diagnostics-factory.ts';
import { withSentryWorker } from './services/sentry-init.ts';

// Agent routing
import { routeAgentRequest } from './agent-routing.ts';
import { handleWebSocketUpgrade } from './websocket.ts';

// Workflows and MCP agent
import { BatchCompilationWorkflow, CacheWarmingWorkflow, CompilationWorkflow, HealthMonitoringWorkflow } from './workflows/index.ts';
import { PlaywrightMcpAgent } from './mcp-agent.ts';

// Re-export Env for compatibility with existing imports
export type { Env };

// ============================================================================
// Configuration
// ============================================================================

const RATE_LIMIT_WINDOW = WORKER_DEFAULTS.RATE_LIMIT_WINDOW_SECONDS;

// ============================================================================
// Internal helpers
// ============================================================================

/** Returns a 413 Payload Too Large JSON response. */
function payloadTooLarge(error: string): Response {
    return Response.json({ success: false, error }, { status: 413 });
}

/**
 * Verify Turnstile token from a cloned request body.
 * Returns null on success; a Response on failure.
 */
async function checkTurnstile(
    request: Request,
    env: Env,
    ip: string,
): Promise<Response | null> {
    if (!env.TURNSTILE_SECRET_KEY) return null;
    try {
        const body = await request.clone().json() as { turnstileToken?: string };
        const result = await verifyTurnstileToken(env, body.turnstileToken || '', ip);
        if (!result.success) {
            return Response.json(
                { success: false, error: result.error || 'Turnstile verification failed' },
                { status: 403, headers: {} },
            );
        }
    } catch {
        // If body parsing fails, let it through (token missing → Turnstile will reject if needed)
    }
    return null;
}

// ============================================================================
// Worker handler
// ============================================================================

interface WorkerHandler extends ExportedHandler<Env> {
    _handleRequest(
        request: Request,
        env: Env,
        url: URL,
        pathname: string,
        ctx: ExecutionContext,
    ): Promise<Response>;
}

const workerHandler: WorkerHandler = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const { pathname } = url;

        if (request.method === 'OPTIONS') {
            return handleCorsPreflight(request, env);
        }

        const corsHeaders = isPublicEndpoint(pathname) ? getPublicCorsHeaders() : getCorsHeaders(request, env);
        const diagnostics = createDiagnosticsProvider(env);
        const requestSpan = diagnostics.startSpan(`http.${request.method}`, { url: pathname });

        let response: Response;
        try {
            response = await this._handleRequest(request, env, url, pathname, ctx);
        } catch (err) {
            requestSpan.recordException(err instanceof Error ? err : new Error(String(err)));
            diagnostics.captureError(err instanceof Error ? err : new Error(String(err)), {
                url: request.url,
                method: request.method,
            });
            throw err;
        } finally {
            requestSpan.end();
            ctx.waitUntil(diagnostics.flush());
        }

        if (response.status === 101) return response;

        const newHeaders = new Headers(response.headers);
        for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
    },

    /** @internal Core request handler — called by fetch() which wraps the response with CORS headers. */
    async _handleRequest(
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

        // Pre-auth API metadata routes (lazy import)
        if (pathname.startsWith('/api') && request.method === 'GET') {
            const { routeApiMeta } = await import('./handlers/info.ts');
            const metaResponse = await routeApiMeta(pathname, request, url, env);
            if (metaResponse) return metaResponse;
        }

        // Strip /api prefix — frontend uses API_BASE_URL = '/api'
        const routePath = pathname.startsWith('/api/') ? pathname.slice(4) : pathname;

        // ── Unified Authentication ──────────────────────────────────────────
        const authProvider = env.CLERK_JWKS_URL ? new ClerkAuthProvider(env) : new LocalJwtAuthProvider(env);
        const authResult = await authenticateRequestUnified(request, env, createPgPool, authProvider);
        if (authResult.response) return authResult.response;
        const authContext: IAuthContext = authResult.context;

        // ── ZTA: Per-user API access gate ───────────────────────────────────
        const accessDenied = await checkUserApiAccess(authContext, env);
        if (accessDenied) {
            analytics.trackSecurityEvent({
                eventType: 'auth_failure', path: routePath, method: request.method,
                clientIpHash: AnalyticsService.hashIp(ip), reason: 'api_disabled',
            });
            return accessDenied;
        }
        ctx.waitUntil(trackApiUsage(authContext, routePath, request.method, env));

        // ── Local JWT auth routes (pre-Clerk bridge) ────────────────────────
        if (routePath.startsWith('/auth/')) {
            if (env.CLERK_JWKS_URL) return Response.json({ success: false, error: 'Not found' }, { status: 404 });
            if (routePath === '/auth/signup' && request.method === 'POST') return handleLocalSignup(request, env, analytics, ip);
            if (routePath === '/auth/login' && request.method === 'POST') return handleLocalLogin(request, env, analytics, ip);
            if (routePath === '/auth/me' && request.method === 'GET') return handleLocalMe(request, env, authContext);
            if (routePath === '/auth/change-password' && request.method === 'POST') return handleLocalChangePassword(request, env, authContext, analytics, ip);
        }

        // ── Admin storage (X-Admin-Key auth, lazy) ──────────────────────────
        if (routePath.startsWith('/admin/storage')) {
            const { routeAdminStorage } = await import('./handlers/admin.ts');
            return routeAdminStorage(routePath, request, env);
        }

        // ── Route permission check ──────────────────────────────────────────
        const permDenied = checkRoutePermission(routePath, authContext);
        if (permDenied) {
            analytics.trackSecurityEvent({
                eventType: 'auth_failure', path: routePath, method: request.method,
                clientIpHash: AnalyticsService.hashIp(ip), reason: 'route_permission_denied',
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
            const { routeQueue } = await import('./handlers/queue.ts');
            return routeQueue(routePath, request, env, authContext, analytics, ip);
        }

        // ── Compile / AST / Validate routes ─────────────────────────────────
        if (
            (routePath === '/compile' || routePath === '/compile/stream' || routePath === '/compile/batch') &&
            request.method === 'POST'
        ) {
            const sz = await validateRequestSize(request, env);
            if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
            const rl = await checkRateLimitTiered(env, ip, authContext);
            if (!rl.allowed) {
                analytics.trackRateLimitExceeded({
                    requestId, clientIpHash: AnalyticsService.hashIp(ip),
                    rateLimit: rl.limit, windowSeconds: RATE_LIMIT_WINDOW,
                });
                return Response.json(
                    { success: false, error: `Rate limit exceeded. Maximum ${rl.limit} requests per ${RATE_LIMIT_WINDOW} seconds.` },
                    { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)), 'X-RateLimit-Limit': String(rl.limit), 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(rl.resetAt) } },
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
            return handleASTParseRequest(request, env);
        }

        if (routePath === '/validate' && request.method === 'POST') {
            const sz = await validateRequestSize(request, env);
            if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
            return handleValidate(request);
        }

        if (routePath === '/ws/compile' && request.method === 'GET') return handleWebSocketUpgrade(request, env);

        // Validate-rule (rate limited)
        if (routePath === '/validate-rule' && request.method === 'POST') {
            const rl = await checkRateLimitTiered(env, ip, authContext);
            if (!rl.allowed) {
                analytics.trackSecurityEvent({ eventType: 'rate_limit', path: '/validate-rule', method: 'POST', clientIpHash: AnalyticsService.hashIp(ip), tier: authContext.tier, reason: 'validate_rule_rate_limit_exceeded' });
                return Response.json({ success: false, error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
            }
            const sz = await validateRequestSize(request, env);
            if (!sz.valid) return payloadTooLarge(sz.error || 'Request body too large');
            return handleValidateRule(request, env);
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
            return routePath === '/compile/async'
                ? handleCompileAsync(request, env)
                : handleCompileBatchAsync(request, env);
        }

        // Workflow routes (auth + rate-limited, lazy)
        if (routePath.startsWith('/workflow/')) {
            const { routeWorkflow } = await import('./handlers/workflow.ts');
            return routeWorkflow(routePath, request, env, authContext, analytics, ip, url);
        }

        // Health checks (lazy)
        if (routePath === '/health' && request.method === 'GET') {
            const { handleHealth } = await import('./handlers/health.ts');
            return handleHealth(env);
        }
        if (routePath === '/health/latest' && request.method === 'GET') {
            const { handleHealthLatest } = await import('./handlers/health.ts');
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
            const { serveStaticAsset } = await import('./handlers/assets.ts');
            return serveStaticAsset(request, env, pathname);
        }

        return new Response('Not Found', { status: 404 });
    },

    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
        await handleQueue(batch as MessageBatch<QueueMessage>, env);
    },

    async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
        const cronPattern = controller.cron;
        const runId = `scheduled-${Date.now()}`;
        // deno-lint-ignore no-console
        console.log(`[CRON] Scheduled event triggered: ${cronPattern} (runId: ${runId})`);
        try {
            if (cronPattern === '0 */6 * * *' && env.CACHE_WARMING_WORKFLOW) {
                const instance = await env.CACHE_WARMING_WORKFLOW.create({
                    id: `cache-warm-${runId}`,
                    params: { runId: `cron-${runId}`, configurations: [], scheduled: true },
                });
                // deno-lint-ignore no-console
                console.log(`[CRON] Started cache warming workflow: ${instance.id}`);
            } else if (cronPattern === '0 */6 * * *') {
                // deno-lint-ignore no-console
                console.warn('[CRON] CACHE_WARMING_WORKFLOW not available');
            }
            if (cronPattern === '0 * * * *' && env.HEALTH_MONITORING_WORKFLOW) {
                const instance = await env.HEALTH_MONITORING_WORKFLOW.create({
                    id: `health-check-${runId}`,
                    params: { runId: `cron-${runId}`, sources: [], alertOnFailure: true },
                });
                // deno-lint-ignore no-console
                console.log(`[CRON] Started health monitoring workflow: ${instance.id}`);
            } else if (cronPattern === '0 * * * *') {
                // deno-lint-ignore no-console
                console.warn('[CRON] HEALTH_MONITORING_WORKFLOW not available');
            }
        } catch (error) {
            // deno-lint-ignore no-console
            console.error(`[CRON] Failed to start scheduled workflow (${cronPattern}):`, error);
        }
    },
};

// Wrap with Sentry error tracking. When SENTRY_DSN is not set the original
// handler is returned unchanged — zero overhead in local development.
export default withSentryWorker(workerHandler, (env) => ({
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE ?? env.COMPILER_VERSION,
}));

// ============================================================================
// Export Workflow classes for Cloudflare Workers runtime
// ============================================================================
export { BatchCompilationWorkflow, CacheWarmingWorkflow, CompilationWorkflow, HealthMonitoringWorkflow, PlaywrightMcpAgent };

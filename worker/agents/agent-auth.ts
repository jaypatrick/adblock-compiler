/**
 * Agent Authentication Middleware
 *
 * Enforces Zero Trust authentication on all `/agents/{slug}/{instanceId}[/*]`
 * routes before forwarding the request to the Durable Object via the
 * `@cloudflare/agents` SDK.
 *
 * ## Authentication flow
 * 1. Parse `/agents/{slug}/{instanceId}` from the request URL.
 * 2. Look up the slug in `AGENT_REGISTRY` — return 404 if not found or disabled.
 * 3. Run `authenticateRequestUnified()` to resolve an `IAuthContext`.
 * 4. If anonymous, return 401 (consistent with rest of the worker).
 * 5. Call `requireTier()` — return 403 if tier is insufficient.
 * 6. If `entry.requiredScopes.length > 0`, call `requireScope()` — return 403
 *    if any required scope is missing.
 * 7. Apply tiered rate limiting keyed by resolved auth context.
 * 8. Emit a security event to Analytics Engine for every connection attempt
 *    (both successful and denied).
 * 9. On success, forward to the Durable Object via `routeAgentRequest`.
 *
 * @see worker/agents/registry.ts — AGENT_REGISTRY entries
 * @see https://developers.cloudflare.com/agents/configuration/authentication/
 */

import type { Env, IAuthContext } from '../types.ts';
import { UserTier } from '../types.ts';
import { authenticateRequestUnified, requireAuth, requireScope, requireTier } from '../middleware/auth.ts';
import { checkRateLimitTiered } from '../middleware/index.ts';
import { createPgPool } from '../utils/pg-pool.ts';
import { BetterAuthProvider } from '../middleware/better-auth-provider.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
// SecurityEventData.eventType includes 'auth_failure' | 'auth_success' | 'rate_limit' | ...
// All event types used in this file are covered by that union.
import type { SecurityEventData } from '../../src/services/AnalyticsService.ts';
import { routeAgentRequest } from '../agent-routing.ts';
import { getAgentBySlug } from './registry.ts';
import type { AgentRegistryEntry } from './registry.ts';

// ============================================================================
// Types
// ============================================================================

/** Outcome returned by the auth gate — either a denied Response or a verified context. */
type AgentAuthResult =
    | { allowed: false; response: Response }
    | { allowed: true; entry: AgentRegistryEntry; authContext: IAuthContext };

// ============================================================================
// URL parsing
// ============================================================================

/** Matches `/agents/<slug>/<instanceId>[/rest]` */
const AGENT_PATH_RE = /^\/agents\/([^/]+)\/([^/]+)(\/.*)?$/;

/**
 * Parses the agent slug and instance ID from a request URL path.
 *
 * @returns `[slug, instanceId]` if the path matches, or `null` otherwise.
 */
function parseAgentPath(pathname: string): [string, string] | null {
    const match = pathname.match(AGENT_PATH_RE);
    if (!match) return null;
    return [match[1], match[2]];
}

// ============================================================================
// Core auth logic (exported for unit-testability)
// ============================================================================

/**
 * Applies the tier, scope, and rate limit checks to an already-resolved
 * `IAuthContext` for the given registry entry.
 *
 * Exported so that unit tests can inject a mock `IAuthContext` directly
 * without needing to mock the database-backed `authenticateRequestUnified`.
 *
 * @param authContext - The resolved auth context.
 * @param entry       - The matching registry entry.
 * @param request     - Original request (used for IP extraction in rate limiting).
 * @param env         - Worker bindings.
 */
export async function applyAgentAuthChecks(
    authContext: IAuthContext,
    entry: AgentRegistryEntry,
    request: Request,
    env: Env,
): Promise<Response | null> {
    const url = new URL(request.url);

    // ── 1. Anonymous → 401 (consistent with checkRoutePermission behaviour) ────
    const authDenied = requireAuth(authContext);
    if (authDenied) {
        emitSecurityEvent(env, {
            eventType: 'auth_failure',
            path: url.pathname,
            method: request.method,
            tier: authContext.tier,
            reason: 'unauthenticated',
        });
        return authDenied;
    }

    // ── 2. Tier check ─────────────────────────────────────────────────────────
    const tierDenied = requireTier(authContext, entry.requiredTier);
    if (tierDenied) {
        emitSecurityEvent(env, {
            eventType: 'auth_failure',
            path: url.pathname,
            method: request.method,
            userId: authContext.userId ?? undefined,
            tier: authContext.tier,
            reason: `insufficient_tier: requires ${entry.requiredTier}, has ${authContext.tier}`,
        });
        return tierDenied;
    }

    // ── 3. Scope check (API key requests only) ────────────────────────────────
    if (entry.requiredScopes.length > 0) {
        const scopeDenied = requireScope(authContext, ...entry.requiredScopes);
        if (scopeDenied) {
            emitSecurityEvent(env, {
                eventType: 'auth_failure',
                path: url.pathname,
                method: request.method,
                userId: authContext.userId ?? undefined,
                tier: authContext.tier,
                reason: `missing_scopes: ${entry.requiredScopes.join(', ')}`,
            });
            return scopeDenied;
        }
    }

    // ── 4. Rate limiting (keyed by auth context — admin tier short-circuits) ──
    if (env.RATE_LIMIT) {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const rl = await checkRateLimitTiered(env, ip, authContext);
        if (!rl.allowed) {
            emitSecurityEvent(env, {
                eventType: 'rate_limit',
                path: url.pathname,
                method: request.method,
                userId: authContext.userId ?? undefined,
                tier: authContext.tier,
                reason: 'rate_limit_exceeded',
            });
            return new Response(
                JSON.stringify({ success: false, error: 'Rate limit exceeded' }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                        'X-RateLimit-Limit': String(rl.limit),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': String(rl.resetAt),
                    },
                },
            );
        }
    }

    return null; // all checks passed
}

// ============================================================================
// Auth gate
// ============================================================================

/**
 * Runs the full ZTA auth chain for an agent connection request.
 *
 * Emits an Analytics Engine security event for every attempt — successful
 * and denied — so that connection patterns can be monitored in dashboards.
 *
 * @param request - The incoming HTTP/WebSocket upgrade request.
 * @param env     - Worker bindings.
 * @returns `AgentAuthResult` — either a blocked response (allowed=false) or
 *          the verified auth context and registry entry (allowed=true).
 */
export async function runAgentAuthGate(
    request: Request,
    env: Env,
): Promise<AgentAuthResult> {
    const url = new URL(request.url);
    const parsed = parseAgentPath(url.pathname);

    if (!parsed) {
        return {
            allowed: false,
            response: new Response(
                JSON.stringify({ success: false, error: 'Not found' }),
                { status: 404, headers: { 'Content-Type': 'application/json' } },
            ),
        };
    }

    const [slug] = parsed;

    // ── 1. Registry lookup ────────────────────────────────────────────────────
    const entry = getAgentBySlug(slug);
    if (!entry) {
        emitSecurityEvent(env, {
            eventType: 'auth_failure',
            path: url.pathname,
            reason: `agent_not_found: ${slug}`,
        });
        return {
            allowed: false,
            response: new Response(
                JSON.stringify({ success: false, error: 'Agent not found' }),
                { status: 404, headers: { 'Content-Type': 'application/json' } },
            ),
        };
    }

    // ── 2. Authenticate ───────────────────────────────────────────────────────
    const authProvider = env.BETTER_AUTH_SECRET && env.HYPERDRIVE
        ? new BetterAuthProvider(env)
        : undefined;

    const { context: authContext, response: authErrorResponse } = await authenticateRequestUnified(
        request,
        env,
        env.HYPERDRIVE ? createPgPool : undefined,
        authProvider,
    );

    if (authErrorResponse) {
        emitSecurityEvent(env, {
            eventType: 'auth_failure',
            path: url.pathname,
            method: request.method,
            reason: 'auth_provider_error',
        });
        return { allowed: false, response: authErrorResponse };
    }

    // ── 3. Tier, scope, and rate limit checks ─────────────────────────────────
    const denied = await applyAgentAuthChecks(authContext, entry, request, env);
    if (denied) {
        return { allowed: false, response: denied };
    }

    // ── 4. Success ────────────────────────────────────────────────────────────
    emitSecurityEvent(env, {
        eventType: 'auth_success',
        path: url.pathname,
        method: request.method,
        userId: authContext.userId ?? undefined,
        authMethod: authContext.authMethod,
        tier: authContext.tier,
    });

    return { allowed: true, entry, authContext };
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Authenticates an agent request and, on success, forwards it to the
 * appropriate Durable Object via `routeAgentRequest`.
 *
 * Returns `null` if the request path does not match `/agents/*`, so the caller
 * can fall through to other handlers.
 *
 * @param request - The incoming request (HTTP or WebSocket upgrade).
 * @param env     - Worker environment bindings.
 * @returns A Response (possibly a 4xx/429 error), or `null` if path doesn't match.
 */
export async function handleAgentRequest(
    request: Request,
    env: Env,
): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/agents/')) return null;

    const result = await runAgentAuthGate(request, env);

    if (!result.allowed) {
        return result.response;
    }

    // Auth passed — forward to the Durable Object via the SDK/shim
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    // The slug exists in the registry but the DO binding returned null
    // (e.g. binding absent in env). This is a misconfiguration.
    return new Response(
        JSON.stringify({ success: false, error: 'Agent binding unavailable' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Emits a security event to Analytics Engine if the binding is available. */
function emitSecurityEvent(env: Env, data: SecurityEventData): void {
    if (!env.ANALYTICS_ENGINE) return;
    new AnalyticsService(env.ANALYTICS_ENGINE).trackSecurityEvent(data);
}

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
 * 4. Call `requireTier()` — return 403 if tier is insufficient.
 * 5. If `entry.requiredScopes.length > 0`, call `requireScope()` — return 403
 *    if any required scope is missing.
 * 6. Emit a security event to Analytics Engine for every connection attempt
 *    (both successful and denied).
 * 7. On success, forward to the Durable Object via `routeAgentRequest`.
 *
 * @see worker/agents/registry.ts — AGENT_REGISTRY entries
 * @see https://developers.cloudflare.com/agents/configuration/authentication/
 */

import type { Env, IAuthContext } from '../types.ts';
import { authenticateRequestUnified, requireScope, requireTier } from '../middleware/auth.ts';
import { createPgPool } from '../utils/pg-pool.ts';
import { BetterAuthProvider } from '../middleware/better-auth-provider.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
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

    // ── 3. Tier check ─────────────────────────────────────────────────────────
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
        return { allowed: false, response: tierDenied };
    }

    // ── 4. Scope check (API key requests only) ────────────────────────────────
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
            return { allowed: false, response: scopeDenied };
        }
    }

    // ── 5. Success ────────────────────────────────────────────────────────────
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
 * @returns A Response (possibly a 4xx error), or `null` if path doesn't match.
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
function emitSecurityEvent(
    env: Env,
    data: {
        eventType: 'auth_failure' | 'auth_success';
        path?: string;
        method?: string;
        userId?: string;
        authMethod?: string;
        tier?: string;
        reason?: string;
    },
): void {
    if (!env.ANALYTICS_ENGINE) return;
    new AnalyticsService(env.ANALYTICS_ENGINE).trackSecurityEvent(data);
}

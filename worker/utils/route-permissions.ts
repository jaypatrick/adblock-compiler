/**
 * Route Permission Registry
 *
 * Single source of truth for per-endpoint access requirements.
 * Every protected endpoint in this Worker has an entry here.
 *
 * ## How to add a new protected endpoint
 * Add one entry to ROUTE_PERMISSION_REGISTRY:
 * ```typescript
 * ['/new/endpoint', { minTier: UserTier.Free, description: 'My new endpoint' }],
 * ```
 *
 * ## Pattern format
 * - Exact:  `'/auth/me'`   — matches only `/auth/me`
 * - Prefix: `'/admin/*'`   — matches `/admin/` and any sub-path
 *
 * ## Match priority
 * Exact matches take precedence. Among prefix matches, the longest prefix wins.
 *
 * ## Tier access model
 * - `minTier: UserTier.Anonymous` → public (no auth needed)
 * - `minTier: UserTier.Free`      → any authenticated user
 * - `minTier: UserTier.Pro`       → paid/upgraded tier
 * - `minTier: UserTier.Admin`     → administrators only
 *
 * @see worker/types.ts — UserTier enum and TIER_REGISTRY
 * @see worker/agents/registry.ts — AGENT_REGISTRY (agent routes added dynamically below)
 */

import { type IAuthContext, isTierSufficient, TIER_REGISTRY, UserTier } from '../types.ts';
import { AGENT_REGISTRY } from '../agents/registry.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Access requirement for a single route.
 *
 * A tier + optional role guard that can be configured centrally
 * and applied at the routing layer.
 */
export interface IRoutePermission {
    /**
     * Minimum tier required.
     * - `Anonymous` — public, no auth needed
     * - `Free`      — any authenticated user
     * - `Pro`       — paid/upgraded tier
     * - `Admin`     — administrators only
     */
    readonly minTier: UserTier;
    /**
     * Optional role guard. When set, the authenticated user's role must
     * match this value in addition to the tier check.
     * @example `'admin'` — only users with role === 'admin' may access
     */
    readonly requiredRole?: string;
    /** Human-readable description — used in docs and future OpenAPI generation. */
    readonly description: string;
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Per-route permission registry.
 *
 * ## Access tiers at a glance
 * | Who              | Tier      | Can do                                  |
 * |------------------|-----------|-----------------------------------------|
 * | Unauthenticated  | Anonymous | Read-only public endpoints              |
 * | Signed-in user   | Free      | All standard API features               |
 * | Upgraded user    | Pro       | Higher rate limits + async endpoints    |
 * | Administrator    | Admin     | Admin panel + user management           |
 */
export const ROUTE_PERMISSION_REGISTRY = new Map<string, IRoutePermission>([
    // ── Fully public (Anonymous — no JWT required) ─────────────────────────────
    // Config/bootstrap endpoints the Angular SPA needs before auth loads.
    // Health and auth entry-points are intentionally public.
    ['/health', { minTier: UserTier.Anonymous, description: 'Health check' }],
    ['/health/*', { minTier: UserTier.Anonymous, description: 'Health sub-endpoints' }],
    ['/container/status', { minTier: UserTier.Anonymous, description: 'Container lifecycle status (public probe)' }],
    ['/metrics', { minTier: UserTier.Anonymous, description: 'Public aggregate metrics' }],
    // Webhook receivers use self-authentication (HMAC/signatures)
    ['/webhooks/*', { minTier: UserTier.Anonymous, description: 'Webhook receivers (self-authenticated)' }],
    // API documentation — publicly readable
    ['/docs', { minTier: UserTier.Anonymous, description: 'API documentation' }],
    ['/docs/*', { minTier: UserTier.Anonymous, description: 'API documentation pages' }],

    // ── Free tier (any authenticated user) ────────────────────────────────────
    // Compile / transform
    ['/compile', { minTier: UserTier.Free, description: 'Compile filter lists' }],
    ['/compile/stream', { minTier: UserTier.Free, description: 'Streaming compile' }],
    ['/compile/batch', { minTier: UserTier.Free, description: 'Batch compile' }],
    ['/compile/container', { minTier: UserTier.Free, description: 'Container-proxied compile' }],
    ['/ast/parse', { minTier: UserTier.Free, description: 'Parse rules to AST' }],
    ['/validate', { minTier: UserTier.Free, description: 'Validate filter rules' }],
    ['/validate-rule', { minTier: UserTier.Free, description: 'Validate single rule' }],
    ['/ws/compile', { minTier: UserTier.Free, description: 'WebSocket compile (Free+)' }],
    // API keys (user-owned)
    ['/keys', { minTier: UserTier.Free, description: 'API key management' }],
    ['/keys/*', { minTier: UserTier.Free, description: 'API key operations' }],
    // Custom rules
    ['/rules', { minTier: UserTier.Free, description: 'Custom rule management' }],
    ['/rules/*', { minTier: UserTier.Free, description: 'Custom rule operations' }],
    // Queue (read/write)
    ['/queue/stats', { minTier: UserTier.Free, description: 'Queue statistics' }],
    ['/queue/history', { minTier: UserTier.Free, description: 'Queue job history' }],
    ['/queue/results/*', { minTier: UserTier.Free, description: 'Retrieve async job results' }],
    ['/queue/cancel/*', { minTier: UserTier.Free, description: 'Cancel queued job' }],
    // Notifications & logging
    ['/notify', { minTier: UserTier.Free, description: 'Send notification' }],
    ['/log', { minTier: UserTier.Free, description: 'Client-side log ingestion' }],
    // URL proxy (SSRF-protected inside handler)
    ['/proxy/*', { minTier: UserTier.Free, description: 'SSRF-protected URL proxy' }],

    // ── Pro tier (paid / upgraded) ─────────────────────────────────────────────
    ['/compile/async', { minTier: UserTier.Pro, description: 'Async compilation (Pro+)' }],
    ['/compile/batch/async', { minTier: UserTier.Pro, description: 'Async batch compilation (Pro+)' }],
    ['/workflow/*', { minTier: UserTier.Pro, description: 'Workflow execution (Pro+)' }],

    // ── Configuration management (read/validate/resolve) ─────────────────────
    ['/configuration/defaults', { minTier: UserTier.Anonymous, description: 'System defaults and hard limits' }],
    ['/configuration/validate', { minTier: UserTier.Free, description: 'Validate a configuration object' }],
    ['/configuration/resolve', { minTier: UserTier.Free, description: 'Merge config layers and return effective IConfiguration' }],

    // ── Admin tier (Admin role required) ──────────────────────────────────────
    // Wildcard catch-all for all /admin/* sub-paths (longest-prefix wins for specifics)
    ['/admin/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Admin operations (catch-all)' }],
    // Explicit entries (same tier — kept for documentation clarity)
    ['/admin/auth/config', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Auth configuration inspector' }],
    ['/admin/users', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'List users' }],
    ['/admin/users/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'User management (update tier/role, ban/unban)' }],
    ['/admin/usage/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Per-user API usage statistics' }],
    ['/admin/storage', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Storage admin panel' }],
    ['/admin/storage/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Storage admin operations' }],
    ['/admin/auth/api-keys', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Admin API key management' }],
    ['/admin/auth/api-keys/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Admin API key operations' }],
    ['/admin/neon/project', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Neon project overview' }],
    ['/admin/neon/branches', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'List Neon branches' }],
    ['/admin/neon/branches/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Neon branch operations (get/create/delete)' }],
    ['/admin/neon/endpoints', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'List Neon compute endpoints' }],
    ['/admin/neon/databases/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'List databases for a Neon branch' }],
    ['/admin/neon/query', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Execute SQL via Neon serverless driver' }],
    ['/admin/agents/sessions', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'List agent sessions' }],
    ['/admin/agents/sessions/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Agent session detail / termination' }],
    ['/admin/agents/audit', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Agent audit log' }],
    ['/metrics/prometheus', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Prometheus metrics scrape' }],

    // ── Agent routes — derived from AGENT_REGISTRY ────────────────────────────
    // Each enabled agent gets a wildcard entry so the permission checker knows
    // these endpoints require admin tier.  The agent router (worker/agents/
    // agent-router.ts) enforces auth independently before the DO is invoked;
    // this entry ensures the main permission middleware also blocks non-admins
    // even if a request somehow bypasses the agent router.
    ...AGENT_REGISTRY
        .filter((entry) => entry.enabled)
        .map((entry) => [
            `/agents/${entry.slug}/*`,
            { minTier: entry.requiredTier, description: entry.displayName },
        ] as [string, IRoutePermission]),
]);

// ============================================================================
// Resolver
// ============================================================================

/**
 * Resolve the permission requirement for a given route path.
 *
 * Exact matches take priority over prefix matches.
 * Among prefix matches, the longest matching prefix wins.
 *
 * @returns The matching permission, or `null` if no restriction is defined.
 */
export function resolveRoutePermission(routePath: string): IRoutePermission | null {
    // 1. Exact match
    const exact = ROUTE_PERMISSION_REGISTRY.get(routePath);
    if (exact) return exact;

    // 2. Longest-prefix match (pattern ends with '/*')
    let best: IRoutePermission | null = null;
    let bestLen = 0;

    for (const [pattern, permission] of ROUTE_PERMISSION_REGISTRY) {
        if (!pattern.endsWith('/*')) continue;
        const prefix = pattern.slice(0, -2); // strip '/*'
        if (
            prefix.length > bestLen &&
            (routePath === prefix || routePath.startsWith(prefix + '/'))
        ) {
            best = permission;
            bestLen = prefix.length;
        }
    }

    return best;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Check whether the authenticated context satisfies the permission requirement
 * for the given route.
 *
 * Returns `null` if access is allowed, or a ready-to-return `Response` (401 or
 * 403) if access is denied.
 *
 * Usage in a handler or at the routing layer:
 * ```typescript
 * const denied = checkRoutePermission(routePath, authContext);
 * if (denied) return denied;
 * ```
 *
 * Usage in worker.ts (applied globally after unified auth):
 * ```typescript
 * const permDenied = checkRoutePermission(routePath, authContext);
 * if (permDenied) return permDenied;
 * ```
 */
export function checkRoutePermission(
    routePath: string,
    authContext: IAuthContext,
): Response | null {
    const permission = resolveRoutePermission(routePath);

    // Route not explicitly registered → default to Free tier (ZTA: deny-by-default).
    // Public platform endpoints (/version, /deployments, /turnstile-config,
    // /sentry-config, /favicon.ico, /assets/*) are handled before auth runs in worker.ts
    // via early-return routing and never reach this permission check.
    if (!permission) {
        if (!isTierSufficient(authContext.tier, UserTier.Free)) {
            return new Response(
                JSON.stringify({ success: false, error: 'Authentication required' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } },
            );
        }
        return null;
    }

    // Explicitly public endpoint — allow without auth
    if (permission.minTier === UserTier.Anonymous) return null;

    // ── Tier check ──────────────────────────────────────────────────────────
    if (!isTierSufficient(authContext.tier, permission.minTier)) {
        const isAnon = authContext.tier === UserTier.Anonymous;
        const required = TIER_REGISTRY[permission.minTier].displayName;
        const actual = TIER_REGISTRY[authContext.tier].displayName;
        return new Response(
            JSON.stringify({
                success: false,
                error: isAnon ? 'Authentication required' : `Insufficient tier: requires ${required}, current tier is ${actual}`,
            }),
            { status: isAnon ? 401 : 403, headers: { 'Content-Type': 'application/json' } },
        );
    }

    // ── Role check (optional) ───────────────────────────────────────────────
    if (permission.requiredRole && authContext.role !== permission.requiredRole) {
        return new Response(
            JSON.stringify({ success: false, error: 'Insufficient role' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
    }

    return null;
}

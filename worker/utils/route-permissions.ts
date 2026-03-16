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
 * ## Clerk migration
 * Each entry maps directly to a Clerk "Permission" attached to a role:
 * - `minTier: UserTier.Anonymous` → public (no Clerk permission needed)
 * - `minTier: UserTier.Free`      → assign to Clerk `org:member` role
 * - `minTier: UserTier.Pro`       → assign to Clerk `org:pro` role
 * - `minTier: UserTier.Admin`     → assign to Clerk `org:admin` role
 *
 * When switching to Clerk, configure these same requirements in the Clerk
 * dashboard under "Roles & Permissions" — no code changes needed here.
 *
 * @see worker/utils/local-auth-roles.ts — role → tier mapping
 * @see worker/types.ts                  — UserTier enum and TIER_REGISTRY
 */

import { type IAuthContext, isTierSufficient, TIER_REGISTRY, UserTier } from '../types.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Access requirement for a single route.
 *
 * Mirrors Clerk's "Permission" concept — a tier + optional role guard that can
 * be configured centrally and applied at the routing layer.
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
     *
     * Mirrors Clerk's per-permission role assignment.
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
    // ── Admin endpoints (Admin tier + admin role) ──────────────────────────────
    ['/admin/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'All admin operations' }],
    ['/admin/auth/config', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Auth configuration inspector (roles, tiers, routes)' }],
    ['/admin/local-users', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'List local auth users' }],
    ['/admin/local-users/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Local user management (update tier/role)' }],
    ['/admin/usage/*', { minTier: UserTier.Admin, requiredRole: 'admin', description: 'Per-user API usage statistics' }],

    // ── Pro tier endpoints ─────────────────────────────────────────────────────
    ['/compile/async', { minTier: UserTier.Pro, description: 'Async compilation (Pro+)' }],
    ['/compile/batch/async', { minTier: UserTier.Pro, description: 'Async batch compilation (Pro+)' }],
    ['/workflow/*', { minTier: UserTier.Pro, description: 'Workflow execution (Pro+)' }],

    // ── Authenticated endpoints (Free tier minimum) ────────────────────────────
    ['/auth/me', { minTier: UserTier.Free, description: 'Current user profile' }],
    ['/auth/change-password', { minTier: UserTier.Free, description: 'Update password' }],
    ['/keys', { minTier: UserTier.Free, description: 'API key management' }],
    ['/keys/*', { minTier: UserTier.Free, description: 'API key management' }],
    ['/rules', { minTier: UserTier.Free, description: 'Custom rule management' }],
    ['/rules/*', { minTier: UserTier.Free, description: 'Custom rule management' }],

    // ── Public endpoints (Anonymous OK — rate-limited) ─────────────────────────
    // Listed for documentation; no auth check is enforced for these.
    ['/compile', { minTier: UserTier.Anonymous, description: 'Compile filter lists' }],
    ['/compile/stream', { minTier: UserTier.Anonymous, description: 'Streaming compile' }],
    ['/compile/batch', { minTier: UserTier.Anonymous, description: 'Batch compile' }],
    ['/validate', { minTier: UserTier.Anonymous, description: 'Validate rules' }],
    ['/validate-rule', { minTier: UserTier.Anonymous, description: 'Validate single rule' }],
    ['/ast/parse', { minTier: UserTier.Anonymous, description: 'Parse rules to AST' }],
    ['/auth/signup', { minTier: UserTier.Anonymous, description: 'Register new account' }],
    ['/auth/login', { minTier: UserTier.Anonymous, description: 'Authenticate' }],
    ['/health', { minTier: UserTier.Anonymous, description: 'Health check' }],
    ['/metrics', { minTier: UserTier.Anonymous, description: 'Public metrics' }],
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

    // No entry or public endpoint — allow
    if (!permission || permission.minTier === UserTier.Anonymous) return null;

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

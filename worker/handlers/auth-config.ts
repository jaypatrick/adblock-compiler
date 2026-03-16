/**
 * Auth Configuration Inspector — GET /admin/auth/config
 *
 * Returns a read-only view of all three extensibility registries at runtime:
 *   - LOCAL_ROLE_REGISTRY  — all defined roles, their tiers, and self-register flag
 *   - TIER_REGISTRY        — all tiers with rate limits and ordering
 *   - ROUTE_PERMISSION_REGISTRY — all registered route permissions
 *
 * This endpoint is the operational counterpart of the static config files.
 * Operators can verify the active configuration without reading source code.
 *
 * Admin tier + admin role required (via checkRoutePermission).
 *
 * ## Clerk migration note
 * When switching to Clerk, this endpoint can be adapted to call the Clerk
 * Backend API for roles/permissions rather than reading local registries.
 */

import { type Env, type IAuthContext, TIER_REGISTRY } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { LOCAL_ROLE_REGISTRY, VALID_LOCAL_ROLES } from '../utils/local-auth-roles.ts';
import { checkRoutePermission, ROUTE_PERMISSION_REGISTRY } from '../utils/route-permissions.ts';

export async function handleAdminAuthConfig(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/auth/config', authContext);
    if (denied) return denied;

    // Serialize LOCAL_ROLE_REGISTRY
    const roles = VALID_LOCAL_ROLES.map((role) => ({
        role,
        ...LOCAL_ROLE_REGISTRY[role],
        // Replace UserTier enum value (already a string) for clarity
        tier: LOCAL_ROLE_REGISTRY[role].tier,
    }));

    // Serialize TIER_REGISTRY
    const tiers = Object.entries(TIER_REGISTRY).map(([tier, config]) => ({
        tier,
        displayName: config.displayName,
        order: config.order,
        rateLimit: config.rateLimit === Infinity ? null : config.rateLimit,
        description: config.description,
    })).sort((a, b) => a.order - b.order);

    // Serialize ROUTE_PERMISSION_REGISTRY
    const routes = Array.from(ROUTE_PERMISSION_REGISTRY.entries()).map(([pattern, perm]) => ({
        pattern,
        minTier: perm.minTier,
        requiredRole: perm.requiredRole ?? null,
        description: perm.description,
    }));

    return JsonResponse.success({
        provider: env.CLERK_JWKS_URL ? 'clerk' : 'local-jwt',
        roles,
        tiers,
        routes,
    });
}

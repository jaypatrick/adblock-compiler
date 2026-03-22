/**
 * Auth Configuration Inspector — GET /admin/auth/config
 *
 * Returns a read-only view of auth configuration at runtime:
 *   - Active auth provider (better-auth)
 *   - TIER_REGISTRY — all tiers with rate limits and ordering
 *   - ROUTE_PERMISSION_REGISTRY — all registered route permissions
 *
 * This endpoint is the operational counterpart of the static config files.
 * Operators can verify the active configuration without reading source code.
 *
 * Admin tier + admin role required (via checkRoutePermission).
 */

import { type Env, type IAuthContext, TIER_REGISTRY } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { checkRoutePermission, ROUTE_PERMISSION_REGISTRY } from '../utils/route-permissions.ts';

export async function handleAdminAuthConfig(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/auth/config', authContext);
    if (denied) return denied;

    // Determine active provider
    const provider = 'better-auth';

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
        provider,
        tiers,
        routes,
    });
}

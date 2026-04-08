/**
 * Auth Configuration Inspector — GET /admin/auth/config
 *
 * Returns a read-only view of auth configuration at runtime:
 *   - Active auth provider (better-auth)
 *   - Social provider credential presence (github, google)
 *   - MFA plugin status
 *   - Session duration settings
 *   - Better Auth secret / base URL status
 *   - TIER_REGISTRY — all tiers with rate limits and ordering
 *   - ROUTE_PERMISSION_REGISTRY — all registered route permissions
 *
 * This endpoint is the operational counterpart of the static config files.
 * Operators can verify the active configuration without reading source code.
 *
 * Admin tier + admin role required (via checkRoutePermission).
 */

import type { AppContext } from '../routes/shared.ts';
import { TIER_REGISTRY } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { checkRoutePermission, ROUTE_PERMISSION_REGISTRY } from '../utils/route-permissions.ts';
import { AUTH_SESSION_CONFIG } from '../lib/auth.ts';

export async function handleAdminAuthConfig(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/auth/config', c.get('authContext'));
    if (denied) return denied;

    // Always Better Auth — Clerk has been removed
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
        socialProviders: {
            github: { configured: Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET) },
            google: { configured: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) },
        },
        mfa: {
            enabled: true,
        },
        session: {
            expiresIn: AUTH_SESSION_CONFIG.expiresIn,
            updateAge: AUTH_SESSION_CONFIG.updateAge,
            cookieCacheMaxAge: AUTH_SESSION_CONFIG.cookieCacheMaxAge,
        },
        betterAuth: {
            secretConfigured: Boolean(c.env.BETTER_AUTH_SECRET),
            baseUrl: c.env.BETTER_AUTH_URL ?? null,
        },
        tiers,
        routes,
    });
}

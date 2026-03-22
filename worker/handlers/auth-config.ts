/**
 * Auth Configuration Inspector — GET /admin/auth/config
 *
 * Returns a read-only view of auth configuration at runtime:
 *   - Active auth provider (clerk or better-auth)
 *   - Social provider status (GitHub, Google) — boolean presence only, never exposing secrets
 *   - MFA / 2FA status
 *   - Session configuration (expiresIn, updateAge, cookieCacheMaxAge)
 *   - Better Auth runtime status
 *   - Clerk status (enabled / disabled)
 *   - TIER_REGISTRY — all tiers with rate limits and ordering
 *   - ROUTE_PERMISSION_REGISTRY — all registered route permissions
 *
 * This endpoint is the operational counterpart of the static config files.
 * Operators can verify the active configuration without reading source code.
 *
 * Admin tier + admin role required (via checkRoutePermission).
 *
 * ⚠️ Security: Only boolean presence flags are returned for secrets.
 *    Actual credential values are never included in the response.
 */

import { type Env, type IAuthContext, TIER_REGISTRY } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { checkRoutePermission, ROUTE_PERMISSION_REGISTRY } from '../utils/route-permissions.ts';

// Session constants — mirrored from worker/lib/auth.ts for display purposes.
const SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;       // 7 days in seconds
const SESSION_UPDATE_AGE = 60 * 60 * 24;             // 1 day in seconds
const SESSION_COOKIE_CACHE_MAX_AGE = 60 * 5;         // 5 minutes in seconds

export async function handleAdminAuthConfig(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/auth/config', authContext);
    if (denied) return denied;

    // Determine active provider.
    // Clerk is currently DISABLED — CLERK_JWKS_URL is not set in wrangler.toml.
    // To re-enable Clerk: set the CLERK_JWKS_URL and CLERK_PUBLISHABLE_KEY env vars.
    const provider = env.CLERK_JWKS_URL ? 'clerk' : 'better-auth';

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
            github: { configured: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) },
            google: { configured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) },
        },
        mfa: {
            // twoFactor() plugin is always active after the Better Auth migration PR.
            enabled: true,
        },
        session: {
            expiresIn: SESSION_EXPIRES_IN,
            updateAge: SESSION_UPDATE_AGE,
            cookieCacheMaxAge: SESSION_COOKIE_CACHE_MAX_AGE,
        },
        betterAuth: {
            secretConfigured: Boolean(env.BETTER_AUTH_SECRET),
            baseUrl: env.BETTER_AUTH_URL ?? null,
        },
        clerk: {
            // Clerk is currently DISABLED. Set CLERK_JWKS_URL to re-enable.
            enabled: Boolean(env.CLERK_JWKS_URL),
            publishableKeyConfigured: Boolean(env.CLERK_PUBLISHABLE_KEY),
        },
        tiers,
        routes,
    });
}

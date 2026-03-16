/**
 * Per-User API Access Control
 *
 * Checks whether an authenticated user has API access enabled.
 * Returns null if access is allowed, or a 403 Response if api_disabled.
 *
 * ZTA compliance: every authenticated request passes this check before routing.
 * Anonymous users are allowed through (rate-limited separately).
 *
 * Extensibility: additional per-user access conditions can be added here
 * (e.g. email_verified flag, subscription_active flag) following the same
 * D1 query + Response pattern.
 */

import type { Env, IAuthContext } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';

/**
 * Check if the authenticated user has API access enabled.
 *
 * Returns null if:
 *   - The user is anonymous (no userId — rate limiting handles anonymous)
 *   - The user's api_disabled flag is 0 (access enabled)
 *   - DB is not configured (fail-open to avoid breaking non-D1 deployments)
 *
 * Returns a 403 Response if api_disabled = 1.
 */
export async function checkUserApiAccess(
    authContext: IAuthContext,
    env: Env,
): Promise<Response | null> {
    // Anonymous users pass through — rate limiting handles abuse
    if (!authContext.userId) return null;
    if (!env.DB) return null;

    try {
        const row = await env.DB
            .prepare('SELECT api_disabled FROM local_auth_users WHERE id = ? LIMIT 1')
            .bind(authContext.userId)
            .first<{ api_disabled: number }>();

        if (row?.api_disabled === 1) {
            return JsonResponse.error('API access has been disabled for this account', 403);
        }
        return null;
    } catch {
        // Fail-open: don't block requests on DB errors
        return null;
    }
}

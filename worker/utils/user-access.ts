/**
 * Per-User API Access Control
 *
 * Checks whether an authenticated local-jwt user has API access enabled.
 * Returns null if access is allowed, or a 403 Response if api_disabled.
 *
 * ZTA compliance: every authenticated local-jwt request passes this check before routing.
 * Anonymous users and Clerk/API-key users are allowed through (checked by their own auth path).
 *
 * Extensibility: additional per-user access conditions can be added here
 * (e.g. email_verified flag, subscription_active flag) following the same
 * D1 query + Response pattern.
 */

import type { Env, IAuthContext } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';

/**
 * Check if the authenticated local-jwt user has API access enabled.
 *
 * Returns null if:
 *   - The user is not authenticated via local-jwt (Clerk/api-key/anonymous: their own path)
 *   - The user's api_disabled flag is 0 (access enabled)
 *   - DB is not configured (fail-open to avoid breaking non-D1 deployments)
 *
 * Returns a 403 Response if api_disabled = 1.
 *
 * On DB errors: fails open but logs a warning (avoids outage while surfacing the problem).
 */
export async function checkUserApiAccess(
    authContext: IAuthContext,
    env: Env,
): Promise<Response | null> {
    // Only enforced for local-jwt users; Clerk and API-key users have their own access controls
    if (authContext.authMethod !== 'local-jwt') return null;
    // No userId on local-jwt means token is malformed — let auth pipeline reject it
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
    } catch (err) {
        // Fail-open: don't block requests on DB errors, but log for operator visibility
        // deno-lint-ignore no-console
        console.warn('[user-access] api_disabled check failed (fail-open):', err instanceof Error ? err.message : String(err));
        return null;
    }
}

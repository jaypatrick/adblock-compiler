/**
 * Per-User API Access Control
 *
 * Checks whether an authenticated Better Auth user has been banned.
 * Returns null if access is allowed, or a 403 Response if banned.
 *
 * ZTA compliance: every authenticated better-auth request passes this check before routing.
 * Anonymous users and API-key users are allowed through (checked by their own auth path).
 */

import type { Env, IAuthContext } from '../types.ts';
import type { PrismaClientExtended } from '../lib/prisma.ts';
import { JsonResponse } from '../utils/response.ts';

/**
 * Check if the authenticated Better Auth user has been banned.
 *
 * Returns null if:
 *   - The user is not authenticated via better-auth (api-key/anonymous: their own path)
 *   - The user is not banned
 *   - Prisma is not configured (fail-open to avoid breaking non-Hyperdrive deployments)
 *
 * Returns a 403 Response if the user is banned.
 *
 * On DB errors: fails open but logs a warning (avoids outage while surfacing the problem).
 */
export async function checkUserApiAccess(
    authContext: IAuthContext,
    _env: Env,
    prisma?: PrismaClientExtended | null,
): Promise<Response | null> {
    // Only enforced for better-auth users; API-key and anonymous users have their own access controls
    if (authContext.authMethod !== 'better-auth') return null;
    // No userId means token is malformed — let auth pipeline reject it
    if (!authContext.userId) return null;
    // Fail-open when prisma is not configured
    if (!prisma) return null;

    try {
        const row = await prisma.user.findUnique({
            where: { id: authContext.userId },
            select: { banned: true, banReason: true },
        });

        if (row?.banned) {
            const message = row.banReason ? `Account has been suspended: ${row.banReason}` : 'Account has been suspended';
            return JsonResponse.error(message, 403);
        }
        return null;
    } catch (err) {
        // Fail-open: don't block requests on DB errors, but log for operator visibility
        // deno-lint-ignore no-console
        console.warn('[user-access] banned check failed (fail-open):', err instanceof Error ? err.message : String(err));
        return null;
    }
}

/**
 * Admin API Usage Query Handler — GET /admin/usage/:userId
 *
 * Returns per-user API usage statistics from KV storage.
 * Admin tier + admin role required (enforced via checkRoutePermission).
 *
 * Response shape:
 * {
 *   userId: string,
 *   total: { count, firstSeen, lastSeen } | null,
 *   days: [{ date, count, routes }],
 *   lookbackDays: number
 * }
 */
import type { Env, IAuthContext } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';
import { getUserApiUsage } from '../utils/api-usage.ts';

export async function handleAdminGetUserUsage(
    request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission(`/admin/usage/${userId}`, authContext);
    if (denied) return denied;

    const url = new URL(request.url);
    const lookbackDays = Math.min(
        Math.max(parseInt(url.searchParams.get('days') ?? '30', 10), 1),
        90,
    );

    const usage = await getUserApiUsage(userId, env, lookbackDays);

    return JsonResponse.success({
        userId,
        ...usage,
        lookbackDays,
    });
}

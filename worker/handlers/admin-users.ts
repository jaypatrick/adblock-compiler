/**
 * Admin User Management Handlers (Better Auth)
 *
 * Endpoints for managing Better Auth users. Admin role + Admin tier required.
 *
 *   GET    /admin/users          — list all users (paginated, filterable)
 *   GET    /admin/users/:id      — get a single user
 *   PATCH  /admin/users/:id      — update a user's tier and/or role
 *   DELETE /admin/users/:id      — delete a user and their sessions
 *   POST   /admin/users/:id/ban  — ban a user
 *   POST   /admin/users/:id/unban — unban a user
 *
 * ZTA compliance:
 *   - checkRoutePermission() applied on every handler — Admin tier + role required
 *   - All D1 queries use parameterised raw D1 calls (.prepare().bind())
 *   - Responses never include password-related fields
 *   - Rate limiting applied via the auth tier (Admin = unlimited)
 *
 * @see worker/middleware/better-auth-provider.ts — Better Auth provider
 * @see worker/lib/auth.ts — Better Auth factory
 */

import { type Env, type IAuthContext, UserTier } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { AdminBanUserSchema, AdminPaginationQuerySchema, AdminUpdateUserSchema, BetterAuthUserPublicSchema, type BetterAuthUserRow } from '../schemas.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';

/** Map a raw D1 user row to its public shape (strips sensitive fields). */
function toPublicUser(u: BetterAuthUserRow) {
    return BetterAuthUserPublicSchema.parse(u);
}

// ============================================================================
// GET /admin/users
// ============================================================================

/**
 * List all Better Auth users.
 * Paginated via `?limit=` and `?offset=` query params.
 * Filterable via `?tier=`, `?role=`, `?search=` (email/name substring).
 */
export async function handleAdminListUsers(
    request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/users', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    const url = new URL(request.url);
    const paginationParsed = AdminPaginationQuerySchema.safeParse({
        limit: url.searchParams.get('limit') ?? undefined,
        offset: url.searchParams.get('offset') ?? undefined,
    });
    if (!paginationParsed.success) {
        return JsonResponse.badRequest(paginationParsed.error.issues[0]?.message ?? 'Invalid pagination params');
    }
    const { limit, offset: skip } = paginationParsed.data;

    // Optional filters
    const tierFilter = url.searchParams.get('tier');
    const roleFilter = url.searchParams.get('role');
    const search = url.searchParams.get('search');

    try {
        const conditions: string[] = [];
        const binds: (string | number)[] = [];

        if (tierFilter) {
            conditions.push('tier = ?');
            binds.push(tierFilter);
        }
        if (roleFilter) {
            conditions.push('role = ?');
            binds.push(roleFilter);
        }
        if (search) {
            conditions.push('(email LIKE ? OR name LIKE ?)');
            binds.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [listResult, countResult] = await Promise.all([
            env.DB
                .prepare(
                    `SELECT id, email, name, emailVerified, image, tier, role, banned, banReason, banExpires, createdAt, updatedAt FROM "user" ${whereClause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
                )
                .bind(...binds, limit, skip)
                .all<BetterAuthUserRow>(),
            env.DB
                .prepare(`SELECT COUNT(*) AS total FROM "user" ${whereClause}`)
                .bind(...binds)
                .first<{ total: number }>(),
        ]);

        const parseErrors: { row: unknown; issues: unknown }[] = [];
        const users = listResult.results
            .map((u) => {
                const r = BetterAuthUserPublicSchema.safeParse(u);
                if (!r.success) {
                    // deno-lint-ignore no-console
                    console.error('[admin/users] Row parse failure — schema/DB drift detected. Row id:', (u as Record<string, unknown>).id, 'Issues:', r.error.issues);
                    parseErrors.push({ row: u, issues: r.error.issues });
                    return null;
                }
                return r.data;
            })
            .filter((u): u is NonNullable<typeof u> => u !== null);

        if (parseErrors.length > 0) {
            return JsonResponse.serverError(
                `User data is malformed: ${parseErrors.length} row(s) failed schema validation. Check server logs for details.`,
            );
        }

        const total = countResult?.total ?? 0;

        return JsonResponse.success({ users, total, limit, offset: skip });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/users] List error:', message);
        return JsonResponse.serverError('Failed to list users');
    }
}

// ============================================================================
// GET /admin/users/:id
// ============================================================================

/** Get a single Better Auth user by ID. */
export async function handleAdminGetUser(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    try {
        const user = await env.DB
            .prepare('SELECT id, email, name, emailVerified, image, tier, role, banned, banReason, banExpires, createdAt, updatedAt FROM "user" WHERE id = ?')
            .bind(userId)
            .first<BetterAuthUserRow>();

        if (!user) return JsonResponse.notFound('User not found');

        return JsonResponse.success({ user: toPublicUser(user) });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/users] Get error:', message);
        return JsonResponse.serverError('Failed to fetch user');
    }
}

// ============================================================================
// PATCH /admin/users/:id
// ============================================================================

/**
 * Update a user's tier and/or role.
 * Returns the updated user.
 */
export async function handleAdminUpdateUser(
    request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = AdminUpdateUserSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Validation error');
    }

    try {
        const setClauses: string[] = [];
        const binds: (string | number)[] = [];

        if (parsed.data.tier !== undefined) {
            setClauses.push('tier = ?');
            binds.push(parsed.data.tier);
        }
        if (parsed.data.role !== undefined) {
            setClauses.push('role = ?');
            binds.push(parsed.data.role);
        }

        if (setClauses.length === 0) {
            return JsonResponse.badRequest('At least one field (tier, role) must be provided');
        }

        setClauses.push('updatedAt = ?');
        binds.push(new Date().toISOString());
        binds.push(userId);

        const updateSql = `UPDATE "user" SET ${setClauses.join(', ')} WHERE id = ?`;
        const result = await env.DB.prepare(updateSql).bind(...binds).run();

        if (result.meta.changes === 0) {
            return JsonResponse.notFound('User not found');
        }

        const updated = await env.DB
            .prepare('SELECT id, email, name, emailVerified, image, tier, role, banned, banReason, banExpires, createdAt, updatedAt FROM "user" WHERE id = ?')
            .bind(userId)
            .first<BetterAuthUserRow>();

        if (!updated) return JsonResponse.notFound('User not found');

        return JsonResponse.success({ user: toPublicUser(updated) });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/users] Update error:', message);
        return JsonResponse.serverError('Failed to update user');
    }
}

// ============================================================================
// DELETE /admin/users/:id
// ============================================================================

/** Delete a Better Auth user and all their sessions. */
export async function handleAdminDeleteUser(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    try {
        // Delete sessions first (foreign key dependency)
        await env.DB
            .prepare('DELETE FROM "session" WHERE userId = ?')
            .bind(userId)
            .run();

        // Delete accounts (OAuth providers linked to user)
        await env.DB
            .prepare('DELETE FROM "account" WHERE userId = ?')
            .bind(userId)
            .run();

        // Delete the user
        const result = await env.DB
            .prepare('DELETE FROM "user" WHERE id = ?')
            .bind(userId)
            .run();

        if (result.meta.changes === 0) {
            return JsonResponse.notFound('User not found');
        }

        return JsonResponse.success({ message: 'User deleted' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/users] Delete error:', message);
        return JsonResponse.serverError('Failed to delete user');
    }
}

// ============================================================================
// POST /admin/users/:id/ban
// ============================================================================

/** Ban a user. Sets `banned = true` and optional reason/expiry. */
export async function handleAdminBanUser(
    request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    let body: unknown = {};
    try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = AdminBanUserSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Validation error');
    }

    try {
        const now = new Date().toISOString();
        const result = await env.DB
            .prepare('UPDATE "user" SET banned = 1, banReason = ?, banExpires = ?, updatedAt = ? WHERE id = ?')
            .bind(
                parsed.data.reason ?? null,
                parsed.data.expires ?? null,
                now,
                userId,
            )
            .run();

        if (result.meta.changes === 0) {
            return JsonResponse.notFound('User not found');
        }

        // Revoke all active sessions for the banned user
        await env.DB
            .prepare('DELETE FROM "session" WHERE userId = ?')
            .bind(userId)
            .run();

        return JsonResponse.success({ message: 'User banned' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/users] Ban error:', message);
        return JsonResponse.serverError('Failed to ban user');
    }
}

// ============================================================================
// POST /admin/users/:id/unban
// ============================================================================

/** Unban a user. Clears banned flag, reason, and expiry. */
export async function handleAdminUnbanUser(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    try {
        const now = new Date().toISOString();
        const result = await env.DB
            .prepare('UPDATE "user" SET banned = 0, banReason = NULL, banExpires = NULL, updatedAt = ? WHERE id = ?')
            .bind(now, userId)
            .run();

        if (result.meta.changes === 0) {
            return JsonResponse.notFound('User not found');
        }

        return JsonResponse.success({ message: 'User unbanned' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/users] Unban error:', message);
        return JsonResponse.serverError('Failed to unban user');
    }
}

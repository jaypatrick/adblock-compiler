/**
 * Admin Local User Management Handlers
 *
 * Endpoints for managing local auth users. Admin role + Admin tier required.
 *
 *   GET    /admin/local-users      — list all local auth users (paginated)
 *   GET    /admin/local-users/:id  — get a single user
 *   POST   /admin/local-users      — create a user with any role/tier
 *   PATCH  /admin/local-users/:id  — update a user's tier and/or role
 *   DELETE /admin/local-users/:id  — delete a user
 *
 * ZTA compliance:
 *   - checkRoutePermission() applied on every handler — Admin tier + role required
 *   - All D1 queries use parameterised raw D1 calls (.prepare().bind())
 *   - Responses never include password_hash
 *   - Rate limiting applied via the auth tier (Admin = unlimited)
 *
 * ## Clerk migration
 * These handlers mirror Clerk's Backend API user management:
 *   - `GET /v1/users`       → GET /admin/local-users
 *   - `PATCH /v1/users/:id` → PATCH /admin/local-users/:id (role via publicMetadata)
 *
 * When switching to Clerk, replace these handlers with calls to Clerk's Backend API.
 */

import { ZodError } from 'zod';
import { type Env, type IAuthContext, UserTier } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { AdminCreateLocalUserRequestSchema, AdminPaginationQuerySchema, AdminUpdateLocalUserSchema, LocalUserPublicSchema, type LocalUserRow } from '../schemas.ts';
import { hashPassword } from '../utils/password.ts';
import { isValidLocalRole, tierForRole, VALID_LOCAL_ROLES } from '../utils/local-auth-roles.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';

const VALID_TIERS: ReadonlyArray<string> = Object.values(UserTier).filter((t) => t !== UserTier.Anonymous);

/** Map a LocalUserRow to its public shape (strips password_hash). */
function toPublicRow(u: LocalUserRow) {
    return LocalUserPublicSchema.parse(u);
}

// ============================================================================
// GET /admin/local-users
// ============================================================================

/**
 * List all local auth users.
 * Paginated via `?limit=` and `?offset=` query params.
 * Never returns password_hash.
 */
export async function handleAdminListLocalUsers(
    request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/local-users', authContext);
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

    try {
        const [listResult, countResult] = await Promise.all([
            env.DB
                .prepare('SELECT id, identifier, identifier_type, role, tier, api_disabled, created_at, updated_at FROM local_auth_users ORDER BY created_at DESC LIMIT ? OFFSET ?')
                .bind(limit, skip)
                .all<LocalUserRow>(),
            env.DB
                .prepare('SELECT COUNT(*) AS total FROM local_auth_users')
                .first<{ total: number }>(),
        ]);

        const users = listResult.results
            .map((u) => LocalUserPublicSchema.safeParse(u))
            .filter((r) => r.success)
            .map((r) => r.data);
        const total = countResult?.total ?? 0;

        return JsonResponse.success({ users, total, limit, offset: skip });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/local-users] List error:', message);
        return JsonResponse.serverError('Failed to list users');
    }
}

// ============================================================================
// GET /admin/local-users/:id
// ============================================================================

/** Get a single local auth user by ID. */
export async function handleAdminGetLocalUser(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/local-users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    try {
        const user = await env.DB
            .prepare('SELECT id, identifier, identifier_type, role, tier, api_disabled, created_at, updated_at FROM local_auth_users WHERE id = ?')
            .bind(userId)
            .first<LocalUserRow>();

        if (!user) return JsonResponse.notFound('User not found');

        return JsonResponse.success({ user: toPublicRow(user) });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/local-users] Get error:', message);
        return JsonResponse.serverError('Failed to fetch user');
    }
}

// ============================================================================
// POST /admin/local-users
// ============================================================================

/**
 * Create a local auth user with any role and tier.
 * Admins can create users with any valid role including 'admin'.
 */
export async function handleAdminCreateLocalUser(
    request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/local-users', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = AdminCreateLocalUserRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Validation error');
    }

    const { identifier, password, role: requestedRole = 'user', tier: requestedTier } = parsed.data;

    if (!isValidLocalRole(requestedRole)) {
        return JsonResponse.badRequest(`Invalid role. Valid roles: ${VALID_LOCAL_ROLES.join(', ')}`);
    }

    // Derive tier from role if not explicitly provided
    const resolvedTier = requestedTier ?? tierForRole(requestedRole);
    if (!VALID_TIERS.includes(resolvedTier)) {
        return JsonResponse.badRequest(`Invalid tier. Valid tiers: ${VALID_TIERS.join(', ')}`);
    }

    const identifierType = identifier.includes('@') ? 'email' : 'phone';

    try {
        const existing = await env.DB
            .prepare('SELECT id FROM local_auth_users WHERE identifier = ?')
            .bind(identifier)
            .first<{ id: string }>();

        if (existing) {
            return JsonResponse.error('An account with this identifier already exists', 409);
        }

        const passwordHash = await hashPassword(password);
        const id = crypto.randomUUID();

        await env.DB
            .prepare('INSERT INTO local_auth_users (id, identifier, identifier_type, password_hash, role, tier) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(id, identifier, identifierType, passwordHash, requestedRole, resolvedTier)
            .run();

        const now = new Date().toISOString();
        const created: LocalUserRow = {
            id,
            identifier,
            identifier_type: identifierType,
            password_hash: passwordHash,
            role: requestedRole,
            tier: resolvedTier,
            api_disabled: 0,
            created_at: now,
            updated_at: now,
        };

        return JsonResponse.success({ user: toPublicRow(created) }, { status: 201 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/local-users] Create error:', message);
        return JsonResponse.serverError('Failed to create user');
    }
}

// ============================================================================
// PATCH /admin/local-users/:id
// ============================================================================

/**
 * Update a user's role and/or tier.
 *
 * Tier and role are independent (mirrors Clerk's publicMetadata model):
 * - Changing role auto-suggests the default tier unless tier is also set
 * - Explicitly setting tier overrides the role-derived default
 * - e.g. `{ role: 'user', tier: 'pro' }` gives a user Pro rate limits
 *
 * Returns the updated user (without password_hash).
 */
export async function handleAdminUpdateLocalUser(
    request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/local-users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    let parsed: ReturnType<typeof AdminUpdateLocalUserSchema.parse>;
    try {
        parsed = AdminUpdateLocalUserSchema.parse(body);
    } catch (err) {
        if (err instanceof ZodError) {
            return JsonResponse.badRequest(err.issues[0]?.message ?? 'Validation error');
        }
        throw err;
    }

    if (parsed.role && !isValidLocalRole(parsed.role)) {
        return JsonResponse.badRequest(
            `Invalid role '${parsed.role}'. Valid roles: ${VALID_LOCAL_ROLES.join(', ')}`,
        );
    }

    // If role changes and no explicit tier, derive the default tier for that role
    const newTier = parsed.tier ?? (parsed.role ? tierForRole(parsed.role) : undefined);

    try {
        const setClauses: string[] = [];
        const binds: (string | number)[] = [];

        if (parsed.role !== undefined) {
            setClauses.push('role = ?');
            binds.push(parsed.role);
        }
        if (newTier !== undefined) {
            setClauses.push('tier = ?');
            binds.push(newTier);
        }
        if (parsed.api_disabled !== undefined) {
            setClauses.push('api_disabled = ?');
            binds.push(parsed.api_disabled);
        }

        if (setClauses.length === 0) {
            return JsonResponse.badRequest('At least one field must be provided');
        }

        binds.push(userId);
        const updateSql = `UPDATE local_auth_users SET ${setClauses.join(', ')} WHERE id = ?`;
        const result = await env.DB
            .prepare(updateSql)
            .bind(...binds)
            .run();

        if (result.meta.changes === 0) {
            return JsonResponse.notFound('User not found');
        }

        const updated = await env.DB
            .prepare('SELECT id, identifier, identifier_type, role, tier, api_disabled, created_at, updated_at FROM local_auth_users WHERE id = ?')
            .bind(userId)
            .first<LocalUserRow>();

        if (!updated) return JsonResponse.notFound('User not found');

        return JsonResponse.success({ user: toPublicRow(updated) });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/local-users] Update error:', message);
        return JsonResponse.serverError('Failed to update user');
    }
}

/** Delete a local auth user by ID. */
export async function handleAdminDeleteLocalUser(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    userId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/local-users/*', authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    try {
        const result = await env.DB
            .prepare('DELETE FROM local_auth_users WHERE id = ?')
            .bind(userId)
            .run();

        if (result.meta.changes === 0) {
            return JsonResponse.notFound('User not found');
        }

        return JsonResponse.success({ message: 'User deleted' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/local-users] Delete error:', message);
        return JsonResponse.serverError('Failed to delete user');
    }
}

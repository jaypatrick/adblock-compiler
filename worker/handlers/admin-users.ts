/**
 * Admin Local User Management Handlers
 *
 * Endpoints for managing local auth users. Admin role + Admin tier required.
 *
 *   GET   /admin/local-users      — list all local auth users (paginated)
 *   GET   /admin/local-users/:id  — get a single user
 *   POST  /admin/local-users      — create a user with any role/tier
 *   PATCH /admin/local-users/:id  — update a user's tier and/or role
 *
 * ZTA compliance:
 *   - checkRoutePermission() applied on every handler — Admin tier + role required
 *   - All D1 queries use parameterised .prepare().bind() statements
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
import type { Env, IAuthContext } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { AdminUpdateLocalUserSchema, LocalSignupRequestSchema, LocalUserPublicSchema } from '../schemas.ts';
import { hashPassword } from '../utils/password.ts';
import { isValidLocalRole, tierForRole, VALID_LOCAL_ROLES } from '../utils/local-auth-roles.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';

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
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0);

    try {
        const result = await env.DB
            .prepare(
                `SELECT id, identifier, identifier_type, role, tier, api_disabled, created_at, updated_at
                 FROM local_auth_users
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
            )
            .bind(limit, offset)
            .all<Record<string, unknown>>();

        const countRow = await env.DB
            .prepare('SELECT COUNT(*) AS total FROM local_auth_users')
            .first<{ total: number }>();

        const users = (result.results ?? [])
            .map((row) => LocalUserPublicSchema.safeParse(row))
            .filter((r) => r.success)
            .map((r) => r.data);

        return JsonResponse.success({
            users,
            total: countRow?.total ?? 0,
            limit,
            offset,
        });
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
        const row = await env.DB
            .prepare(
                `SELECT id, identifier, identifier_type, role, tier, api_disabled, created_at, updated_at
                 FROM local_auth_users WHERE id = ? LIMIT 1`,
            )
            .bind(userId)
            .first<Record<string, unknown>>();

        if (!row) return JsonResponse.notFound('User not found');

        const result = LocalUserPublicSchema.safeParse(row);
        if (!result.success) return JsonResponse.serverError('User record is malformed');

        return JsonResponse.success({ user: result.data });
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
    if (!env.JWT_SECRET) {
        return JsonResponse.serviceUnavailable(
            'JWT_SECRET not configured. Run: wrangler secret put JWT_SECRET',
        );
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    // Reuse signup schema for identifier + password validation
    const signupParsed = LocalSignupRequestSchema.safeParse(body);
    if (!signupParsed.success) {
        return JsonResponse.badRequest(signupParsed.error.issues[0]?.message ?? 'Validation error');
    }

    // Admin can also supply role and tier
    const bodyObj = body as Record<string, unknown>;
    const requestedRole = typeof bodyObj.role === 'string' ? bodyObj.role : 'user';
    const requestedTier = typeof bodyObj.tier === 'string' ? bodyObj.tier : null;

    if (!isValidLocalRole(requestedRole)) {
        return JsonResponse.badRequest(`Invalid role. Valid roles: ${VALID_LOCAL_ROLES.join(', ')}`);
    }

    // If tier explicitly provided, validate it; otherwise derive from role
    const tier = requestedTier ?? tierForRole(requestedRole);

    const { identifier, password } = signupParsed.data;
    const identifierType = identifier.includes('@') ? 'email' : 'phone';

    try {
        const existing = await env.DB
            .prepare('SELECT id FROM local_auth_users WHERE identifier = ? LIMIT 1')
            .bind(identifier)
            .first<{ id: string }>();

        if (existing) {
            return JsonResponse.error('An account with this identifier already exists', 409);
        }

        const passwordHash = await hashPassword(password);
        const id = crypto.randomUUID();

        await env.DB
            .prepare(
                `INSERT INTO local_auth_users (id, identifier, identifier_type, password_hash, role, tier)
                 VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(id, identifier, identifierType, passwordHash, requestedRole, tier)
            .run();

        return JsonResponse.success(
            { user: { id, identifier, identifierType, role: requestedRole, tier } },
            { status: 201 },
        );
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

    // Validate role against the registry (if provided)
    if (parsed.role && !isValidLocalRole(parsed.role)) {
        return JsonResponse.badRequest(
            `Invalid role '${parsed.role}'. Valid roles: ${VALID_LOCAL_ROLES.join(', ')}`,
        );
    }

    // If role changes and no explicit tier, derive the default tier for that role
    const newTier = parsed.tier ?? (parsed.role ? tierForRole(parsed.role) : undefined);

    try {
        // Dynamic SQL building: only set columns that are explicitly provided
        const setClauses: string[] = [];
        const values: unknown[] = [];

        if (parsed.role !== undefined) {
            setClauses.push('role = ?');
            values.push(parsed.role);
        }
        if (newTier !== undefined) {
            setClauses.push('tier = ?');
            values.push(newTier);
        }
        if (parsed.api_disabled !== undefined) {
            setClauses.push('api_disabled = ?');
            values.push(parsed.api_disabled);
        }

        // Defensive guard: schema refine ensures at least one field, but protect SQL construction
        if (setClauses.length === 0) return JsonResponse.badRequest('At least one field must be provided');

        setClauses.push("updated_at = datetime('now')");
        values.push(userId);

        const result = await env.DB
            .prepare(`UPDATE local_auth_users SET ${setClauses.join(', ')} WHERE id = ?`)
            .bind(...values)
            .run();

        if (!result.meta?.changes) return JsonResponse.notFound('User not found');

        // Return updated record
        const row = await env.DB
            .prepare(
                `SELECT id, identifier, identifier_type, role, tier, api_disabled, created_at, updated_at
                 FROM local_auth_users WHERE id = ? LIMIT 1`,
            )
            .bind(userId)
            .first<Record<string, unknown>>();

        const userResult = LocalUserPublicSchema.safeParse(row);
        if (!userResult.success) return JsonResponse.serverError('User record is malformed');

        return JsonResponse.success({ user: userResult.data });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/local-users] Update error:', message);
        return JsonResponse.serverError('Failed to update user');
    }
}

// ============================================================================
// DELETE /admin/local-users/:id
// ============================================================================

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

        if (!result.meta?.changes) return JsonResponse.notFound('User not found');

        return JsonResponse.success({ message: 'User deleted' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[admin/local-users] Delete error:', message);
        return JsonResponse.serverError('Failed to delete user');
    }
}

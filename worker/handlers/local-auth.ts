/**
 * Local JWT Auth Handlers
 *
 * Endpoints:
 *   POST /auth/signup          — register with email or phone + password
 *   POST /auth/login           — authenticate, receive JWT
 *   GET  /auth/me              — return current user info (requires auth)
 *   POST /auth/change-password — update password (requires auth)
 *
 * ZTA compliance:
 *   - Every write endpoint rate-limits before any business logic
 *   - All request bodies are Zod-validated before use
 *   - All D1 queries use parameterised Prisma ORM calls
 *   - No password hashes or stack traces in responses
 *   - Auth failures emit security events to Analytics Engine
 *   - requireAuth() guard on /auth/me and /auth/change-password
 *
 * CORS: applied by the outer fetch() wrapper in worker.ts — not set here.
 *
 * ## Migration path to Clerk
 * When CLERK_JWKS_URL is set, worker.ts routes to ClerkAuthProvider instead
 * and these handlers are no longer called. They can be deleted after migration.
 */

import { ZodError } from 'zod';
import { ANONYMOUS_AUTH_CONTEXT, type Env, type IAuthContext, UserTier } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import {
    LocalChangePasswordRequestSchema,
    LocalLoginRequestSchema,
    LocalSignupRequestSchema,
    LocalUserPublicSchema,
    type LocalUserRow,
} from '../schemas.ts';
import { hashPassword, verifyPassword } from '../utils/password.ts';
import { signLocalJWT } from '../utils/local-jwt.ts';
import { DEFAULT_ROLE, tierForRole } from '../utils/local-auth-roles.ts';
import { requireAuth } from '../middleware/auth.ts';
import { checkRateLimitTiered } from '../middleware/index.ts';
import { AnalyticsService, type SecurityEventData } from '../../src/services/AnalyticsService.ts';
import { getPrismaD1 } from '../utils/prisma-d1.ts';
import type { LocalAuthUser } from '../../prisma/generated-d1/models/LocalAuthUser.ts';

// ============================================================================
// Internal helpers
// ============================================================================

/** Detect whether an identifier string is an email address. */
function isEmail(identifier: string): boolean {
    return identifier.includes('@');
}

/** Emit a security event (fire-and-forget — never throws). */
function trackFailure(
    analytics: AnalyticsService,
    event: Partial<SecurityEventData> & { path: string; method: string },
): void {
    try {
        analytics.trackSecurityEvent({
            eventType: 'auth_failure',
            ...event,
        });
    } catch {
        // Non-critical — telemetry must never break auth flow
    }
}

/**
 * Map a Prisma LocalAuthUser to the snake_case LocalUserRow shape so that
 * existing Zod schemas and response formatters remain unchanged.
 */
function toUserRow(u: LocalAuthUser): LocalUserRow {
    return {
        id: u.id,
        identifier: u.identifier,
        identifier_type: u.identifierType as 'email' | 'phone',
        password_hash: u.passwordHash,
        role: u.role,
        tier: u.tier as UserTier,
        api_disabled: u.apiDisabled,
        created_at: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
        updated_at: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : String(u.updatedAt),
    };
}

/**
 * A static pre-computed dummy hash used for constant-time comparison when a
 * login identifier is not found in the database.  Running `verifyPassword`
 * against this dummy prevents timing-based user enumeration.
 *
 * The value is arbitrary; what matters is that it has the correct
 * `salt:hash` format so `verifyPassword` always performs the full PBKDF2
 * derivation before returning false.
 */
const DUMMY_HASH = 'AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ============================================================================
// POST /auth/signup
// ============================================================================

/**
 * Register a new user with an email address or phone number.
 * All self-registered users receive the 'user' role.
 * Admin role must be granted via POST /admin/local-users.
 */
export async function handleLocalSignup(
    request: Request,
    env: Env,
    analytics: AnalyticsService,
    ip: string,
): Promise<Response> {
    const path = '/auth/signup';

    // 1. Rate limit (anonymous tier — no token required for signup)
    const rl = await checkRateLimitTiered(env, ip, ANONYMOUS_AUTH_CONTEXT);
    if (!rl.allowed) {
        trackFailure(analytics, { path, method: 'POST', reason: 'rate_limit' });
        return JsonResponse.rateLimited(Math.ceil((rl.resetAt - Date.now()) / 1000));
    }

    // 2. Parse + validate body
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    let parsed: ReturnType<typeof LocalSignupRequestSchema.parse>;
    try {
        parsed = LocalSignupRequestSchema.parse(body);
    } catch (err) {
        if (err instanceof ZodError) {
            return JsonResponse.badRequest(err.issues[0]?.message ?? 'Validation error');
        }
        throw err;
    }

    // 3. DB + JWT_SECRET required
    if (!env.DB) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }
    if (!env.JWT_SECRET) {
        return JsonResponse.serviceUnavailable(
            'JWT_SECRET not configured. Add to .dev.vars (local) or run: wrangler secret put JWT_SECRET',
        );
    }

    const { identifier, password } = parsed;
    const identifierType: 'email' | 'phone' = isEmail(identifier) ? 'email' : 'phone';

    try {
        const prisma = getPrismaD1(env.DB);

        // 4. Check uniqueness
        const existing = await prisma.localAuthUser.findUnique({
            where: { identifier },
            select: { id: true },
        });

        if (existing) {
            trackFailure(analytics, { path, method: 'POST', reason: 'duplicate_identifier' });
            return JsonResponse.error('An account with this identifier already exists', 409);
        }

        // 5. Hash password + insert
        const passwordHash = await hashPassword(password);
        const id = crypto.randomUUID();
        const role = DEFAULT_ROLE;
        const tier = tierForRole(role);

        const created = await prisma.localAuthUser.create({
            data: { id, identifier, identifierType, passwordHash, role, tier },
        });

        // 6. Issue JWT
        const token = await signLocalJWT(id, role, tier, env.JWT_SECRET);

<<<<<<< Updated upstream
        // 7. Fetch the full row so the response matches LocalUserPublic schema (includes api_disabled, timestamps)
        const row = await env.DB
            .prepare(
                `SELECT id, identifier, identifier_type, role, tier, api_disabled, created_at, updated_at
                 FROM local_auth_users WHERE id = ? LIMIT 1`,
            )
            .bind(id)
            .first<Record<string, unknown>>();

        // Parse with LocalUserPublicSchema — the SELECT above intentionally omits password_hash
        const userResult = LocalUserPublicSchema.parse(row);

        return JsonResponse.success(
            { token, user: userResult },
=======
        return JsonResponse.success(
            {
                token,
                user: LocalUserPublicSchema.parse(toUserRow(created)),
            },
>>>>>>> Stashed changes
            { status: 201 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trackFailure(analytics, { path, method: 'POST', reason: message });
        return JsonResponse.serverError('Signup failed');
    }
}

// ============================================================================
// POST /auth/login
// ============================================================================

/**
 * Authenticate with identifier + password. Returns a JWT on success.
 *
 * Timing-safe: `verifyPassword` is always called even when the user is not
 * found — this prevents timing-based user enumeration.
 */
export async function handleLocalLogin(
    request: Request,
    env: Env,
    analytics: AnalyticsService,
    ip: string,
): Promise<Response> {
    const path = '/auth/login';

    // 1. Rate limit
    const rl = await checkRateLimitTiered(env, ip, ANONYMOUS_AUTH_CONTEXT);
    if (!rl.allowed) {
        trackFailure(analytics, { path, method: 'POST', reason: 'rate_limit' });
        return JsonResponse.rateLimited(Math.ceil((rl.resetAt - Date.now()) / 1000));
    }

    // 2. Parse body
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    let parsed: ReturnType<typeof LocalLoginRequestSchema.parse>;
    try {
        parsed = LocalLoginRequestSchema.parse(body);
    } catch (err) {
        if (err instanceof ZodError) {
            return JsonResponse.badRequest(err.issues[0]?.message ?? 'Validation error');
        }
        throw err;
    }

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');
    if (!env.JWT_SECRET) {
        return JsonResponse.serviceUnavailable(
            'JWT_SECRET not configured. Add to .dev.vars (local) or run: wrangler secret put JWT_SECRET',
        );
    }

    const { identifier, password } = parsed;

    try {
        const prisma = getPrismaD1(env.DB);

        // 3. Look up user
        const prismaUser = await prisma.localAuthUser.findUnique({
            where: { identifier },
        });

        // 4. Always run verifyPassword regardless of whether the user was found.
        //    This is the timing-safe guard against user enumeration: PBKDF2 runs
        //    for the same 100,000 iterations on every code path. The subsequent
        //    `!prismaUser` check cannot leak information because the slow PBKDF2
        //    step has already dominated the response time.
        const hashToCheck = prismaUser?.passwordHash ?? DUMMY_HASH;
        const match = await verifyPassword(password, hashToCheck);

        if (!prismaUser || !match) {
            trackFailure(analytics, { path, method: 'POST', reason: 'invalid_credentials' });
            // Generic message — no user enumeration
            return JsonResponse.error('Invalid credentials', 401);
        }

        const user = toUserRow(prismaUser);

        // 5. Issue JWT
        const token = await signLocalJWT(user.id, user.role, user.tier, env.JWT_SECRET);

        return JsonResponse.success({
            token,
            user: LocalUserPublicSchema.parse(user),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trackFailure(analytics, { path, method: 'POST', reason: message });
        return JsonResponse.serverError('Login failed');
    }
}

// ============================================================================
// GET /auth/me
// ============================================================================

/**
 * Return the current authenticated user's profile.
 * Requires a valid JWT (user or admin).
 */
export async function handleLocalMe(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    // 1. Must be authenticated
    const denied = requireAuth(authContext);
    if (denied) return denied;

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    // authContext.clerkUserId holds providerUserId from LocalJwtAuthProvider
    // which is the UUID from local_auth_users.id (the JWT sub claim).
    const userId = authContext.clerkUserId;
    if (!userId) return JsonResponse.error('Could not resolve user identity', 401);

    try {
        const prisma = getPrismaD1(env.DB);
        const prismaUser = await prisma.localAuthUser.findUnique({
            where: { id: userId },
        });

        if (!prismaUser) return JsonResponse.error('User not found', 404);

<<<<<<< Updated upstream
        const result = LocalUserPublicSchema.safeParse(row);
        if (!result.success) return JsonResponse.serverError('User record is malformed');
=======
        const user = toUserRow(prismaUser);
>>>>>>> Stashed changes

        return JsonResponse.success({ user: result.data });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[auth/me] DB error:', message);
        return JsonResponse.serverError('Failed to fetch user');
    }
}

// ============================================================================
// POST /auth/change-password
// ============================================================================

/**
 * Change the authenticated user's password.
 * Verifies the current password before accepting the new one.
 */
export async function handleLocalChangePassword(
    request: Request,
    env: Env,
    authContext: IAuthContext,
    analytics: AnalyticsService,
    ip: string,
): Promise<Response> {
    const path = '/auth/change-password';

    // 1. Must be authenticated (before rate limiting — we need authContext)
    const denied = requireAuth(authContext);
    if (denied) return denied;

    // 2. Rate limit (authenticated context — keyed by userId)
    const rl = await checkRateLimitTiered(env, ip, authContext);
    if (!rl.allowed) {
        trackFailure(analytics, { path, method: 'POST', reason: 'rate_limit' });
        return JsonResponse.rateLimited(Math.ceil((rl.resetAt - Date.now()) / 1000));
    }

    // 3. Parse body
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    let parsed: ReturnType<typeof LocalChangePasswordRequestSchema.parse>;
    try {
        parsed = LocalChangePasswordRequestSchema.parse(body);
    } catch (err) {
        if (err instanceof ZodError) {
            return JsonResponse.badRequest(err.issues[0]?.message ?? 'Validation error');
        }
        throw err;
    }

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    const userId = authContext.clerkUserId;
    if (!userId) return JsonResponse.error('Could not resolve user identity', 401);

    try {
        const prisma = getPrismaD1(env.DB);

        // 4. Fetch current user record
        const prismaUser = await prisma.localAuthUser.findUnique({
            where: { id: userId },
        });

        if (!prismaUser) {
            trackFailure(analytics, { path, method: 'POST', reason: 'user_not_found' });
            return JsonResponse.error('Invalid credentials', 401);
        }

        // 5. Verify current password
        const valid = await verifyPassword(parsed.currentPassword, prismaUser.passwordHash);
        if (!valid) {
            trackFailure(analytics, { path, method: 'POST', reason: 'wrong_current_password' });
            return JsonResponse.error('Invalid credentials', 401);
        }

        // 6. Hash + store new password
        const newHash = await hashPassword(parsed.newPassword);
        await prisma.localAuthUser.update({
            where: { id: userId },
            data: { passwordHash: newHash },
        });

        return JsonResponse.success({ message: 'Password updated successfully' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trackFailure(analytics, { path, method: 'POST', reason: message });
        return JsonResponse.serverError('Password change failed');
    }
}


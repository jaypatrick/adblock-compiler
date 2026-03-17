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
 *   - All D1 queries use parameterised raw D1 calls (.prepare().bind())
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

import { z, ZodError } from 'zod';
import { ANONYMOUS_AUTH_CONTEXT, type Env, type IAuthContext } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { LocalChangePasswordRequestSchema, LocalLoginRequestSchema, LocalSignupRequestSchema, LocalUserPublicSchema, type LocalUserRow } from '../schemas.ts';
import { hashPassword, verifyPassword } from '../utils/password.ts';
import { signLocalJWT } from '../utils/local-jwt.ts';
import { DEFAULT_ROLE, tierForRole } from '../utils/local-auth-roles.ts';
import { requireAuth } from '../middleware/auth.ts';
import { checkRateLimitTiered } from '../middleware/index.ts';
import { AnalyticsService, type SecurityEventData } from '../../src/services/AnalyticsService.ts';

// ============================================================================
// Internal helpers
// ============================================================================

// Maximum pre-normalization length before NFKC expansion (2× RFC 5321 limit
// to accommodate pathological Unicode expansion cases without blocking normal input).
const MAX_PRE_NORMALIZATION_LENGTH = 640;
// RFC 5321 maximum email address length (local-part + '@' + domain).
const RFC_5321_MAX_EMAIL_LENGTH = 320;

/** Detect whether an identifier string is an email address. */
function isEmail(identifier: string): boolean {
    return identifier.includes('@');
}

/**
 * Canonicalize an email identifier: trim whitespace, NFKC-normalize, and
 * lowercase so that case variants map to a single canonical form. Phone
 * identifiers are returned trimmed only (case is not meaningful).
 * Identifiers are length-capped before normalization to guard against
 * Unicode normalization bombs (NFKC can expand certain sequences).
 */
function canonicalizeIdentifier(identifier: string): string {
    const trimmed = identifier.trim().slice(0, MAX_PRE_NORMALIZATION_LENGTH);
    if (!isEmail(trimmed)) return trimmed;
    const normalized = trimmed.normalize('NFKC').toLowerCase();
    // Enforce RFC 5321 email length limit post-normalization
    return normalized.length <= RFC_5321_MAX_EMAIL_LENGTH ? normalized : normalized.slice(0, RFC_5321_MAX_EMAIL_LENGTH);
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

    const { identifier: rawIdentifier, password } = parsed;
    const identifier = canonicalizeIdentifier(rawIdentifier);
    const identifierType: 'email' | 'phone' = isEmail(identifier) ? 'email' : 'phone';

    try {
        // 4. Check uniqueness
        const existing = await env.DB
            .prepare('SELECT id FROM local_auth_users WHERE identifier = ?')
            .bind(identifier)
            .first<{ id: string }>();

        if (existing) {
            trackFailure(analytics, { path, method: 'POST', reason: 'duplicate_identifier' });
            return JsonResponse.error('An account with this identifier already exists', 409);
        }

        // 5. Hash password + insert
        const passwordHash = await hashPassword(password);
        const id = crypto.randomUUID();
        const role = DEFAULT_ROLE;
        const tier = tierForRole(role);
        const now = new Date().toISOString();

        await env.DB
            .prepare('INSERT INTO local_auth_users (id, identifier, identifier_type, password_hash, role, tier) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(id, identifier, identifierType, passwordHash, role, tier)
            .run();

        const userRow: LocalUserRow = {
            id,
            identifier,
            identifier_type: identifierType,
            password_hash: passwordHash,
            role,
            tier,
            api_disabled: 0,
            created_at: now,
            updated_at: now,
        };

        // 6. Issue JWT
        const token = await signLocalJWT(id, role, tier, env.JWT_SECRET);

        return JsonResponse.success(
            {
                token,
                user: LocalUserPublicSchema.parse(userRow),
            },
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

    const { identifier: rawIdentifier, password } = parsed;
    const identifier = canonicalizeIdentifier(rawIdentifier);

    try {
        // 3. Look up user
        const user = await env.DB
            .prepare('SELECT * FROM local_auth_users WHERE identifier = ?')
            .bind(identifier)
            .first<LocalUserRow>();

        // 4. Always run verifyPassword regardless of whether the user was found.
        //    This is the timing-safe guard against user enumeration: PBKDF2 runs
        //    for the same 100,000 iterations on every code path. The subsequent
        //    `!user` check cannot leak information because the slow PBKDF2
        //    step has already dominated the response time.
        const hashToCheck = user?.password_hash ?? DUMMY_HASH;
        const match = await verifyPassword(password, hashToCheck);

        if (!user || !match) {
            trackFailure(analytics, { path, method: 'POST', reason: 'invalid_credentials' });
            // Generic message — no user enumeration
            return JsonResponse.error('Invalid credentials', 401);
        }

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
        const user = await env.DB
            .prepare('SELECT * FROM local_auth_users WHERE id = ?')
            .bind(userId)
            .first<LocalUserRow>();

        if (!user) return JsonResponse.error('User not found', 404);

        return JsonResponse.success({ user: LocalUserPublicSchema.parse(user) });
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
        // 4. Fetch current user record
        const user = await env.DB
            .prepare('SELECT * FROM local_auth_users WHERE id = ?')
            .bind(userId)
            .first<LocalUserRow>();

        if (!user) {
            trackFailure(analytics, { path, method: 'POST', reason: 'user_not_found' });
            return JsonResponse.error('Invalid credentials', 401);
        }

        // 5. Verify current password
        const valid = await verifyPassword(parsed.currentPassword, user.password_hash);
        if (!valid) {
            trackFailure(analytics, { path, method: 'POST', reason: 'wrong_current_password' });
            return JsonResponse.error('Invalid credentials', 401);
        }

        // 6. Hash + store new password
        const newHash = await hashPassword(parsed.newPassword);
        await env.DB
            .prepare('UPDATE local_auth_users SET password_hash = ? WHERE id = ?')
            .bind(newHash, userId)
            .run();

        return JsonResponse.success({ message: 'Password updated successfully' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trackFailure(analytics, { path, method: 'POST', reason: message });
        return JsonResponse.serverError('Password change failed');
    }
}

// ============================================================================
// POST /auth/bootstrap-admin
// ============================================================================

/**
 * Promote the requesting user to admin if their identifier matches
 * INITIAL_ADMIN_EMAIL and they are not already an admin.
 */
export async function handleLocalBootstrapAdmin(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    analytics: AnalyticsService,
    ip: string,
): Promise<Response> {
    const path = '/auth/bootstrap-admin';

    const denied = requireAuth(authContext);
    if (denied) return denied;

    // Rate limit (authenticated context — keyed by userId)
    const rl = await checkRateLimitTiered(env, ip, authContext);
    if (!rl.allowed) {
        trackFailure(analytics, { path, method: 'POST', reason: 'rate_limit', clientIpHash: AnalyticsService.hashIp(ip) });
        return JsonResponse.rateLimited(Math.ceil((rl.resetAt - Date.now()) / 1000));
    }

    if (!env.INITIAL_ADMIN_EMAIL) {
        return JsonResponse.error('Bootstrap admin is not configured (INITIAL_ADMIN_EMAIL not set)', 403);
    }

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');
    if (!env.JWT_SECRET) return JsonResponse.serviceUnavailable('JWT_SECRET not configured');

    const userId = authContext.clerkUserId;
    if (!userId) return JsonResponse.error('Could not resolve user identity', 401);

    try {
        const user = await env.DB
            .prepare('SELECT * FROM local_auth_users WHERE id = ?')
            .bind(userId)
            .first<LocalUserRow>();

        if (!user) return JsonResponse.error('User not found', 404);

        if (user.identifier.toLowerCase().normalize('NFKC') !== env.INITIAL_ADMIN_EMAIL.toLowerCase().normalize('NFKC')) {
            trackFailure(analytics, { path, method: 'POST', reason: 'identifier_mismatch', clientIpHash: AnalyticsService.hashIp(ip) });
            return JsonResponse.error('This account is not designated as the initial admin', 403);
        }

        // Single-use guard: reject if any admin already exists in the system.
        // Bootstrap is a one-time operation — use /admin/local-users to create additional admins.
        const existingAdmin = await env.DB
            .prepare('SELECT COUNT(*) as count FROM local_auth_users WHERE role = ?')
            .bind('admin')
            .first<{ count: number }>();

        if (existingAdmin && existingAdmin.count > 0 && user.role !== 'admin') {
            trackFailure(analytics, { path, method: 'POST', reason: 'bootstrap_already_used', clientIpHash: AnalyticsService.hashIp(ip) });
            return JsonResponse.error('Admin bootstrap has already been used. Create additional admins via /admin/local-users', 403);
        }

        if (user.role === 'admin') {
            return JsonResponse.success({ message: 'Account is already an admin', user: LocalUserPublicSchema.parse(user) });
        }

        const newTier = tierForRole('admin');
        await env.DB
            .prepare("UPDATE local_auth_users SET role = 'admin', tier = ? WHERE id = ? AND role != 'admin'")
            .bind(newTier, userId)
            .run();

        const updatedUser: LocalUserRow = { ...user, role: 'admin', tier: newTier };
        const token = await signLocalJWT(userId, 'admin', newTier, env.JWT_SECRET);

        return JsonResponse.success({
            message: 'Account promoted to admin',
            token,
            user: LocalUserPublicSchema.parse(updatedUser),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trackFailure(analytics, { path, method: 'POST', reason: message, clientIpHash: AnalyticsService.hashIp(ip) });
        return JsonResponse.serverError('Bootstrap admin failed');
    }
}

// ============================================================================
// PATCH /auth/profile
// ============================================================================

/**
 * Update the authenticated user's profile (identifier/email).
 */
export async function handleLocalUpdateProfile(
    request: Request,
    env: Env,
    authContext: IAuthContext,
    analytics: AnalyticsService,
    ip: string,
): Promise<Response> {
    const path = '/auth/profile';

    // 1. Must be authenticated (before rate limiting — we need authContext)
    const denied = requireAuth(authContext);
    if (denied) return denied;

    // 2. Rate limit (authenticated context — keyed by userId)
    const rl = await checkRateLimitTiered(env, ip, authContext);
    if (!rl.allowed) {
        trackFailure(analytics, { path, method: 'PATCH', reason: 'rate_limit', clientIpHash: AnalyticsService.hashIp(ip) });
        return JsonResponse.rateLimited(Math.ceil((rl.resetAt - Date.now()) / 1000));
    }

    if (!env.DB) return JsonResponse.serviceUnavailable('Database not configured');

    const userId = authContext.clerkUserId;
    if (!userId) return JsonResponse.error('Could not resolve user identity', 401);

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = z.object({ identifier: z.string().email('Must be a valid email').optional() }).safeParse(body);
    if (!parsed.success) return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Validation error');

    const { identifier: rawIdentifier } = parsed.data;
    if (!rawIdentifier) return JsonResponse.success({ message: 'No changes made' });

    // Canonicalize email before duplicate check and write — ensures identifiers
    // are stored in a consistent form and that case variants don't bypass uniqueness.
    const identifier = canonicalizeIdentifier(rawIdentifier);

    try {
        const existing = await env.DB
            .prepare('SELECT id FROM local_auth_users WHERE identifier = ? AND id != ?')
            .bind(identifier, userId)
            .first<{ id: string }>();
        if (existing) return JsonResponse.error('An account with this email already exists', 409);

        await env.DB
            .prepare('UPDATE local_auth_users SET identifier = ?, identifier_type = ? WHERE id = ?')
            .bind(identifier, 'email', userId)
            .run();

        const user = await env.DB
            .prepare('SELECT * FROM local_auth_users WHERE id = ?')
            .bind(userId)
            .first<LocalUserRow>();

        return JsonResponse.success({ user: user ? LocalUserPublicSchema.parse(user) : null });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-console
        console.error('[auth/profile] DB error:', message);
        return JsonResponse.serverError('Profile update failed');
    }
}

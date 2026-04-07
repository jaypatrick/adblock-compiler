/**
 * Hono middleware factories — Phase 2 extraction.
 *
 * These reusable `MiddlewareHandler` factories eliminate the inline middleware
 * duplication that was present in every route handler of `worker/hono-app.ts`.
 *
 * Each factory is a single-responsibility function that:
 *   - Creates a Hono `MiddlewareHandler` matching the app's Bindings/Variables shape
 *   - Performs one cross-cutting concern (size, rate limiting, human verification, auth)
 *   - Returns a standard HTTP error response on failure, or calls `next()` on success
 *
 * ## Usage
 *
 * Apply at the route level:
 * ```typescript
 * routes.post('/compile',
 *     bodySizeMiddleware(),
 *     rateLimitMiddleware(),
 *     turnstileMiddleware(),
 *     handler,
 * );
 * ```
 *
 * Or apply to a route group via `routes.use()` (method-agnostic):
 * ```typescript
 * routes.use('/metrics/*', rateLimitMiddleware());
 * ```
 *
 * ## Execution Order for write endpoints
 *
 * The RECOMMENDED order to preserve correct body-stream semantics is:
 *
 *   1. `bodySizeMiddleware()` — reads body size via `Request.clone()`, leaves original intact
 *   2. `rateLimitMiddleware()` — no body read; emits `rate_limit` ZTA security event on 429
 *   3. `turnstileMiddleware()` — reads Turnstile token via `Request.clone()`, leaves original intact;
 *      emits `turnstile_rejection` ZTA security event on 400/403
 *   4. Route handler
 *
 * **Exception — POST /compile**: `zValidator` is placed at step 3 (before Turnstile) to
 * avoid double JSON parsing.  Turnstile verification is then inlined in the handler using
 * `c.req.valid('json').turnstileToken` from the cached validated data.
 *
 * @module
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, IAuthContext } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { WORKER_DEFAULTS } from '../../src/config/defaults.ts';
import { requireAuth } from './auth.ts';
import { checkRateLimitTiered, validateRequestSize, verifyTurnstileToken } from './index.ts';
import type { PrismaClient } from '../../prisma/generated/client.ts';

// ============================================================================
// Local type — mirrors worker/hono-app.ts `Variables` without importing from there.
// Structural typing means MiddlewareHandler<AppEnv> is assignable wherever
// MiddlewareHandler<{ Bindings: Env; Variables: Variables }> is expected.
// ============================================================================

/** Variables set in Hono context by the global middleware in `hono-app.ts`. */
interface AppVars {
    authContext: IAuthContext;
    analytics: AnalyticsService;
    requestId: string;
    ip: string;
    /** Request-scoped PrismaClient — set by prismaMiddleware() when HYPERDRIVE is bound. */
    prisma?: InstanceType<typeof PrismaClient>;
}

type AppEnv = { Bindings: Env; Variables: AppVars };
type AppMiddleware = MiddlewareHandler<AppEnv>;

const RATE_LIMIT_WINDOW = WORKER_DEFAULTS.RATE_LIMIT_WINDOW_SECONDS;

// ============================================================================
// Body size validation
// ============================================================================

/**
 * Returns a Hono middleware that validates the request body size.
 *
 * Reads the body via `Request.clone()` so the original stream remains intact
 * for downstream middleware (Turnstile, `zValidator`) and handlers.
 *
 * Returns **413 Payload Too Large** if the body exceeds `MAX_REQUEST_BODY_MB`
 * (defaults to `WORKER_DEFAULTS.MAX_REQUEST_BODY_BYTES`).
 *
 * @example
 * ```typescript
 * routes.post('/compile', bodySizeMiddleware(), handler);
 * ```
 */
export function bodySizeMiddleware(): AppMiddleware {
    return async (c, next) => {
        const sz = await validateRequestSize(c.req.raw, c.env);
        if (!sz.valid) {
            return c.json({ success: false, error: sz.error ?? 'Request body too large' }, 413);
        }
        await next();
    };
}

// ============================================================================
// Rate limiting
// ============================================================================

/**
 * Returns a Hono middleware that enforces tiered rate limiting.
 *
 * The rate limit is keyed by:
 * - `ratelimit:user:<userId>` for authenticated users (avoids NAT collisions)
 * - `ratelimit:ip:<ip>` for anonymous users
 *
 * Admin tier bypasses the check entirely (unlimited requests, no KV I/O).
 *
 * Returns **429 Too Many Requests** with standard `Retry-After` and
 * `X-RateLimit-*` headers, and emits both a `rate_limit_exceeded` analytics
 * event and a `rate_limit` ZTA security event for observability.
 *
 * @example
 * ```typescript
 * routes.post('/compile', rateLimitMiddleware(), handler);
 * ```
 */
export function rateLimitMiddleware(): AppMiddleware {
    return async (c, next) => {
        const rl = await checkRateLimitTiered(c.env, c.get('ip'), c.get('authContext'));
        if (!rl.allowed) {
            const analytics = c.get('analytics');
            const clientIpHash = AnalyticsService.hashIp(c.get('ip'));
            analytics.trackRateLimitExceeded({
                requestId: c.get('requestId'),
                clientIpHash,
                rateLimit: rl.limit,
                windowSeconds: RATE_LIMIT_WINDOW,
            });
            // ZTA security event — feeds real-time Zero Trust dashboards and SIEM pipelines.
            analytics.trackSecurityEvent({
                eventType: 'rate_limit',
                path: c.req.path,
                method: c.req.method,
                clientIpHash,
                tier: c.get('authContext').tier,
                reason: 'rate_limit_exceeded',
            });
            return c.json(
                {
                    success: false,
                    error: `Rate limit exceeded. Maximum ${rl.limit} requests per ${RATE_LIMIT_WINDOW} seconds.`,
                },
                429,
                {
                    'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
                    'X-RateLimit-Limit': String(rl.limit),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(rl.resetAt),
                },
            );
        }
        await next();
    };
}

// ============================================================================
// Turnstile human verification
// ============================================================================

/**
 * Returns a Hono middleware that verifies the Cloudflare Turnstile token.
 *
 * Extracts the token from the `turnstileToken` field of the JSON request body.
 * The body is read via `Request.clone()` to leave the original stream intact
 * for downstream `zValidator` or the route handler.
 *
 * - If `TURNSTILE_SECRET_KEY` is not configured, the middleware is a no-op.
 * - Returns **400 Bad Request** if the body cannot be parsed as JSON.
 * - Returns **403 Forbidden** if the token is missing or fails verification.
 *
 * > **Note for WebSocket upgrades**: Turnstile tokens for `/ws/compile` arrive
 * > as a query-string parameter (`?turnstileToken=…`), not in the JSON body.
 * > Use inline verification for those routes instead of this middleware.
 *
 * @example
 * ```typescript
 * routes.post('/compile', bodySizeMiddleware(), rateLimitMiddleware(), turnstileMiddleware(), handler);
 * ```
 */
export function turnstileMiddleware(): AppMiddleware {
    return async (c, next) => {
        if (!c.env.TURNSTILE_SECRET_KEY) {
            await next();
            return;
        }
        const analytics = c.get('analytics');
        const clientIpHash = AnalyticsService.hashIp(c.get('ip'));
        const tier = c.get('authContext').tier;
        let token = '';
        try {
            const body = await c.req.raw.clone().json() as { turnstileToken?: string };
            token = body.turnstileToken ?? '';
        } catch {
            // ZTA security event — body could not be parsed; emit before returning 400.
            analytics.trackSecurityEvent({
                eventType: 'turnstile_rejection',
                path: c.req.path,
                method: c.req.method,
                clientIpHash,
                tier,
                reason: 'invalid_request_body_json',
            });
            return c.json(
                { success: false, error: 'Invalid request body — could not extract Turnstile token' },
                400,
            );
        }
        const result = await verifyTurnstileToken(c.env, token, c.get('ip'));
        if (!result.success) {
            // ZTA security event — Turnstile challenge failed; emit before returning 403.
            analytics.trackSecurityEvent({
                eventType: 'turnstile_rejection',
                path: c.req.path,
                method: c.req.method,
                clientIpHash,
                tier,
                reason: result.error ?? 'turnstile_verification_failed',
            });
            return c.json(
                { success: false, error: result.error ?? 'Turnstile verification failed' },
                403,
            );
        }
        await next();
    };
}

// ============================================================================
// Authentication gate
// ============================================================================

/**
 * Returns a Hono middleware that requires the caller to be authenticated.
 *
 * Returns **401 Unauthorized** if the request context is anonymous
 * (no valid Better Auth session or API key was presented).
 *
 * Route handlers protected by this middleware can safely assume
 * `c.get('authContext').userId` is non-null.
 *
 * @example
 * ```typescript
 * routes.get('/rules', requireAuthMiddleware(), handler);
 * ```
 */
export function requireAuthMiddleware(): AppMiddleware {
    return async (c, next) => {
        const guard = requireAuth(c.get('authContext'));
        if (guard) return guard;
        await next();
    };
}

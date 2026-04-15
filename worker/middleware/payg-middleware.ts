/// <reference types="@cloudflare/workers-types" />

/**
 * PAYG (Pay-As-You-Go) middleware for x402-style per-call billing.
 *
 * ## Flow
 * 1. Check for X-Payg-Session header — if present and valid, decrement session
 *    request count and allow. No Stripe call needed.
 * 2. Check for X-Payment-Response header (x402 payment proof) — if present,
 *    verify with Stripe facilitator and issue a new PaygSession.
 * 3. If neither is present, return 402 Payment Required with payment specs
 *    in the X-Payment-Required response header (x402 protocol).
 *
 * ## Configuration
 * All limits are driven by PAYG_TIER_LIMITS from worker/types.ts.
 * Price-per-call is configured via env.PAYG_PRICE_PER_CALL_USD_CENTS.
 *
 * ## User Education
 * The 402 response body is human-readable JSON that describes the billing
 * model in plain English — no crypto terminology. Users see "Pay as you go"
 * pricing, not "x402 protocol". The X-Payment-Required header is for
 * machine clients.
 *
 * @see worker/types.ts — PAYG_TIER_LIMITS
 * @see docs/billing/payg.md — setup and usage guide
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types.ts';
import { PAYG_TIER_LIMITS } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import type { PrismaClient } from '../../prisma/generated/client.ts';
import type { Variables } from '../routes/shared.ts';

// ============================================================================
// Local types
// ============================================================================

type AppEnv = { Bindings: Env; Variables: Variables };
type AppMiddleware = MiddlewareHandler<AppEnv>;

// ============================================================================
// Constants
// ============================================================================

/** Default PAYG price per call in USD cents when env is not configured. */
const DEFAULT_PAYG_PRICE_CENTS = 1;

/** Default conversion threshold in USD cents ($20). */
const DEFAULT_CONVERSION_THRESHOLD_CENTS = 2000;

/** Default requests granted per PAYG session (10 calls per payment). */
export const DEFAULT_REQUESTS_PER_SESSION = 10;

/** Default session TTL in milliseconds (1 hour). */
export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

// ============================================================================
// Helper utilities
// ============================================================================

/**
 * Parse the price per call from environment, defaulting to 1 cent.
 *
 * @param env - Worker environment bindings.
 * @returns Price per call in USD cents.
 */
function getPricePerCallCents(env: Env): number {
    const raw = env.PAYG_PRICE_PER_CALL_USD_CENTS;
    if (!raw) return DEFAULT_PAYG_PRICE_CENTS;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) || parsed < 1 ? DEFAULT_PAYG_PRICE_CENTS : parsed;
}

/**
 * Parse the conversion threshold from environment, defaulting to 2000 cents ($20).
 *
 * @param env - Worker environment bindings.
 * @returns Conversion threshold in USD cents.
 */
function getConversionThresholdCents(env: Env): number {
    const raw = env.PAYG_CONVERSION_THRESHOLD_USD_CENTS;
    if (!raw) return DEFAULT_CONVERSION_THRESHOLD_CENTS;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) || parsed < 1 ? DEFAULT_CONVERSION_THRESHOLD_CENTS : parsed;
}

/**
 * Build the x402-compatible payment specification object.
 *
 * This is the machine-readable payment descriptor sent in the
 * X-Payment-Required response header. x402-compatible clients parse this
 * to construct a payment and retry the request with X-Payment-Response.
 *
 * @param pricePerCallCents - Price per call in USD cents.
 * @param env - Worker environment bindings.
 * @returns x402 payment specification object.
 */
function buildX402PaymentSpec(pricePerCallCents: number, env: Env): Record<string, unknown> {
    return {
        version: '2',
        scheme: 'exact',
        network: 'stripe',
        maxAmountRequired: String(pricePerCallCents),
        resource: env.STRIPE_PAYG_PRICE_ID ?? 'payg_per_call',
        description: `Pay As You Go — $${(pricePerCallCents / 100).toFixed(2)} per API call`,
        mimeType: 'application/json',
        outputSchema: null,
        extra: {
            stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY,
            checkoutUrl: `${env.URL_API ?? ''}/api/stripe/payg/checkout`,
            sessionRequestsGranted: DEFAULT_REQUESTS_PER_SESSION,
            sessionTtlSeconds: DEFAULT_SESSION_TTL_MS / 1000,
        },
    };
}

// ============================================================================
// Exported middleware factories
// ============================================================================

/**
 * PAYG gate middleware factory.
 *
 * Protects a route with PAYG billing. The middleware implements the x402
 * payment flow:
 *
 * 1. If `X-Payg-Session` header is present → delegate to session validation.
 * 2. If `X-Payment-Response` header is present → verify payment proof and
 *    issue a new session (TODO: wire Stripe facilitator).
 * 3. Otherwise → return `402 Payment Required` with payment specifications.
 *
 * This middleware does NOT fire for requests that already hold a valid
 * Better Auth / API-key session with a paid tier — the calling route must
 * decide whether to apply this middleware at all.
 *
 * @example
 * ```typescript
 * routes.post('/compile/payg', paygMiddleware(), handler);
 * ```
 *
 * @returns Hono MiddlewareHandler that enforces PAYG billing.
 */
export function paygMiddleware(): AppMiddleware {
    return async (c, next) => {
        const env = c.env;
        const analytics = c.get('analytics');
        const ip = c.get('ip');
        const requestId = c.get('requestId');

        const sessionToken = c.req.header('X-Payg-Session');
        const paymentResponse = c.req.header('X-Payment-Response');

        // ── Path 1: existing PAYG session ─────────────────────────────────────
        if (sessionToken) {
            const sessionResult = await validateAndDecrementSession(sessionToken, c.env, c.get('prisma'));
            if (sessionResult.valid) {
                if (sessionResult.requestsRemaining !== undefined) {
                    c.header('X-Payg-Session-Remaining', String(sessionResult.requestsRemaining));
                }
                await next();
                return;
            }
            // Session invalid or exhausted — fall through to 402
            analytics.trackSecurityEvent({
                eventType: 'auth_failure',
                authMethod: 'payg_session',
                reason: sessionResult.error ?? 'invalid_payg_session',
                path: c.req.path,
                method: c.req.method,
                clientIpHash: AnalyticsService.hashIp(ip),
                requestId: requestId ?? 'unknown',
            });
        }

        // ── Path 2: x402 payment proof ────────────────────────────────────────
        if (paymentResponse) {
            // TODO(billing-next-milestone): Wire Stripe facilitator verification here.
            // 1. Parse paymentResponse as x402 payment proof JWT/token.
            // 2. Call Stripe facilitator to verify payment.
            // 3. Upsert PaygCustomer and create PaygSession in DB.
            // 4. Call next() on success.
            // Reference: docs/billing/payg.md — x402 flow
            analytics.trackSecurityEvent({
                eventType: 'auth_failure',
                authMethod: 'payg_x402',
                reason: 'x402_facilitator_not_yet_wired',
                path: c.req.path,
                method: c.req.method,
                clientIpHash: AnalyticsService.hashIp(ip),
                requestId: requestId ?? 'unknown',
            });
        }

        // ── Path 3: 402 Payment Required ──────────────────────────────────────
        const pricePerCallCents = getPricePerCallCents(env);
        const paymentSpec = buildX402PaymentSpec(pricePerCallCents, env);
        const paygSignupUrl = `${env.URL_API ?? ''}/api/payg/pricing`;

        analytics.trackSecurityEvent({
            eventType: 'rate_limit',
            authMethod: 'payg',
            reason: 'payg_payment_required',
            path: c.req.path,
            method: c.req.method,
            clientIpHash: AnalyticsService.hashIp(ip),
            requestId: requestId ?? 'unknown',
        });

        return c.json(
            {
                paymentRequired: true,
                message: `This endpoint requires a payment. Add your card at ${paygSignupUrl} or use Pay As You Go.`,
                pricePerCallUsdCents: pricePerCallCents,
                paygSignupUrl,
                x402PaymentSpecs: paymentSpec,
                tierLimits: PAYG_TIER_LIMITS,
            },
            402,
            {
                'X-Payment-Required': JSON.stringify(paymentSpec),
            },
        );
    };
}

/**
 * PAYG session validation middleware factory.
 *
 * Validates the `X-Payg-Session` header against the `payg_sessions` table
 * in the database. On success, decrements `requestsUsed` and sets the
 * `X-Payg-Session-Remaining` response header so clients know how many
 * requests remain in the session.
 *
 * Returns `401 Unauthorized` if no session header is present.
 * Returns `402 Payment Required` if the session is exhausted, expired, or
 * revoked.
 *
 * @example
 * ```typescript
 * routes.get('/payg/session/status', paygSessionMiddleware(), handler);
 * ```
 *
 * @returns Hono MiddlewareHandler that validates PAYG sessions.
 */
export function paygSessionMiddleware(): AppMiddleware {
    return async (c, next) => {
        const sessionToken = c.req.header('X-Payg-Session');
        if (!sessionToken) {
            return c.json(
                { success: false, error: 'Missing X-Payg-Session header' },
                401,
            );
        }

        const result = await validateAndDecrementSession(sessionToken, c.env, c.get('prisma'));
        if (!result.valid) {
            const analytics = c.get('analytics');
            analytics.trackSecurityEvent({
                eventType: 'auth_failure',
                authMethod: 'payg_session',
                reason: result.error ?? 'invalid_payg_session',
                path: c.req.path,
                method: c.req.method,
                clientIpHash: AnalyticsService.hashIp(c.get('ip')),
            });
            return c.json(
                {
                    paymentRequired: true,
                    error: result.error ?? 'PAYG session is invalid, exhausted, or expired.',
                },
                402,
            );
        }

        if (result.requestsRemaining !== undefined) {
            c.header('X-Payg-Session-Remaining', String(result.requestsRemaining));
        }

        await next();
    };
}

/**
 * PAYG conversion check middleware factory.
 *
 * After a request is allowed through, checks whether the PAYG customer's
 * cumulative spend has crossed the conversion threshold (configured via
 * `PAYG_CONVERSION_THRESHOLD_USD_CENTS`). If so, sets
 * `c.set('paygConversionEligible', true)` so route handlers can surface
 * a subscription upsell prompt in the response body.
 *
 * This middleware is non-blocking: it never rejects a request.
 *
 * @example
 * ```typescript
 * routes.get('/payg/usage', paygConversionCheckMiddleware(), handler);
 * ```
 *
 * @returns Hono MiddlewareHandler that checks PAYG conversion eligibility.
 */
export function paygConversionCheckMiddleware(): AppMiddleware {
    return async (c, next) => {
        await next();

        const stripeCustomerId = c.req.header('X-Stripe-Customer-Id');
        if (!stripeCustomerId) return;

        const prisma = c.get('prisma');
        if (!prisma) return;

        try {
            const customer = await prisma.paygCustomer.findUnique({
                where: { stripeCustomerId },
                select: { totalSpendUsdCents: true },
            });

            if (!customer) return;

            const threshold = getConversionThresholdCents(c.env);
            if (customer.totalSpendUsdCents >= threshold) {
                c.set('paygConversionEligible', true);
            }
        } catch (err) {
            // Non-blocking: log and continue
            // deno-lint-ignore no-console
            console.warn('[paygConversionCheckMiddleware] Failed to check conversion eligibility:', err);
        }
    };
}

// ============================================================================
// Internal helpers
// ============================================================================

interface SessionValidationResult {
    valid: boolean;
    error?: string;
    requestsRemaining?: number;
    session?: {
        id: string;
        requestsGranted: number;
        requestsUsed: number;
        expiresAt: Date;
    };
}

/**
 * Validate a PAYG session token and decrement the request count.
 *
 * Performs the following checks in order:
 * 1. Session exists in the database.
 * 2. Session has not been revoked (`revokedAt` is null).
 * 3. Session has not expired (`expiresAt` > now).
 * 4. Session has remaining requests (`requestsUsed < requestsGranted`).
 *
 * On success, atomically increments `requestsUsed` and returns the remaining
 * request count. On failure, returns a descriptive error string.
 *
 * @param sessionToken - Opaque session token from the X-Payg-Session header.
 * @param _env - Worker environment bindings (unused, reserved for future use).
 * @param prisma - Request-scoped PrismaClient instance.
 * @returns Validation result with optional remaining request count.
 */
async function validateAndDecrementSession(
    sessionToken: string,
    _env: Env,
    prisma: InstanceType<typeof PrismaClient> | undefined,
): Promise<SessionValidationResult> {
    if (!prisma) {
        return { valid: false, error: 'database_unavailable' };
    }

    try {
        const session = await prisma.paygSession.findUnique({
            where: { sessionToken },
        });

        if (!session) {
            return { valid: false, error: 'session_not_found' };
        }

        if (session.revokedAt !== null) {
            return { valid: false, error: 'session_revoked' };
        }

        if (session.expiresAt < new Date()) {
            return { valid: false, error: 'session_expired' };
        }

        if (session.requestsUsed >= session.requestsGranted) {
            return { valid: false, error: 'session_exhausted' };
        }

        // Atomically increment requestsUsed
        const updated = await prisma.paygSession.update({
            where: { id: session.id },
            data: { requestsUsed: { increment: 1 } },
            select: { requestsGranted: true, requestsUsed: true },
        });

        return {
            valid: true,
            requestsRemaining: updated.requestsGranted - updated.requestsUsed,
            session: {
                id: session.id,
                requestsGranted: updated.requestsGranted,
                requestsUsed: updated.requestsUsed,
                expiresAt: session.expiresAt,
            },
        };
    } catch (err) {
        // deno-lint-ignore no-console
        console.error('[validateAndDecrementSession] DB error:', err);
        return { valid: false, error: 'database_error' };
    }
}

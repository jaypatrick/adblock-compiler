/// <reference types="@cloudflare/workers-types" />

/**
 * Pay-As-You-Go (PAYG) billing routes.
 *
 * Routes:
 *   POST /payg/session/create — Create a PAYG session (stub)
 *   GET  /payg/session/status — Get current PAYG session status
 *   GET  /payg/usage          — Get PAYG usage summary
 *   GET  /payg/pricing        — Get current PAYG pricing (public)
 *
 * ## Overview
 * These routes support the x402-style PAYG billing model. Clients that do
 * not hold a Better Auth subscription session can purchase API access
 * on a per-call basis via Stripe.
 *
 * The `/payg/pricing` endpoint is public (no auth required) and is used by
 * the Angular frontend pricing page to display current rates.
 *
 * @see worker/middleware/payg-middleware.ts — PAYG middleware factories
 * @see worker/types.ts — PAYG_TIER_LIMITS
 * @see docs/billing/payg.md — developer guide
 * @see docs/billing/stripe-setup.md — Stripe setup guide
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import { PAYG_TIER_LIMITS } from '../types.ts';
import type { AppContext, Variables } from './shared.ts';
import { rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';
import { DEFAULT_REQUESTS_PER_SESSION, DEFAULT_SESSION_TTL_MS, paygSessionMiddleware } from '../middleware/payg-middleware.ts';
import { JsonResponse } from '../utils/response.ts';

export const paygRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ============================================================================
// Schemas
// ============================================================================

const createSessionRequestSchema = z.object({
    stripeCustomerId: z.string().optional().describe(
        'Stripe Customer ID. Required if not using an authenticated Better Auth session with stripeCustomerId.',
    ),
    requestsToPurchase: z.number().int().min(1).max(100).default(10).describe(
        'Number of API call credits to purchase in this session.',
    ),
});

const createSessionResponseSchema = z.object({
    success: z.literal(true),
    sessionToken: z.string().describe('Opaque session token — include in X-Payg-Session header'),
    requestsGranted: z.number().describe('Total API calls covered by this session'),
    expiresAt: z.string().datetime().describe('ISO-8601 UTC expiry timestamp'),
});

const sessionStatusResponseSchema = z.object({
    success: z.literal(true),
    requestsGranted: z.number(),
    requestsUsed: z.number(),
    requestsRemaining: z.number(),
    expiresAt: z.string().datetime(),
});

const paygUsageResponseSchema = z.object({
    success: z.literal(true),
    totalRequests: z.number(),
    totalSpendUsdCents: z.number(),
    thisMonthRequests: z.number(),
    thisMonthSpendUsdCents: z.number(),
    conversionEligible: z.boolean().describe('True when PAYG spend exceeds the cost of a Pro subscription'),
    suggestedPlan: z.string().nullable().describe(
        'Suggested subscription plan when PAYG spend exceeds subscription cost. Null otherwise.',
    ),
});

const paygPricingResponseSchema = z.object({
    pricePerCallUsdCents: z.number().describe('Price per API call in USD cents'),
    includedRequestsPerSession: z.number().describe('Number of requests granted per session token'),
    sessionTtlSeconds: z.number().describe('Session token validity in seconds'),
    tierLimits: z.record(z.string(), z.unknown()).describe('PAYG operational limits — PAYG_TIER_LIMITS from worker/types.ts'),
});

const errorResponseSchema = z.object({
    success: z.literal(false),
    error: z.string(),
});

// ============================================================================
// Route definitions
// ============================================================================

const createSessionRoute = createRoute({
    method: 'post',
    path: '/payg/session/create',
    tags: ['PAYG', 'Billing'],
    summary: 'Create a PAYG session',
    description: 'Create a Pay-As-You-Go session token that grants a fixed number of API calls. ' +
        'Requires either an authenticated Better Auth session with stripeCustomerId, or an ' +
        'explicit X-Stripe-Customer-Id header. ' +
        'TODO(billing-next-milestone): Verify Stripe payment before issuing session.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: createSessionRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'PAYG session created successfully',
            content: { 'application/json': { schema: createSessionResponseSchema } },
        },
        400: {
            description: 'Bad request — missing stripeCustomerId',
            content: { 'application/json': { schema: errorResponseSchema } },
        },
        401: {
            description: 'Unauthorized — no auth context or Stripe customer ID',
            content: { 'application/json': { schema: errorResponseSchema } },
        },
        503: {
            description: 'Database unavailable',
            content: { 'application/json': { schema: errorResponseSchema } },
        },
    },
});

const sessionStatusRoute = createRoute({
    method: 'get',
    path: '/payg/session/status',
    tags: ['PAYG', 'Billing'],
    summary: 'Get PAYG session status',
    description: 'Returns the current status of a PAYG session. Requires the X-Payg-Session header.',
    responses: {
        200: {
            description: 'Session status retrieved successfully',
            content: { 'application/json': { schema: sessionStatusResponseSchema } },
        },
        401: {
            description: 'Missing X-Payg-Session header',
            content: { 'application/json': { schema: errorResponseSchema } },
        },
        402: {
            description: 'Session exhausted, expired, or invalid',
            content: { 'application/json': { schema: z.object({ paymentRequired: z.literal(true), error: z.string() }) } },
        },
        404: {
            description: 'Session not found',
            content: { 'application/json': { schema: errorResponseSchema } },
        },
    },
});

const paygUsageRoute = createRoute({
    method: 'get',
    path: '/payg/usage',
    tags: ['PAYG', 'Billing'],
    summary: 'Get PAYG usage summary',
    description: 'Returns cumulative PAYG usage for a customer. ' +
        'Requires either an authenticated session with stripeCustomerId, or an explicit ' +
        'X-Stripe-Customer-Id request header.',
    responses: {
        200: {
            description: 'Usage summary retrieved successfully',
            content: { 'application/json': { schema: paygUsageResponseSchema } },
        },
        400: {
            description: 'Missing stripeCustomerId',
            content: { 'application/json': { schema: errorResponseSchema } },
        },
        503: {
            description: 'Database unavailable',
            content: { 'application/json': { schema: errorResponseSchema } },
        },
    },
});

const paygPricingRoute = createRoute({
    method: 'get',
    path: '/payg/pricing',
    tags: ['PAYG', 'Billing'],
    summary: 'Get current PAYG pricing',
    description: 'Returns current PAYG pricing and limits. Public — no authentication required. ' +
        'The Angular frontend pricing page fetches from this endpoint.',
    responses: {
        200: {
            description: 'Pricing information',
            content: { 'application/json': { schema: paygPricingResponseSchema } },
        },
    },
});

// ============================================================================
// Middleware application
// ============================================================================

paygRoutes.use('/payg/session/create', rateLimitMiddleware());
paygRoutes.use('/payg/session/create', requireAuthMiddleware());

paygRoutes.use('/payg/session/status', rateLimitMiddleware());
paygRoutes.use('/payg/session/status', paygSessionMiddleware());

paygRoutes.use('/payg/usage', rateLimitMiddleware());

// /payg/pricing is public — no auth middleware

// ============================================================================
// Route handlers
// ============================================================================

paygRoutes.openapi(createSessionRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    return handleCreateSession(c as any) as any;
});

paygRoutes.openapi(sessionStatusRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    return handleSessionStatus(c as any) as any;
});

paygRoutes.openapi(paygUsageRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    return handlePaygUsage(c as any) as any;
});

// Public — no auth middleware
paygRoutes.openapi(paygPricingRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    return handlePaygPricing(c as any) as any;
});

// ============================================================================
// Handler implementations
// ============================================================================

/**
 * POST /payg/session/create
 *
 * Creates a PAYG session for a customer. Upserts the PaygCustomer record
 * and generates a session token granting the requested number of API calls.
 *
 * TODO(billing-next-milestone): Verify Stripe payment intent before creating
 * session. The session should only be issued after a confirmed Stripe payment.
 * Reference: docs/billing/payg.md — PAYG session creation flow.
 *
 * @param c - Hono context.
 * @returns JSON response with session token and expiry.
 */
async function handleCreateSession(c: AppContext): Promise<Response> {
    const body = await c.req.json() as { stripeCustomerId?: string; requestsToPurchase?: number };

    // Resolve stripeCustomerId from body or X-Stripe-Customer-Id header
    const stripeCustomerId = body.stripeCustomerId ??
        c.req.header('X-Stripe-Customer-Id');

    if (!stripeCustomerId) {
        return JsonResponse.error(
            'Missing stripeCustomerId — provide it in the request body or X-Stripe-Customer-Id header',
            400,
        );
    }

    const prisma = c.get('prisma');
    if (!prisma) {
        return JsonResponse.error('Database unavailable', 503);
    }

    const requestsToPurchase = body.requestsToPurchase ?? DEFAULT_REQUESTS_PER_SESSION;

    // Upsert PaygCustomer — idempotent on repeated calls with same Stripe customer ID
    const customer = await prisma.paygCustomer.upsert({
        where: { stripeCustomerId },
        create: { stripeCustomerId },
        update: { lastSeenAt: new Date() },
    });

    // Generate a cryptographically strong opaque session token (32 bytes of entropy, hex-encoded)
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const sessionToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + DEFAULT_SESSION_TTL_MS);

    await prisma.paygSession.create({
        data: {
            paygCustomerId: customer.id,
            sessionToken,
            requestsGranted: requestsToPurchase,
            expiresAt,
        },
    });

    return c.json({
        success: true as const,
        sessionToken,
        requestsGranted: requestsToPurchase,
        expiresAt: expiresAt.toISOString(),
    });
}

/**
 * GET /payg/session/status
 *
 * Returns status of the active PAYG session identified by X-Payg-Session.
 * The `paygSessionMiddleware` applied above has already validated the session
 * and set X-Payg-Session-Remaining on the response — this handler only
 * needs to query and return the full session details.
 *
 * @param c - Hono context.
 * @returns JSON response with session usage details.
 */
async function handleSessionStatus(c: AppContext): Promise<Response> {
    const sessionToken = c.req.header('X-Payg-Session');
    if (!sessionToken) {
        return JsonResponse.error('Missing X-Payg-Session header', 401);
    }

    const prisma = c.get('prisma');
    if (!prisma) {
        return JsonResponse.error('Database unavailable', 503);
    }

    const session = await prisma.paygSession.findUnique({
        where: { sessionToken },
        select: {
            requestsGranted: true,
            requestsUsed: true,
            expiresAt: true,
        },
    });

    if (!session) {
        return JsonResponse.error('Session not found', 404);
    }

    return c.json({
        success: true as const,
        requestsGranted: session.requestsGranted,
        requestsUsed: session.requestsUsed,
        requestsRemaining: session.requestsGranted - session.requestsUsed,
        expiresAt: session.expiresAt.toISOString(),
    });
}

/**
 * GET /payg/usage
 *
 * Returns cumulative usage for a PAYG customer. Resolves the Stripe customer
 * ID from the X-Stripe-Customer-Id header (or, in a future iteration, from
 * the authenticated Better Auth session).
 *
 * @param c - Hono context.
 * @returns JSON response with cumulative usage and conversion eligibility.
 */
async function handlePaygUsage(c: AppContext): Promise<Response> {
    const stripeCustomerId = c.req.header('X-Stripe-Customer-Id');
    if (!stripeCustomerId) {
        return JsonResponse.error(
            'Missing X-Stripe-Customer-Id header. Provide the Stripe customer ID to query usage.',
            400,
        );
    }

    const prisma = c.get('prisma');
    if (!prisma) {
        return JsonResponse.error('Database unavailable', 503);
    }

    const customer = await prisma.paygCustomer.findUnique({
        where: { stripeCustomerId },
        select: {
            totalRequests: true,
            totalSpendUsdCents: true,
        },
    });

    if (!customer) {
        // New customer — return zeroes rather than 404 so clients can safely call on first use
        return c.json({
            success: true as const,
            totalRequests: 0,
            totalSpendUsdCents: 0,
            thisMonthRequests: 0,
            thisMonthSpendUsdCents: 0,
            conversionEligible: false,
            suggestedPlan: null,
        });
    }

    // Conversion eligibility: suggest Pro when spend is high enough to justify a subscription
    const conversionThresholdCents = parseInt(
        c.env.PAYG_CONVERSION_THRESHOLD_USD_CENTS ?? '2000',
        10,
    );
    const conversionEligible = customer.totalSpendUsdCents >= conversionThresholdCents;

    return c.json({
        success: true as const,
        totalRequests: customer.totalRequests,
        totalSpendUsdCents: customer.totalSpendUsdCents,
        // TODO(billing-next-milestone): Calculate per-month breakdown from PaygPaymentEvent rows
        thisMonthRequests: 0,
        thisMonthSpendUsdCents: 0,
        conversionEligible,
        suggestedPlan: conversionEligible ? 'pro' : null,
    });
}

/**
 * GET /payg/pricing
 *
 * Returns current PAYG pricing and limits. Public endpoint — no authentication
 * required. The Angular frontend pricing page fetches from here.
 *
 * @param c - Hono context.
 * @returns JSON response with pricing details and PAYG_TIER_LIMITS.
 */
function handlePaygPricing(c: AppContext): Response {
    const pricePerCallCents = (() => {
        const raw = c.env.PAYG_PRICE_PER_CALL_USD_CENTS;
        if (!raw) return 1;
        const parsed = parseInt(raw, 10);
        return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    })();

    return c.json({
        pricePerCallUsdCents: pricePerCallCents,
        includedRequestsPerSession: DEFAULT_REQUESTS_PER_SESSION,
        sessionTtlSeconds: DEFAULT_SESSION_TTL_MS / 1000,
        tierLimits: PAYG_TIER_LIMITS,
    });
}

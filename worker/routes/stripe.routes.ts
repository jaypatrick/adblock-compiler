/// <reference types="@cloudflare/workers-types" />

/**
 * Stripe webhook integration routes.
 *
 * Routes:
 *   POST /stripe/webhook          — Stripe webhook endpoint for subscription and PAYG payment events
 *   POST /stripe/payg/checkout    — Initiate a Stripe Checkout Session for PAYG
 *
 * ## Handled Webhook Events
 *   - `checkout.session.completed`      — PAYG: upsert PaygCustomer, issue PaygSession
 *   - `invoice.payment_succeeded`       — Subscription: update user/org tier
 *   - `payment_intent.succeeded`        — PAYG: record payment event
 *   - `customer.subscription.created`   — Subscription: stub (see TODO)
 *   - `customer.subscription.updated`   — Subscription: stub (see TODO)
 *   - `customer.subscription.deleted`   — Subscription: downgrade user/org to free
 *   - `customer.subscription.trial_will_end` — Subscription: stub (see TODO)
 *
 * ## Overview
 * This is a stub implementation ready for go-live. When Stripe is enabled:
 * 1. Update STRIPE_WEBHOOK_SECRET in wrangler.toml secrets
 * 2. Configure webhook endpoint in Stripe Dashboard to point to /api/stripe/webhook
 * 3. Implement actual subscription logic in handlers/stripe.ts
 *
 * ## Security
 * - HMAC signature verification (Stripe-Signature header)
 * - Request body size limited to 5MB
 * - Rate limiting applied
 * - All events logged to Analytics Engine
 *
 * @see docs/billing/stripe-setup.md — Stripe setup guide
 * @see docs/billing/payg.md — PAYG billing model
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import Stripe from 'stripe';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { StripeService } from '../services/stripe-service.ts';

export const stripeRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const stripeWebhookRequestSchema = z.object({
    id: z.string().describe('Stripe event ID'),
    object: z.literal('event'),
    type: z.string().describe('Event type (e.g., customer.subscription.created)'),
    data: z.object({
        object: z.record(z.string(), z.unknown()).describe('Event data object'),
    }),
    created: z.number().describe('Unix timestamp'),
    livemode: z.boolean().describe('Whether event is from live or test mode'),
});

const stripeWebhookResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    eventId: z.string().optional(),
});

const paygCheckoutRequestSchema = z.object({
    stripeCustomerId: z.string().optional().describe(
        'Existing Stripe Customer ID. When provided, the checkout session is attached to this customer.',
    ),
    requestsToPurchase: z.number().int().min(1).max(100).default(10).describe(
        'Number of API call credits to purchase.',
    ),
    successUrl: z.string().url().optional().describe('URL to redirect to after successful payment.'),
    cancelUrl: z.string().url().optional().describe('URL to redirect to if payment is cancelled.'),
});

const paygCheckoutResponseSchema = z.object({
    success: z.literal(true),
    checkoutUrl: z.string().describe('Stripe Checkout Session URL — redirect the customer here.'),
    sessionId: z.string().describe('Stripe Checkout Session ID.'),
});

// ── Routes ────────────────────────────────────────────────────────────────────

const stripeWebhookRoute = createRoute({
    method: 'post',
    path: '/stripe/webhook',
    tags: ['Stripe', 'Webhooks'],
    summary: 'Stripe webhook endpoint',
    description: 'Receives and processes Stripe subscription and PAYG payment webhook events.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: stripeWebhookRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Webhook processed successfully',
            content: {
                'application/json': {
                    schema: stripeWebhookResponseSchema,
                },
            },
        },
        400: {
            description: 'Invalid webhook payload or signature',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Internal server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

const paygCheckoutRoute = createRoute({
    method: 'post',
    path: '/stripe/payg/checkout',
    tags: ['Stripe', 'PAYG', 'Billing'],
    summary: 'Create a Stripe Checkout Session for PAYG',
    description: 'Creates a Stripe Checkout Session for Pay-As-You-Go API credits. ' +
        'Redirect the customer to the returned `checkoutUrl`. ' +
        'On completion, the Stripe webhook (checkout.session.completed) will issue a PaygSession. ' +
        'TODO(billing-next-milestone): Wire Stripe SDK to create the Checkout Session.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: paygCheckoutRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Checkout Session created — redirect customer to checkoutUrl.',
            content: { 'application/json': { schema: paygCheckoutResponseSchema } },
        },
        400: {
            description: 'Bad request — invalid body.',
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        500: {
            description: 'Internal server error.',
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
    },
});

stripeRoutes.use('/stripe/webhook', bodySizeMiddleware());
stripeRoutes.use('/stripe/webhook', rateLimitMiddleware());
stripeRoutes.openapi(stripeWebhookRoute, async (c) => {
    try {
        // Read raw body as text — Hono buffers this for re-reading; required for Stripe HMAC verification.
        const rawBody = await c.req.text();
        const sig = c.req.header('stripe-signature') ?? '';
        const secret = c.env.STRIPE_WEBHOOK_SECRET ?? '';

        if (!sig) {
            return c.json({ success: false as const, error: 'Missing Stripe-Signature header' }, 400);
        }
        if (!secret) {
            console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured');
            return c.json({ success: false as const, error: 'Webhook not configured' }, 500);
        }

        let event: Stripe.Event;
        try {
            const stripeService = new StripeService(c.env);
            event = await stripeService.constructWebhookEvent(rawBody, sig, secret);
        } catch (_err) {
            return c.json({ success: false as const, error: 'Invalid webhook signature' }, 400);
        }

        // Track webhook receipt in analytics
        const analytics = new AnalyticsService(c.env.ANALYTICS_ENGINE);
        analytics.trackSecurityEvent({
            event: 'stripe_webhook_received',
            eventId: event.id,
            eventType: event.type,
            livemode: event.livemode ? 'live' : 'test',
            requestId: c.get('requestId') ?? 'unknown',
        } as Record<string, string | number | boolean>);

        // Dispatch to StripeWebhookProcessor DO for idempotent processing
        if (c.env.STRIPE_WEBHOOK_PROCESSOR) {
            const doId = c.env.STRIPE_WEBHOOK_PROCESSOR.idFromName(event.id);
            const stub = c.env.STRIPE_WEBHOOK_PROCESSOR.get(doId);
            c.executionCtx.waitUntil(
                stub.fetch(
                    new Request('https://do/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(event),
                    }),
                ),
            );
        } else {
            console.warn('[Stripe Webhook] STRIPE_WEBHOOK_PROCESSOR binding not configured — event not dispatched');
        }

        return c.json({ success: true as const, message: 'Webhook received', eventId: event.id }, 200);
    } catch (err) {
        console.error('[Stripe Webhook] Unhandled error:', err);
        return c.json({ success: false as const, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
    }
    // deno-lint-ignore no-unreachable
    return c.json({ success: false as const, error: 'Unreachable' }, 500);
});

stripeRoutes.use('/stripe/payg/checkout', requireAuthMiddleware());
stripeRoutes.use('/stripe/payg/checkout', rateLimitMiddleware());
stripeRoutes.openapi(paygCheckoutRoute, async (c) => {
    try {
        const authCtx = c.get('authContext');
        if (!authCtx?.userId) {
            return c.json({ success: false as const, error: 'Authentication required' }, 400);
        }

        const body = c.req.valid('json');
        const priceId = c.env.STRIPE_PAYG_PRICE_ID;
        if (!priceId) {
            console.error('[Stripe PAYG Checkout] STRIPE_PAYG_PRICE_ID is not configured');
            return c.json({ success: false as const, error: 'PAYG pricing not configured' }, 500);
        }

        const stripeService = new StripeService(c.env);
        const customerId = body.stripeCustomerId ??
            await stripeService.getOrCreateCustomer(authCtx.userId, authCtx.email ?? '');

        const origin = c.req.header('origin') ?? 'https://app.bloqr.io';
        const successUrl = body.successUrl ?? `${origin}/dashboard?checkout=success`;
        const cancelUrl = body.cancelUrl ?? `${origin}/dashboard?checkout=cancelled`;

        const session = await stripeService.createCheckoutSession(
            customerId,
            priceId,
            'payment',
            successUrl,
            cancelUrl,
            { userId: authCtx.userId, requestsToPurchase: String(body.requestsToPurchase) },
        );

        if (!session.url) {
            return c.json({ success: false as const, error: 'Failed to create checkout session' }, 500);
        }

        return c.json({ success: true as const, checkoutUrl: session.url, sessionId: session.id }, 200);
    } catch (err) {
        console.error('[Stripe PAYG Checkout] Error creating checkout session:', err);
        return c.json({ success: false as const, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
    }
    // deno-lint-ignore no-unreachable
    return c.json({ success: false as const, error: 'Unreachable' }, 500);
});

// ── Deleted Stub Handlers — now replaced by StripeWebhookProcessor DO ─────────
//
// handleStripeWebhook, handleSubscriptionEvent, handleTrialEndingEvent,
// handleInvoiceEvent, handlePaygPaymentSucceeded, handleCheckoutEvent, handlePaygCheckout
// have been removed. Event processing lives in worker/durable-objects/StripeWebhookProcessor.ts.

// ── Placeholder to keep file parseable ───────────────────────────────────────

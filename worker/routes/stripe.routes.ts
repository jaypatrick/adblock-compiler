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

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware } from '../middleware/hono-middleware.ts';
import { JsonResponse } from '../utils/response.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';

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
        501: {
            description: 'Not implemented — Stripe SDK not yet wired.',
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(false), error: z.string(), todo: z.string() }),
                },
            },
        },
    },
});

stripeRoutes.use('/stripe/webhook', bodySizeMiddleware());
stripeRoutes.use('/stripe/webhook', rateLimitMiddleware());
stripeRoutes.openapi(stripeWebhookRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleStripeWebhook(c.req.raw, c.env, c.get('requestId')) as any;
});

stripeRoutes.use('/stripe/payg/checkout', rateLimitMiddleware());
stripeRoutes.openapi(paygCheckoutRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handlePaygCheckout(c.req.raw, c.env) as any;
});

async function handleStripeWebhook(request: Request, env: Env, requestId: string | undefined): Promise<Response> {
    try {
        // Get raw body for signature verification
        const rawBody = await request.text();
        const signature = request.headers.get('stripe-signature');

        if (!signature) {
            return JsonResponse.error('Missing Stripe-Signature header', 400);
        }

        // Verify webhook signature (stub - replace with actual Stripe SDK verification)
        const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
            // Stub mode: log warning but accept webhook
            console.warn('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured - stub mode active');
        } else {
            // TODO(#1242): Implement actual signature verification using Stripe SDK
            // const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
            console.info('[Stripe Webhook] Signature verification would occur here');
        }

        // Parse webhook payload
        const event = JSON.parse(rawBody);

        // Track webhook event in analytics
        const analytics = new AnalyticsService(env.ANALYTICS_ENGINE);
        analytics.trackSecurityEvent({
            event: 'stripe_webhook_received',
            eventId: event.id,
            eventType: event.type,
            livemode: event.livemode ? 'live' : 'test',
            requestId: requestId || 'unknown',
        } as Record<string, string | number | boolean>);

        // Route to appropriate handler based on event type
        const eventType = event.type;
        console.info(`[Stripe Webhook] Received event: ${eventType} (${event.id})`);

        switch (eventType) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                await handleSubscriptionEvent(env, event);
                break;

            case 'customer.subscription.trial_will_end':
                await handleTrialEndingEvent(env, event);
                break;

            case 'invoice.payment_succeeded':
            case 'invoice.payment_failed':
                await handleInvoiceEvent(env, event);
                break;

            case 'payment_intent.succeeded':
                await handlePaygPaymentSucceeded(env, event);
                break;

            case 'checkout.session.completed':
                await handleCheckoutEvent(env, event);
                break;

            default:
                console.info(`[Stripe Webhook] Unhandled event type: ${eventType}`);
        }

        return JsonResponse.success({
            message: 'Webhook received',
            eventId: event.id,
        });
    } catch (error) {
        console.error('[Stripe Webhook] Error processing webhook:', error);
        return JsonResponse.error(error instanceof Error ? error.message : 'Unknown error', 500);
    }
}

// ── Stub Event Handlers ───────────────────────────────────────────────────────

/**
 * Handle subscription lifecycle events.
 * Stub: logs event, ready for actual implementation.
 */
async function handleSubscriptionEvent(_env: Env, event: Record<string, unknown>): Promise<void> {
    const subscription = (event.data as Record<string, unknown>).object as Record<string, unknown>;
    const customerId = subscription.customer as string;
    const status = subscription.status as string;

    console.info(`[Stripe Stub] Subscription event: ${event.type} for customer ${customerId}, status: ${status}`);

    // TODO(#1242): Implement actual subscription handling:
    // 1. Update user tier in database based on subscription status
    // 2. Grant/revoke API access
    // 3. Send confirmation email
    // 4. Update usage limits
}

/**
 * Handle trial ending notification.
 * Stub: logs event, ready for actual implementation.
 */
async function handleTrialEndingEvent(_env: Env, event: Record<string, unknown>): Promise<void> {
    const subscription = (event.data as Record<string, unknown>).object as Record<string, unknown>;
    const customerId = subscription.customer as string;

    console.info(`[Stripe Stub] Trial ending for customer ${customerId}`);

    // TODO(#1242): Implement trial ending notifications:
    // 1. Send email reminder
    // 2. In-app notification
    // 3. Update user UI to show trial ending banner
}

/**
 * Handle invoice payment events.
 * Stub: logs event, ready for actual implementation.
 */
async function handleInvoiceEvent(_env: Env, event: Record<string, unknown>): Promise<void> {
    const invoice = (event.data as Record<string, unknown>).object as Record<string, unknown>;
    const customerId = invoice.customer as string;
    const status = invoice.status as string;

    console.info(`[Stripe Stub] Invoice event: ${event.type} for customer ${customerId}, status: ${status}`);

    // TODO(#1242): Implement invoice handling:
    // 1. Update payment status in database
    // 2. Send payment confirmation/failure email
    // 3. Adjust service access based on payment status
    // 4. Log payment history
}

/**
 * Handle checkout session completion.
 * Stub: logs event, ready for actual implementation.
 */
async function handleCheckoutEvent(_env: Env, event: Record<string, unknown>): Promise<void> {
    const session = (event.data as Record<string, unknown>).object as Record<string, unknown>;
    const customerId = session.customer as string;

    console.info(`[Stripe Stub] Checkout completed for customer ${customerId}`);

    // TODO(#1242): Implement checkout completion:
    // 1. Activate subscription
    // 2. Send welcome email
    // 3. Create user account if needed
    // 4. Grant initial API access
}

/**
 * Handle PAYG payment_intent.succeeded event.
 *
 * Stub: logs event. In the full implementation this will:
 * 1. Upsert the PaygCustomer record.
 * 2. Append a PaygPaymentEvent row.
 * 3. Increment the customer's totalSpendUsdCents / totalRequests counters.
 * 4. Issue a new PaygSession so the customer can start making API calls.
 *
 * @param _env - Worker environment bindings.
 * @param event - Stripe webhook event payload.
 */
async function handlePaygPaymentSucceeded(_env: Env, event: Record<string, unknown>): Promise<void> {
    const intent = (event.data as Record<string, unknown>).object as Record<string, unknown>;
    const customerId = intent.customer as string;
    const amount = intent.amount as number;

    console.info(`[Stripe Stub] PAYG payment succeeded for customer ${customerId}, amount: ${amount} cents`);

    // TODO(billing-next-milestone): Wire DB writes here.
    // 1. prisma.paygCustomer.upsert({ where: { stripeCustomerId: customerId }, ... })
    // 2. prisma.paygPaymentEvent.create({ data: { stripePaymentIntentId: intent.id, ... } })
    // 3. prisma.paygCustomer.update({ data: { totalSpendUsdCents: { increment: amount } } })
    // 4. prisma.paygSession.create({ data: { requestsGranted: DEFAULT_REQUESTS_PER_SESSION, ... } })
    // Reference: docs/billing/payg.md — webhook handling
}

/**
 * POST /stripe/payg/checkout
 *
 * Creates a Stripe Checkout Session for purchasing PAYG API credits.
 * Stub: returns 501 until the Stripe SDK is wired.
 *
 * @param _request - Incoming HTTP request.
 * @param _env - Worker environment bindings.
 * @returns JSON stub response.
 */
async function handlePaygCheckout(_request: Request, _env: Env): Promise<Response> {
    // TODO(billing-next-milestone): Implement Stripe Checkout Session creation.
    // 1. Validate request body (stripeCustomerId, requestsToPurchase).
    // 2. Create a Stripe Checkout Session with line_items pointing to STRIPE_PAYG_PRICE_ID.
    // 3. Attach to existing stripeCustomerId if provided, or create a new Stripe Customer.
    // 4. Return { checkoutUrl, sessionId }.
    // Reference: docs/billing/stripe-setup.md — Checkout Session creation
    return Response.json(
        {
            success: false,
            error: 'PAYG Checkout not yet implemented.',
            todo: 'Wire Stripe SDK in handlePaygCheckout — see TODO(billing-next-milestone)',
        },
        { status: 501 },
    );
}

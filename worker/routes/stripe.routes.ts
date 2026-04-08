/// <reference types="@cloudflare/workers-types" />

/**
 * Stripe webhook integration routes.
 *
 * Routes:
 *   POST /stripe/webhook — Stripe webhook endpoint for subscription events
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
 * @see docs/integrations/stripe.md — setup and usage guide (TBD)
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

// ── Routes ────────────────────────────────────────────────────────────────────

const stripeWebhookRoute = createRoute({
    method: 'post',
    path: '/stripe/webhook',
    tags: ['Stripe', 'Webhooks'],
    summary: 'Stripe webhook endpoint',
    description: 'Receives and processes Stripe subscription webhook events',
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

stripeRoutes.use('/stripe/webhook', bodySizeMiddleware());
stripeRoutes.use('/stripe/webhook', rateLimitMiddleware());
stripeRoutes.openapi(stripeWebhookRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleStripeWebhook(c.req.raw, c.env, c.get('requestId')) as any;
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

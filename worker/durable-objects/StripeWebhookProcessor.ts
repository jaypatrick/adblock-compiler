/// <reference types="@cloudflare/workers-types" />

/**
 * StripeWebhookProcessor Durable Object
 *
 * Processes Stripe webhook events with exactly-once delivery guarantees.
 * One instance is created per event ID, providing idempotency via DO storage.
 *
 * Handled events:
 *   - checkout.session.completed        — PAYG: upsert PaygCustomer
 *   - customer.subscription.created     — Subscription: update user tier
 *   - customer.subscription.updated     — Subscription: update user tier
 *   - customer.subscription.deleted     — Subscription: downgrade user to free
 *   - invoice.payment_succeeded         — Log payment success
 *   - invoice.payment_failed            — Log payment failure
 *
 * DO storage key pattern: `processed:<stripe_event_id>` → boolean
 */

import Stripe from 'stripe';
import type { Env } from '../types.ts';
import { UserTier } from '../types.ts';
import { createPrismaClient } from '../lib/prisma.ts';

// ─── Stripe Price → UserTier Mapping ──────────────────────────────────────────
//
// Map your Stripe price IDs to the corresponding UserTier.
// Populated from env vars at runtime via resolveUserTier().
// Example: STRIPE_PRO_PRICE_ID → UserTier.Pro

const STORAGE_KEY_PROCESSED = (eventId: string) => `processed:${eventId}`;

// ─── Tier Resolution ──────────────────────────────────────────────────────────

function resolveUserTierFromPriceId(priceId: string, env: Env): UserTier {
    // Check env var price ID mappings first
    if (env.STRIPE_PAYG_PRICE_ID && priceId === env.STRIPE_PAYG_PRICE_ID) {
        return UserTier.PayAsYouGo;
    }
    // Default to Pro for any active subscription without a matching price
    return UserTier.Pro;
}

function resolveUserTier(subscription: Stripe.Subscription, env: Env): UserTier {
    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
        return UserTier.Free;
    }
    for (const item of subscription.items.data) {
        const tier = resolveUserTierFromPriceId(item.price.id, env);
        if (tier !== UserTier.Pro) {
            // Non-default resolution — return specific tier
            return tier;
        }
    }
    // At least one item exists and maps to default Pro
    if (subscription.items.data.length > 0) {
        return UserTier.Pro;
    }
    return UserTier.Free;
}

// ─── Durable Object ──────────────────────────────────────────────────────────

export class StripeWebhookProcessor implements DurableObject {
    private readonly state: DurableObjectState;
    private readonly env: Env;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        let event: Stripe.Event;
        try {
            event = (await request.json()) as Stripe.Event;
        } catch {
            return new Response(JSON.stringify({ ok: false, error: 'Invalid event JSON' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return this.processEvent(event);
    }

    async processEvent(event: Stripe.Event): Promise<Response> {
        // Idempotency check — skip if already processed
        const alreadyProcessed = await this.state.storage.get<boolean>(STORAGE_KEY_PROCESSED(event.id));
        if (alreadyProcessed) {
            console.log(`[StripeWebhookProcessor] Duplicate event skipped: ${event.id} (${event.type})`);
            return new Response(JSON.stringify({ ok: true, duplicate: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                    break;
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
                    break;
                case 'customer.subscription.deleted':
                    await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
                    break;
                case 'invoice.payment_succeeded':
                    await this.onInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
                    break;
                case 'invoice.payment_failed':
                    await this.onInvoicePaymentFailed(event.data.object as Stripe.Invoice);
                    break;
                default:
                    console.log(`[StripeWebhookProcessor] Unhandled event type: ${event.type} (id=${event.id})`);
            }

            // Mark event as processed after successful handling
            await this.state.storage.put(STORAGE_KEY_PROCESSED(event.id), true);

            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (err) {
            console.error(`[StripeWebhookProcessor] Error processing event ${event.id} (${event.type}):`, err);
            return new Response(JSON.stringify({ ok: false, error: String(err) }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    // ─── Event Handlers ───────────────────────────────────────────────────────

    /**
     * Handles `checkout.session.completed`.
     *
     * For PAYG sessions (no subscription): upserts PaygCustomer with spend amount.
     * For subscription sessions: tier update will come via subscription.created/updated.
     */
    private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
        const customerId = session.customer as string | undefined;
        if (!customerId) {
            console.warn('[StripeWebhookProcessor] checkout.session.completed missing customer ID');
            return;
        }
        if (!this.env.HYPERDRIVE) {
            console.error('[StripeWebhookProcessor] HYPERDRIVE binding not available');
            return;
        }

        // Only process PAYG (one-time payment) sessions here
        if (!session.subscription) {
            const amountTotal = session.amount_total ?? 0;
            const prisma = createPrismaClient(this.env.HYPERDRIVE.connectionString);
            try {
                await prisma.paygCustomer.upsert({
                    where: { stripeCustomerId: customerId },
                    create: {
                        stripeCustomerId: customerId,
                        totalSpendUsdCents: amountTotal,
                        totalRequests: 0,
                    },
                    update: {
                        totalSpendUsdCents: { increment: amountTotal },
                    },
                });
                console.log(
                    `[StripeWebhookProcessor] PAYG customer upserted: ${customerId}, amount: ${amountTotal} cents`,
                );
            } finally {
                await prisma.$disconnect();
            }
        }
    }

    /**
     * Handles `customer.subscription.created` and `customer.subscription.updated`.
     *
     * Resolves the user tier from price IDs and updates User.tier.
     */
    private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
        const customerId = subscription.customer as string | undefined;
        if (!customerId) {
            console.warn('[StripeWebhookProcessor] subscription event missing customer ID');
            return;
        }
        if (!this.env.HYPERDRIVE) {
            console.error('[StripeWebhookProcessor] HYPERDRIVE binding not available');
            return;
        }

        const newTier = resolveUserTier(subscription, this.env);
        const prisma = createPrismaClient(this.env.HYPERDRIVE.connectionString);
        try {
            const result = await prisma.user.updateMany({
                where: { stripeCustomerId: customerId },
                data: { tier: newTier },
            });
            console.log(
                `[StripeWebhookProcessor] Subscription updated: customer=${customerId}, tier=${newTier}, updated ${result.count} user(s)`,
            );
        } finally {
            await prisma.$disconnect();
        }
    }

    /**
     * Handles `customer.subscription.deleted`.
     *
     * Downgrades the user to Free tier on subscription cancellation.
     */
    private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
        const customerId = subscription.customer as string | undefined;
        if (!customerId) {
            console.warn('[StripeWebhookProcessor] subscription.deleted missing customer ID');
            return;
        }
        if (!this.env.HYPERDRIVE) {
            console.error('[StripeWebhookProcessor] HYPERDRIVE binding not available');
            return;
        }

        const prisma = createPrismaClient(this.env.HYPERDRIVE.connectionString);
        try {
            const result = await prisma.user.updateMany({
                where: { stripeCustomerId: customerId },
                data: { tier: UserTier.Free },
            });
            console.log(
                `[StripeWebhookProcessor] Subscription deleted: customer=${customerId}, downgraded ${result.count} user(s) to free`,
            );
        } finally {
            await prisma.$disconnect();
        }
    }

    /**
     * Handles `invoice.payment_succeeded`.
     *
     * Currently only logs the event. Extended in future for usage-based billing.
     */
    private async onInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
        console.log(
            `[StripeWebhookProcessor] Invoice payment succeeded: customer=${invoice.customer}, amount=${invoice.amount_paid} cents`,
        );
    }

    /**
     * Handles `invoice.payment_failed`.
     *
     * Logs the failure. In production this should trigger notification logic.
     */
    private async onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
        console.error(
            `[StripeWebhookProcessor] Invoice payment FAILED: customer=${invoice.customer}, amount=${invoice.amount_due} cents`,
        );
    }
}

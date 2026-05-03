import Stripe from 'stripe';
import type { Env } from '../types.ts';

// ─── Stripe Client Factory ────────────────────────────────────────────────────
// IMPORTANT: Cloudflare Workers do not support Node.js `http` module. The
// Stripe SDK must be initialised with `Stripe.createFetchHttpClient()` so it
// uses the global `fetch` API available in the Workers runtime.

/**
 * Creates a Stripe client configured for use inside a Cloudflare Worker.
 *
 * The `Stripe.createFetchHttpClient()` call is mandatory — without it the SDK
 * would attempt to load Node's `http` module which is not available in the
 * Workers runtime.
 *
 * @throws {Error} When `env.STRIPE_SECRET_KEY` is not set.
 */
export function createStripeClient(env: Env): Stripe {
    if (!env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY is not configured — cannot create Stripe client');
    }
    return new Stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-02-24.acacia',
        httpClient: Stripe.createFetchHttpClient(),
    });
}

// ─── StripeService ────────────────────────────────────────────────────────────

/**
 * High-level Stripe service wrapper for the adblock-compiler Worker.
 *
 * All Stripe API calls MUST go through this class — it guarantees:
 * - Correct CF Workers HTTP client initialisation
 * - ZTA: key presence validated at construction, not at call time
 * - Consistent error propagation (callers receive `Stripe.errors.StripeError`)
 *
 * @example
 * ```typescript
 * const stripe = new StripeService(env);
 * const customerId = await stripe.getOrCreateCustomer(userId, email);
 * ```
 */
export class StripeService {
    private readonly stripe: Stripe;

    constructor(env: Env) {
        // ZTA: validate secret key before any API call is possible
        this.stripe = createStripeClient(env);
    }

    // ─── Customer Management ─────────────────────────────────────────────────

    /**
     * Returns an existing Stripe customer for the given Clerk user ID, or
     * creates a new one if none exists.
     *
     * Uses the `metadata.userId` field to find existing customers, which
     * allows idempotent re-runs without creating duplicates.
     *
     * @param userId - Clerk user ID (stored in customer metadata)
     * @param email  - User email address for display in Stripe dashboard
     * @returns The Stripe customer ID (e.g. `cus_xxx`)
     */
    async getOrCreateCustomer(userId: string, email: string): Promise<string> {
        const existing = await this.stripe.customers.search({
            query: `metadata['userId']:'${userId}'`,
            limit: 1,
        });
        if (existing.data.length > 0) {
            return existing.data[0].id;
        }
        const customer = await this.stripe.customers.create({
            email,
            metadata: { userId },
        });
        return customer.id;
    }

    // ─── Checkout ────────────────────────────────────────────────────────────

    /**
     * Creates a Stripe Checkout Session for a subscription or one-time payment.
     *
     * @param customerId       - Stripe customer ID (`cus_xxx`)
     * @param priceId          - Stripe price ID to charge (`price_xxx`)
     * @param mode             - `'subscription'` or `'payment'` (PAYG)
     * @param successUrl       - Redirect URL after successful payment
     * @param cancelUrl        - Redirect URL when user cancels
     * @param metadata         - Optional metadata attached to the session
     * @returns The created Checkout Session (use `session.url` to redirect the user)
     */
    async createCheckoutSession(
        customerId: string,
        priceId: string,
        mode: Stripe.Checkout.SessionCreateParams.Mode,
        successUrl: string,
        cancelUrl: string,
        metadata: Record<string, string> = {},
    ): Promise<Stripe.Checkout.Session> {
        return await this.stripe.checkout.sessions.create({
            customer: customerId,
            line_items: [{ price: priceId, quantity: 1 }],
            mode,
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata,
        });
    }

    // ─── Subscription Management ──────────────────────────────────────────────

    /**
     * Retrieves a Stripe Subscription by its ID, including the latest invoice.
     *
     * @param subscriptionId - Stripe subscription ID (`sub_xxx`)
     */
    async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        return await this.stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['latest_invoice'],
        });
    }

    // ─── Meter Events (PAYG Usage) ────────────────────────────────────────────

    /**
     * Reports a usage meter event to Stripe for PAYG billing.
     *
     * This maps directly to the Stripe Billing Meter API. The `eventName`
     * must match the meter event name configured in the Stripe dashboard.
     *
     * @param eventName        - Stripe meter event name (e.g. `'api_call'`)
     * @param stripeCustomerId - Stripe customer ID to associate the event with
     * @param value            - Number of units consumed (default: 1)
     */
    async reportMeterEvent(eventName: string, stripeCustomerId: string, value: number = 1): Promise<void> {
        await this.stripe.billing.meterEvents.create({
            event_name: eventName,
            payload: {
                stripe_customer_id: stripeCustomerId,
                value: String(value),
            },
        });
    }

    // ─── Webhook Verification ─────────────────────────────────────────────────

    /**
     * Verifies and constructs a `Stripe.Event` from a raw webhook body and
     * signature header.
     *
     * This method MUST be called before trusting any webhook payload. It uses
     * the signing secret configured in the Stripe dashboard for the endpoint.
     *
     * @param body      - Raw request body (must be the original string — do NOT parse as JSON first)
     * @param signature - Value of the `stripe-signature` HTTP header
     * @param secret    - Webhook signing secret (`whsec_xxx`) from the Stripe dashboard
     * @throws {Stripe.errors.StripeSignatureVerificationError} When signature is invalid
     */
    async constructWebhookEvent(body: string, signature: string, secret: string): Promise<Stripe.Event> {
        // constructEventAsync is the CF Workers–compatible variant (async, uses subtle crypto)
        return await this.stripe.webhooks.constructEventAsync(body, signature, secret);
    }
}

# Stripe Setup Guide

This guide covers setting up Stripe for both PAYG (Pay As You Go) and subscription billing.

---

## Prerequisites

- A [Stripe account](https://dashboard.stripe.com)
- Wrangler CLI installed (`npm install -g wrangler`)
- Access to the Cloudflare Workers dashboard

---

## 1. Create Stripe Products and Prices

### PAYG Price

1. In the Stripe Dashboard → **Products** → **Create product**.
2. Name: `PAYG API Call`
3. Pricing model: **Usage-based** or **One-time** (one-time recommended for simplicity).
4. Price: `$0.01` (1 cent) per call.
5. Copy the **Price ID** (e.g., `price_abc123`).

### Subscription Plans

Create one product per plan:

| Product Name | Monthly Price | Recommended ID |
|---|---|---|
| Pro | $29/month | `prod_pro_...` |
| Vendor | $149/month | `prod_vendor_...` |
| Enterprise | Custom | `prod_enterprise_...` |

---

## 2. Configure Environment Variables

### Local Development (`.dev.vars`)

Add to your `.dev.vars` file (copy from `.dev.vars.example`):

```ini
# Stripe — test keys from dashboard.stripe.com/test/apikeys
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # from step 3 below
STRIPE_PAYG_PRICE_ID=price_...    # PAYG price ID from step 1

# Optional overrides
PAYG_PRICE_PER_CALL_USD_CENTS=1
PAYG_CONVERSION_THRESHOLD_USD_CENTS=2000
```

### Production (Wrangler Secrets)

Secrets must be stored as Cloudflare Worker secrets (never in `wrangler.toml`):

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Non-secrets go in `wrangler.toml` `[vars]`:

```toml
[vars]
STRIPE_PUBLISHABLE_KEY = "pk_live_..."
STRIPE_PAYG_PRICE_ID   = "price_..."
PAYG_PRICE_PER_CALL_USD_CENTS = "1"
PAYG_CONVERSION_THRESHOLD_USD_CENTS = "2000"
```

---

## 3. Configure Stripe Webhooks

### Local Development

Use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks:

```bash
stripe login
stripe listen --forward-to http://localhost:8787/api/stripe/webhook
```

Copy the webhook signing secret printed by the CLI and add it to `.dev.vars`:

```ini
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Production

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://api.bloqr.dev/api/stripe/webhook`
3. Events to listen for:

```
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.trial_will_end
invoice.payment_succeeded
invoice.payment_failed
checkout.session.completed
payment_intent.succeeded
```

4. Copy the signing secret and set it as a Wrangler secret:

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
```

---

## 4. PAYG Checkout Flow

The PAYG Checkout flow is currently stubbed (`POST /api/stripe/payg/checkout` returns 501).

### Implementation Checklist (billing-next-milestone)

- [ ] Wire Stripe Node.js SDK in `handlePaygCheckout()` in `worker/routes/stripe.routes.ts`
- [ ] Create Stripe Checkout Session with `STRIPE_PAYG_PRICE_ID`
- [ ] Handle `checkout.session.completed` webhook to issue `PaygSession`
- [ ] Handle `payment_intent.succeeded` webhook in `handlePaygPaymentSucceeded()`

### Reference Implementation

```typescript
// worker/routes/stripe.routes.ts — handlePaygCheckout (TODO)
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: env.STRIPE_PAYG_PRICE_ID, quantity: requestsToPurchase }],
    customer: stripeCustomerId ?? undefined,
    success_url: successUrl ?? `${env.URL_FRONTEND}/payg/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl ?? `${env.URL_FRONTEND}/payg/cancel`,
});

return { checkoutUrl: session.url, sessionId: session.id };
```

---

## 5. Subscription Billing

### Checkout Flow

For subscription billing, create a Stripe Checkout Session with `mode: 'subscription'`.
This is separate from PAYG and handled by the subscription management system.

### Webhook Events

The webhook handler in `worker/routes/stripe.routes.ts` dispatches to:

- `handleSubscriptionEvent()` — `customer.subscription.*`
- `handleTrialEndingEvent()` — `customer.subscription.trial_will_end`
- `handleInvoiceEvent()` — `invoice.payment_*`
- `handleCheckoutEvent()` — `checkout.session.completed`
- `handlePaygPaymentSucceeded()` — `payment_intent.succeeded` (PAYG)

All are currently stubs with TODO comments for the full implementation.

---

## 6. Testing

### Test Cards

Use Stripe test cards in local development:

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Declined |
| `4000 0025 0000 3155` | 3D Secure required |

### Webhook Testing

```bash
# Trigger a test payment_intent.succeeded event
stripe trigger payment_intent.succeeded

# Trigger a test checkout.session.completed event
stripe trigger checkout.session.completed
```

---

## Related Documentation

- [Billing Overview](./README.md)
- [PAYG Developer Guide](./payg.md)

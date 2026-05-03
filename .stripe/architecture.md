# Stripe Architecture for Adblock Compiler

**Created**: May 3, 2026\
**Version**: 1.0\
**Status**: Architecture Proposal\
**Stripe API Version**: 2026-04-22.dahlia

---

## Executive Summary

Adblock Compiler is a **SaaS Compiler-as-a-Service** on Cloudflare Workers with a tiered subscription model (Free, Pro, Vendor, Enterprise) plus optional PAYG metering. This document outlines a secure, scalable Stripe integration using Cloudflare's native services for billing, webhook processing, and credential management.

### Key Integration Points

| Domain                     | Solution                               | Why                                                                  |
| -------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| **Subscriptions**          | Stripe Billing API + Checkout Sessions | Recurring subscription management with automatic renewals            |
| **Pay-As-You-Go Metering** | Stripe Billing Meter Events            | Usage-based billing for compilations beyond free tier limits         |
| **Webhook Processing**     | Cloudflare Durable Objects             | Durably process subscription events with retry semantics             |
| **Credential Storage**     | Cloudflare Worker Secrets              | Zero-trust secret management for Stripe API keys and webhook secrets |
| **State Management**       | Neon PostgreSQL via Hyperdrive         | Persistent user subscription state and billing history               |
| **Fraud Prevention**       | Stripe Radar + Zero Trust middleware   | Rate limiting + API key validation before Stripe calls               |

---

## Current Application State

### Subscription Model ✅ Defined

**Database**: `subscription_plans` table with 4 tiers

```typescript
// From prisma/schema.prisma
model SubscriptionPlan {
  id                   String   @id
  name                 String   @unique  // "free" | "pro" | "vendor" | "enterprise"
  displayName          String
  isOrgOnly            Boolean  // vendor/enterprise org-only
  maxApiKeysPerUser    Int      // tier-specific limits
  rateLimitPerMinute   Int
  maxFilterSources     Int
  maxCompiledOutputs   Int
  astStorageEnabled    Boolean
  translationEnabled   Boolean
  globalSharingEnabled Boolean
  batchApiEnabled      Boolean
  retentionDays        Int
}

// Users reference a plan
model User {
  planId               String?  @map("plan_id")
  tier                 String   @default("free")  // "free" | "pro" | "vendor" | "enterprise"
  stripeCustomerId     String?  @unique @map("stripe_customer_id")
  plan                 SubscriptionPlan? @relation(fields: [planId], references: [id])
}
```

### Tier Benefits (Proposed)

| Feature                  | Free | Pro ($29/mo) | Vendor ($99/mo) | Enterprise |
| ------------------------ | ---- | ------------ | --------------- | ---------- |
| **API Keys**             | 3    | 10           | 25              | Unlimited  |
| **Rate Limit (req/min)** | 60   | 600          | 2,000           | Custom     |
| **Filter Sources**       | 10   | 50           | 200             | Unlimited  |
| **Compiled Outputs**     | 50   | 500          | 2,000           | Unlimited  |
| **AST Storage**          | ❌   | ✅           | ✅              | ✅         |
| **Translations**         | ❌   | ❌           | ✅              | ✅         |
| **Global Sharing**       | ❌   | ❌           | ✅              | ✅         |
| **Batch API**            | ❌   | ✅           | ✅              | ✅         |
| **Data Retention**       | 90d  | 180d         | 365d            | Custom     |
| **Org Seats**            | N/A  | 5            | 20              | Custom     |
| **PAYG Overage**         | ❌   | 0.001/req    | 0.0005/req      | Custom     |

---

## Stripe Integration Architecture

### 1. Subscription Billing Flow

```
User → Checkout Page → Stripe Checkout → Success → Create Stripe Customer
                                              ↓
                                        webhook: customer.subscription.created
                                              ↓
                                        Durable Object (durably) processes
                                              ↓
                                        Update User.stripeCustomerId + planId
                                              ↓
                                        Update User.tier from plan
                                              ↓
                                        Emit analytics event
                                              ↓
                                        Worker hot path reads new tier
```

### 2. Webhook Processing with Durable Objects

**Reason**: Cloudflare Workers can't reliably retry HTTP calls across container boundaries. Durable Objects provide guaranteed-once semantics.

**Endpoint**: `POST /webhooks/stripe`

```typescript
// worker/routes/stripe.routes.ts
export const stripeRoutes = new OpenAPIHono<{ Bindings: Env }>()
    .post('/webhooks/stripe', async (c) => {
        const rawBody = await c.req.raw.text();
        const signature = c.req.header('stripe-signature');

        // Construct Stripe event with signature verification
        const event = stripe.webhooks.constructEvent(
            rawBody,
            signature,
            c.env.STRIPE_WEBHOOK_SECRET,
        );

        // Hand off to Durable Object for durable processing
        const durableObjectNamespace = c.env.STRIPE_WEBHOOK_PROCESSOR;
        const durableObjectId = durableObjectNamespace.idFromName('singleton');
        const durableObject = durableObjectNamespace.get(durableObjectId);

        const response = await durableObject.fetch('http://internal/process', {
            method: 'POST',
            body: JSON.stringify(event),
        });

        return c.json({ received: true });
    });
```

**Durable Object**: Reliable webhook processor

```typescript
// worker/durable-objects/StripeWebhookProcessor.ts
export class StripeWebhookProcessor {
    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request) {
        const event = await request.json();

        // Idempotency: store processed event ID
        const processedEventIds = await this.state.storage.get<Set<string>>(
            'processedEventIds',
        ) || new Set();

        if (processedEventIds.has(event.id)) {
            return new Response(JSON.stringify({ cached: true }));
        }

        try {
            // Handle specific event types
            switch (event.type) {
                case 'customer.subscription.created':
                    await this.handleSubscriptionCreated(event.data.object);
                    break;
                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdated(event.data.object);
                    break;
                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event.data.object);
                    break;
                case 'invoice.payment_succeeded':
                    await this.handleInvoicePaymentSucceeded(event.data.object);
                    break;
                case 'invoice.payment_failed':
                    await this.handleInvoicePaymentFailed(event.data.object);
                    break;
                case 'billing_meter.error_reported':
                    await this.handleMeterError(event.data.object);
                    break;
            }

            // Mark as processed
            processedEventIds.add(event.id);
            await this.state.storage.put('processedEventIds', processedEventIds);

            return new Response(JSON.stringify({ processed: true }));
        } catch (error) {
            // Log error, but don't throw — let Stripe retry
            console.error('Webhook processing error:', error);
            return new Response(
                JSON.stringify({ error: error.message }),
                { status: 500 },
            );
        }
    }

    private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
        const { customer, items, metadata } = subscription;

        // Fetch user by Stripe customer ID
        const user = await this.env.DATABASE_PROXY.query(
            'SELECT id, tier FROM users WHERE stripe_customer_id = ?',
            [customer as string],
        );

        if (!user) {
            // New customer — find by metadata.userId or email
            const userId = metadata?.userId;
            await this.env.DATABASE_PROXY.query(
                'UPDATE users SET stripe_customer_id = ?, plan_id = ?, tier = ? WHERE id = ?',
                [customer, items.data[0].price.lookup_key, this.tierFromPlan(items.data[0].price.lookup_key), userId],
            );
        }
    }

    private tierFromPlan(lookupKey: string): string {
        // Map Stripe lookup_key to tier
        return lookupKey.split('_')[0]; // "pro_monthly" → "pro"
    }
}
```

### 3. PAYG Metering (Usage-Based Billing)

**Scenario**: Pro users get 600 req/min. Each compilation counts as 1 request. Beyond that, charge $0.001/request.

**Implementation**:

1. **Create Billing Meters** in Stripe (one per event type):
   ```
   POST /v1/billing/meters
   {
     "display_name": "Compilations",
     "event_name": "compilation.executed",
     "default_aggregation": {
       "formula": "sum"
     }
   }
   ```

2. **Report usage events** from Worker:
   ```typescript
   // worker/handlers/compile.ts
   async function handleCompile(req: CompileRequest, user: User, env: Env) {
       const result = await compileFilterList(req);

       // Report usage to Stripe for PAYG billing
       if (user.stripeCustomerId) {
           await stripe.billing.meterEventAdjustments.create({
               event_name: 'compilation.executed',
               customer: user.stripeCustomerId,
               value: 1,
               timestamp: Math.floor(Date.now() / 1000),
           });
       }

       return result;
   }
   ```

3. **Attach meter to subscription**:
   ```typescript
   // In subscription creation flow
   const subscription = await stripe.subscriptions.create({
       customer: stripeCustomerId,
       items: [
           {
               price: 'price_1ABC...', // "pro_monthly"
           },
       ],
       usage_based_billing: {
           meter_config: {
               meter_id: 'meter_1XYZ...', // "compilations"
           },
       },
   });
   ```

---

## Cloudflare Infrastructure

### Secrets (Worker Secrets)

Store these in `wrangler.toml` or via `wrangler secret put`:

```toml
# wrangler.toml
[env.production]
vars = { ENVIRONMENT = "production" }

# Run: wrangler secret put STRIPE_SECRET_KEY
# Run: wrangler secret put STRIPE_PUBLISHABLE_KEY
# Run: wrangler secret put STRIPE_WEBHOOK_SECRET
# Run: wrangler secret put STRIPE_WEBHOOK_SIGNING_SECRET (for local testing)
```

Access in Worker:

```typescript
export interface Env {
    STRIPE_SECRET_KEY: string;
    STRIPE_PUBLISHABLE_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_WEBHOOK_PROCESSOR: DurableObjectNamespace<StripeWebhookProcessor>;
}
```

### Durable Objects

Define in `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "STRIPE_WEBHOOK_PROCESSOR"
class_name = "StripeWebhookProcessor"
script_name = "adblock-compiler-worker"

[[durable_objects.migrations]]
tag = "v1"
new_classes = ["StripeWebhookProcessor"]
```

### Database Bindings

```toml
[env.production]
# Hyperdrive binding to Neon PostgreSQL
[[hyperdrive]]
binding = "DATABASE_PROXY"
id = "your-hyperdrive-config-id"
```

---

## Security Architecture

### 1. Zero Trust Middleware

**Enforce auth before any Stripe operation**:

```typescript
// worker/middleware/auth.ts
export const verifyAuth = async (c: Context, next: () => Promise<void>) => {
    const authHeader = c.req.header('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const user = await verifyJWT(token, c.env.JWT_SECRET);
    if (!user) {
        return c.json({ error: 'Invalid token' }, 401);
    }

    c.set('user', user);
    await next();
};

// Apply to all Stripe routes
stripeRoutes.use(verifyAuth);
```

### 2. Webhook Signature Verification

**Every webhook is verified** using Stripe's signature header:

```typescript
const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    c.env.STRIPE_WEBHOOK_SECRET,
);
```

This prevents spoofed webhooks from modifying user subscription state.

### 3. PII Minimization

**Store minimal PII in Cloudflare**:

- ✅ `stripe_customer_id` (opaque identifier)
- ✅ `stripe_subscription_id` (opaque identifier)
- ❌ **Never store**: full name, billing address, card details in Cloudflare
- ✅ **Store in Stripe**: all sensitive customer data (email verified at Better Auth level)

### 4. Rate Limiting Enforcement

**Enforce user tier limits on API key usage**:

```typescript
// worker/middleware/rate-limit.ts
export const checkRateLimit = async (c: Context, next: () => Promise<void>) => {
    const apiKey = c.req.header('x-api-key');
    const user = await getUserByApiKey(apiKey);

    const subscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
    );

    const plan = subscription.items.data[0].plan.lookup_key; // "pro_monthly"
    const limits = await getPlanLimits(plan);

    // Check rate limit using Cloudflare Cache or Redis
    const requests = await c.env.CACHE.get(`ratelimit:${user.id}`);
    if (requests > limits.perMinute) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    await next();
};
```

---

## Data Flow Diagrams

### Subscription Creation

```
┌─────────────┐
│   Angular   │
│  Frontend   │
└──────┬──────┘
       │
       │ "Choose Plan"
       ▼
┌──────────────────────┐
│ Checkout Session     │
│ (Stripe-hosted)      │
│ - User selects plan  │
│ - Enters payment     │
└──────┬───────────────┘
       │
       │ Success redirect
       ▼
┌────────────────────────┐
│ Worker: /stripe/       │
│ checkout/success       │
│ - Get session ID       │
└──────┬─────────────────┘
       │
       │ Retrieve session
       ▼
┌────────────────────────┐
│ Stripe API             │
│ sessions.retrieve()    │
│ - Get customer ID      │
│ - Get subscription ID  │
└──────┬─────────────────┘
       │
       │ Update User
       ▼
┌────────────────────────┐
│ Neon (Hyperdrive)      │
│ UPDATE users SET       │
│  stripeCustomerId      │
│  planId, tier          │
└──────┬─────────────────┘
       │
       │ Webhook event
       ▼
┌────────────────────────┐
│ Stripe: customer.      │
│ subscription.created   │
└──────┬─────────────────┘
       │ POST webhook
       ▼
┌────────────────────────┐
│ Worker: /webhooks/     │
│ stripe                 │
│ - Verify signature     │
└──────┬─────────────────┘
       │ Hand off (durable)
       ▼
┌────────────────────────┐
│ Durable Object:        │
│ StripeWebhook         │
│ Processor              │
│ - Idempotent process  │
│ - Retry on error      │
└──────┬─────────────────┘
       │ Emit event
       ▼
┌────────────────────────┐
│ AnalyticsService       │
│ .trackUserUpgrade()    │
│ - Record conversion    │
│ - Send to PostHog      │
└────────────────────────┘
```

### PAYG Metering

```
┌──────────────────┐
│ User calls API   │
│ POST /compile    │
└────────┬─────────┘
         │
         ▼
┌──────────────────────┐
│ Worker validates     │
│ - JWT token         │
│ - Rate limit        │
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ Compile filter list  │
│ (Core business logic)│
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│ Report usage event   │
│ IF stripe_customer   │
│ billing.meter        │
│ .events.create()     │
└────────┬─────────────┘
         │ Async, don't block
         ▼
┌──────────────────────┐
│ Stripe collects      │
│ PAYG usage events    │
│ (batched)            │
└────────┬─────────────┘
         │ End of billing period
         ▼
┌──────────────────────┐
│ Stripe generates     │
│ invoice with PAYG    │
│ line item            │
└────────┬─────────────┘
         │ webhook: invoice.created
         ▼
┌──────────────────────┐
│ Durable Object       │
│ processes invoice    │
│ webhook              │
└──────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2) ✅

- [ ] Create Stripe account and configure test mode
- [ ] Add `stripe` npm package to `worker/package.json`
- [ ] Create `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` in `wrangler.toml`
- [ ] Create initial Stripe route handlers in `worker/routes/stripe.routes.ts`
- [ ] Implement webhook signature verification

### Phase 2: Subscriptions (Week 2-3)

- [ ] Create 4 products in Stripe (free, pro, vendor, enterprise)
- [ ] Create 4 price objects with monthly + annual billing
- [ ] Implement `POST /stripe/checkout/session` endpoint
- [ ] Implement `GET /stripe/checkout/success` redirect handler
- [ ] Implement `POST /stripe/customer/portal` (customer portal)

### Phase 3: Webhook Processing (Week 3-4)

- [ ] Create `StripeWebhookProcessor` Durable Object
- [ ] Register in `wrangler.toml` with migrations
- [ ] Implement event handlers:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- [ ] Add analytics tracking for subscription events

### Phase 4: PAYG Metering (Week 4-5)

- [ ] Create billing meter in Stripe (`compilation.executed`)
- [ ] Implement `POST /stripe/meter/events` endpoint
- [ ] Report usage from `POST /compile` handler
- [ ] Implement PAYG-specific analytics

### Phase 5: Frontend Integration (Week 5-6)

- [ ] Add "Plans" page to Angular frontend
- [ ] Implement Stripe.js for client-side handling
- [ ] Add subscription status widget to dashboard
- [ ] Add "Upgrade Plan" flow from tier-gated features

### Phase 6: Testing & Compliance (Week 6-7)

- [ ] Test all subscription flows in Stripe test mode
- [ ] Test webhook retry semantics
- [ ] Test PAYG metering accuracy
- [ ] Add integration tests for Stripe endpoints
- [ ] Review Stripe compliance checklist

### Phase 7: Go-Live Preparation (Week 7-8)

- [ ] Switch to Stripe production API keys
- [ ] Configure production webhook endpoint
- [ ] Test customer portal and subscription management
- [ ] Add monitoring and alerting for webhook failures
- [ ] Run Stripe compliance pre-launch review

---

## Monitoring & Observability

### Key Metrics to Track

```typescript
// src/services/AnalyticsService.ts

// Subscription events
analyticsService.trackEvent('subscription.created', {
    userId,
    plan: 'pro',
    price: 2900,
    currency: 'usd',
});

analyticsService.trackEvent('subscription.upgraded', {
    userId,
    fromPlan: 'free',
    toPlan: 'pro',
});

analyticsService.trackEvent('subscription.churned', {
    userId,
    plan: 'pro',
    monthsActive: 6,
});

// PAYG events
analyticsService.trackEvent('payg.usage', {
    userId,
    compilations: 1500,
    charge: 0.75, // 1500 * $0.0005
    plan: 'pro',
});

// Webhook events
analyticsService.trackEvent('webhook.processed', {
    eventId,
    eventType: 'customer.subscription.updated',
    durationMs: 245,
});

analyticsService.trackEvent('webhook.failed', {
    eventId,
    eventType: 'invoice.payment_failed',
    error,
    retryCount: 3,
});
```

### Cloudflare Analytics & Alarms

Use Cloudflare's built-in observability:

```toml
# wrangler.toml
[analytics_engine]
# Automatically collects:
# - Request count
# - Error rate
# - Worker CPU time
# - Cache hit/miss ratio
```

Query via Cloudflare Dashboard or GraphQL API.

---

## Cost Estimation

### Stripe Fees

| Component               | Volume           | Rate    | Monthly Cost |
| ----------------------- | ---------------- | ------- | ------------ |
| Subscription processing | 500 users × $29  | 2.9%    | $420         |
| PAYG metering           | 10M compilations | $0.0005 | $5,000       |
| Webhook calls           | 50K events       | free    | $0           |
| **Total**               |                  |         | **~$5,420**  |

### Cloudflare Costs

| Component          | Unit      | Rate           | Estimated Monthly |
| ------------------ | --------- | -------------- | ----------------- |
| Worker requests    | 1B req/mo | $0.5/M         | $500              |
| Durable Objects    | 1 class   | $0.15/GB-hour  | $100              |
| Hyperdrive         | Queries   | $0.05 per 100K | $50               |
| Storage (DO state) | 10GB      | $0.20/GB       | $2                |
| **Total**          |           |                | **~$652**         |

---

## Security Checklist

- [ ] All Stripe API calls use `env.STRIPE_SECRET_KEY` (never expose public key in Worker)
- [ ] Webhook signature verification is enabled and tested
- [ ] Durable Object state is encrypted in transit
- [ ] User authentication (JWT/Better Auth) is enforced before Stripe operations
- [ ] Rate limiting is applied per API key and user tier
- [ ] PII is minimized (only customer ID stored in Cloudflare)
- [ ] CORS is restricted to approved origins
- [ ] Webhook idempotency is implemented (no duplicate state updates)
- [ ] Expired subscriptions trigger downgrade to "free" tier
- [ ] API keys are rotated quarterly

---

## References

- [Stripe Billing API](https://stripe.com/docs/billing/quickstart)
- [Stripe Checkout Sessions](https://stripe.com/docs/payments/checkout)
- [Stripe Billing Meters (PAYG)](https://stripe.com/docs/billing/meter-events)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Go Live Checklist](https://stripe.com/docs/get-started/checklist/go-live)

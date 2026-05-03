# Stripe Implementation Guide

**Targeted at**: Developers implementing Stripe billing for Adblock Compiler\
**Prerequisite**: Read `.stripe/architecture.md` first

---

## Quick Start: Core Patterns

### 1. Stripe Client Setup

**File**: `worker/services/stripeService.ts`

```typescript
import Stripe from 'stripe';

/**
 * Factory for creating Stripe client with correct configuration.
 * Uses environment-injected API key for security.
 */
export function createStripeClient(apiKey: string): Stripe {
    return new Stripe(apiKey, {
        apiVersion: '2026-04-22.dahlia',
    });
}

/**
 * Service wrapper for Stripe operations.
 * Centralizes error handling and logging.
 */
export class StripeService {
    private stripe: Stripe;

    constructor(apiKey: string) {
        this.stripe = createStripeClient(apiKey);
    }

    async createCheckoutSession(input: {
        customerId?: string;
        priceId: string;
        successUrl: string;
        cancelUrl: string;
        userEmail?: string;
        metadata?: Record<string, string>;
    }): Promise<Stripe.Checkout.Session> {
        try {
            return await this.stripe.checkout.sessions.create({
                customer: input.customerId,
                customer_email: input.userEmail,
                line_items: [
                    {
                        price: input.priceId,
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: input.successUrl,
                cancel_url: input.cancelUrl,
                metadata: input.metadata,
                subscription_data: {
                    // Automatically apply discounts, tax rates, etc.
                    billing_cycle_anchor: Math.floor(Date.now() / 1000),
                },
            });
        } catch (error) {
            console.error('Failed to create checkout session:', error);
            throw new StripeError('Checkout session creation failed', error);
        }
    }

    async getCustomer(customerId: string): Promise<Stripe.Customer> {
        try {
            return await this.stripe.customers.retrieve(customerId);
        } catch (error) {
            console.error('Failed to retrieve customer:', error);
            throw new StripeError('Customer retrieval failed', error);
        }
    }

    async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        try {
            return await this.stripe.subscriptions.retrieve(subscriptionId);
        } catch (error) {
            console.error('Failed to retrieve subscription:', error);
            throw new StripeError('Subscription retrieval failed', error);
        }
    }

    async reportMeterEvent(input: {
        customerId: string;
        eventName: string;
        value: number;
        timestamp?: number;
    }): Promise<Stripe.Billing.MeterEventAdjustment> {
        try {
            return await this.stripe.billing.meterEventAdjustments.create({
                event_name: input.eventName,
                customer: input.customerId,
                value: input.value,
                timestamp: input.timestamp || Math.floor(Date.now() / 1000),
            });
        } catch (error) {
            console.error('Failed to report meter event:', error);
            throw new StripeError('Meter event reporting failed', error);
        }
    }
}

class StripeError extends Error {
    constructor(message: string, public cause: unknown) {
        super(message);
        this.name = 'StripeError';
    }
}
```

### 2. Checkout Session Route

**File**: `worker/routes/stripe.routes.ts`

```typescript
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { verifyAuth } from '../middleware/auth.ts';
import { StripeService } from '../services/stripeService.ts';
import { getPriceIdForPlan, getUserFromContext } from '../utils/billing.ts';

export const stripeRoutes = new OpenAPIHono<{ Bindings: Env }>()
    .use(verifyAuth)
    .openapi(
        createRoute({
            method: 'post',
            path: '/stripe/checkout/session',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                planId: z.enum(['pro_monthly', 'pro_annual', 'vendor_monthly', 'vendor_annual', 'enterprise']),
                            }),
                        },
                    },
                },
            },
            responses: {
                '200': {
                    description: 'Checkout session created',
                    content: {
                        'application/json': {
                            schema: z.object({
                                sessionId: z.string(),
                                url: z.string(),
                            }),
                        },
                    },
                },
            },
        }),
        async (c) => {
            const user = getUserFromContext(c);
            const { planId } = await c.req.json();

            const stripe = new StripeService(c.env.STRIPE_SECRET_KEY);

            // Get or create Stripe customer
            let customerId = user.stripeCustomerId;
            if (!customerId) {
                const customer = await stripe.stripe.customers.create({
                    email: user.email,
                    metadata: {
                        userId: user.id,
                    },
                });
                customerId = customer.id;
                // Update database with new customer ID
                await updateUserStripeCustomerId(user.id, customerId);
            }

            // Create checkout session
            const priceId = getPriceIdForPlan(planId);
            const session = await stripe.createCheckoutSession({
                customerId,
                priceId,
                successUrl: `${c.env.FRONTEND_URL}/dashboard?upgrade=success`,
                cancelUrl: `${c.env.FRONTEND_URL}/plans`,
                metadata: {
                    userId: user.id,
                    planId,
                },
            });

            return c.json({
                sessionId: session.id,
                url: session.url,
            });
        },
    )
    .openapi(
        createRoute({
            method: 'get',
            path: '/stripe/checkout/success',
            request: {
                query: z.object({
                    session_id: z.string(),
                }),
            },
            responses: {
                '200': {
                    description: 'Checkout completed',
                    content: {
                        'application/json': {
                            schema: z.object({
                                status: z.literal('completed'),
                            }),
                        },
                    },
                },
            },
        }),
        async (c) => {
            const sessionId = c.req.query('session_id');
            const user = getUserFromContext(c);

            const stripe = new StripeService(c.env.STRIPE_SECRET_KEY);
            const session = await stripe.stripe.checkout.sessions.retrieve(sessionId);

            // Verify session belongs to this user
            if (session.metadata?.userId !== user.id) {
                return c.json({ error: 'Unauthorized' }, 401);
            }

            // Session processed by webhook, but we can confirm here for UX
            // In production, the Durable Object webhook handler has already updated the DB

            return c.json({ status: 'completed' });
        },
    );
```

### 3. Webhook Processing with Durable Objects

**File**: `worker/durable-objects/StripeWebhookProcessor.ts`

```typescript
import Stripe from 'stripe';

/**
 * Durable Object for reliably processing Stripe webhooks.
 * - Guarantees at-least-once processing (idempotent)
 * - Retries failed webhook handlers
 * - Stores processed event IDs in persistent storage
 */
export class StripeWebhookProcessor {
    private state: DurableObjectState;
    private env: Env;
    private stripe: Stripe;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
        this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
            apiVersion: '2026-04-22.dahlia',
        });
    }

    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        try {
            const event = (await request.json()) as Stripe.Event;

            // Idempotency: Check if already processed
            const processedIds = await this.getProcessedEventIds();
            if (processedIds.has(event.id)) {
                console.log(`Event ${event.id} already processed (cached)`);
                return new Response(JSON.stringify({ cached: true }));
            }

            // Dispatch to handler
            const handler = this.getEventHandler(event.type);
            if (!handler) {
                console.warn(`No handler for event type: ${event.type}`);
                return new Response(JSON.stringify({ skipped: true }));
            }

            // Execute handler with retry logic
            await this.executeWithRetry(async () => {
                await handler.call(this, event);
            });

            // Mark as processed
            await this.markEventProcessed(event.id);

            return new Response(JSON.stringify({ processed: true }));
        } catch (error) {
            console.error('Webhook processing failed:', error);
            // Return 500 to signal Stripe to retry
            return new Response(
                JSON.stringify({ error: String(error) }),
                { status: 500 },
            );
        }
    }

    private getEventHandler(
        eventType: string,
    ): ((event: Stripe.Event) => Promise<void>) | null {
        const handlers: Record<string, (event: Stripe.Event) => Promise<void>> = {
            'customer.subscription.created': this.handleSubscriptionCreated.bind(this),
            'customer.subscription.updated': this.handleSubscriptionUpdated.bind(this),
            'customer.subscription.deleted': this.handleSubscriptionDeleted.bind(this),
            'invoice.payment_succeeded': this.handleInvoicePaymentSucceeded.bind(this),
            'invoice.payment_failed': this.handleInvoicePaymentFailed.bind(this),
            'billing_meter.error_reported': this.handleMeterError.bind(this),
        };

        return handlers[eventType] || null;
    }

    private async handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
        const subscription = event.data.object as Stripe.Subscription;

        const plan = subscription.items.data[0].plan.lookup_key || 'free';
        const tier = plan.split('_')[0];

        // Update user in database
        await this.updateUserSubscription({
            stripeCustomerId: subscription.customer as string,
            stripeSubscriptionId: subscription.id,
            tier,
            planId: plan,
        });

        // Track event for analytics
        await this.trackEvent('subscription.created', {
            stripeCustomerId: subscription.customer as string,
            plan,
            amount: subscription.items.data[0].plan.amount,
            currency: subscription.items.data[0].plan.currency,
        });
    }

    private async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
        const subscription = event.data.object as Stripe.Subscription;
        const previousAttributes = event.data.previous_attributes as Record<string, unknown>;

        // Only process if items changed (new plan)
        if (!previousAttributes?.items) {
            return;
        }

        const newPlan = subscription.items.data[0].plan.lookup_key || 'free';
        const newTier = newPlan.split('_')[0];
        const oldPlan = (previousAttributes.items as any)?.data?.[0]?.plan?.lookup_key || 'free';
        const oldTier = oldPlan.split('_')[0];

        // Determine if upgrade or downgrade
        const tierOrder = { free: 0, pro: 1, vendor: 2, enterprise: 3 };
        const isUpgrade = tierOrder[newTier] > tierOrder[oldTier];

        // Update user
        await this.updateUserSubscription({
            stripeCustomerId: subscription.customer as string,
            tier: newTier,
            planId: newPlan,
        });

        // Track upgrade/downgrade
        await this.trackEvent(isUpgrade ? 'subscription.upgraded' : 'subscription.downgraded', {
            stripeCustomerId: subscription.customer as string,
            fromPlan: oldPlan,
            toPlan: newPlan,
        });
    }

    private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
        const subscription = event.data.object as Stripe.Subscription;

        // Downgrade user to free tier
        await this.updateUserSubscription({
            stripeCustomerId: subscription.customer as string,
            tier: 'free',
            planId: 'free',
            stripeSubscriptionId: null,
        });

        await this.trackEvent('subscription.cancelled', {
            stripeCustomerId: subscription.customer as string,
        });
    }

    private async handleInvoicePaymentSucceeded(
        event: Stripe.Event,
    ): Promise<void> {
        const invoice = event.data.object as Stripe.Invoice;

        // Record payment in database for audit trail
        await this.recordInvoicePayment({
            stripeInvoiceId: invoice.id,
            stripeCustomerId: invoice.customer as string,
            amount: invoice.amount_paid,
            currency: invoice.currency,
            paidAt: new Date(invoice.paid_date * 1000),
        });

        await this.trackEvent('invoice.payment_succeeded', {
            stripeCustomerId: invoice.customer as string,
            stripeInvoiceId: invoice.id,
            amount: invoice.amount_paid,
        });
    }

    private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
        const invoice = event.data.object as Stripe.Invoice;

        // Alert user of payment failure
        await this.notifyPaymentFailure({
            stripeCustomerId: invoice.customer as string,
            stripeInvoiceId: invoice.id,
            amountDue: invoice.amount_due,
            dueDate: new Date(invoice.due_date * 1000),
        });

        await this.trackEvent('invoice.payment_failed', {
            stripeCustomerId: invoice.customer as string,
            stripeInvoiceId: invoice.id,
        });
    }

    private async handleMeterError(event: Stripe.Event): Promise<void> {
        const error = event.data.object as any;

        console.error('Billing meter error:', error);

        await this.trackEvent('meter.error', {
            meterId: error.meter_id,
            error: error.message,
        });
    }

    // Helper Methods

    private async getProcessedEventIds(): Promise<Set<string>> {
        const stored = await this.state.storage.get<string[]>('processedEventIds');
        return new Set(stored || []);
    }

    private async markEventProcessed(eventId: string): Promise<void> {
        const ids = await this.getProcessedEventIds();
        ids.add(eventId);
        await this.state.storage.put('processedEventIds', Array.from(ids));
    }

    private async executeWithRetry(
        fn: () => Promise<void>,
        maxRetries = 3,
    ): Promise<void> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await fn();
                return;
            } catch (error) {
                if (attempt === maxRetries) throw error;
                const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    private async updateUserSubscription(data: {
        stripeCustomerId: string;
        tier: string;
        planId: string;
        stripeSubscriptionId?: string | null;
    }): Promise<void> {
        // Call database proxy via Hyperdrive
        const response = await fetch('http://DATABASE_PROXY/api/users/subscription', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`Failed to update user subscription: ${response.statusText}`);
        }
    }

    private async recordInvoicePayment(data: Record<string, unknown>): Promise<void> {
        // Record in database for audit trail
        // Implementation depends on your database schema
    }

    private async notifyPaymentFailure(data: Record<string, unknown>): Promise<void> {
        // Send email notification to user
        // Use SendGrid, AWS SES, or Mailgun
    }

    private async trackEvent(eventName: string, data: Record<string, unknown>): Promise<void> {
        // Send to analytics service (PostHog, Amplitude, etc.)
        // This is non-blocking, so we don't await it
        this.env.ANALYTICS_SERVICE.trackEvent(eventName, data).catch((error) => {
            console.error('Analytics tracking failed:', error);
        });
    }
}
```

### 4. Report Usage from Compile Endpoint

**File**: `worker/handlers/compile.ts`

```typescript
import { CompileRequest } from '../types.ts';
import { StripeService } from '../services/stripeService.ts';

/**
 * Main compile endpoint.
 * - Validates user auth and rate limits
 * - Compiles filter lists
 * - Reports usage to Stripe for PAYG billing
 */
export async function handleCompile(
    request: CompileRequest,
    user: User,
    env: Env,
): Promise<CompileResult> {
    // Validate rate limit before processing
    await checkUserRateLimit(user, env);

    // Compile the filter list
    const result = await compileFilterList(request);

    // Report usage to Stripe (fire-and-forget)
    if (user.stripeCustomerId) {
        reportUsageAsync(user.stripeCustomerId, 1, env).catch((error) => {
            console.error('Failed to report usage to Stripe:', error);
            // Don't block the response on analytics failures
        });
    }

    return result;
}

/**
 * Report usage asynchronously (non-blocking).
 * Wrapped in a Promise but not awaited in the handler.
 */
async function reportUsageAsync(
    customerId: string,
    compilations: number,
    env: Env,
): Promise<void> {
    const stripe = new StripeService(env.STRIPE_SECRET_KEY);

    try {
        await stripe.reportMeterEvent({
            customerId,
            eventName: 'compilation.executed',
            value: compilations,
        });
    } catch (error) {
        console.error('Stripe meter event failed:', error);
        throw error;
    }
}
```

### 5. Webhook Signature Verification

**File**: `worker/routes/stripe.routes.ts` (webhook endpoint)

```typescript
stripeRoutes
    .post('/webhooks/stripe', async (c) => {
        const signature = c.req.header('stripe-signature');
        const rawBody = await c.req.raw.text();

        if (!signature) {
            return c.json({ error: 'Missing signature' }, 401);
        }

        let event: Stripe.Event;
        try {
            // Verify signature and construct event
            const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
                apiVersion: '2026-04-22.dahlia',
            });

            event = stripe.webhooks.constructEvent(
                rawBody,
                signature,
                c.env.STRIPE_WEBHOOK_SECRET,
            );
        } catch (error) {
            console.error('Webhook signature verification failed:', error);
            return c.json({ error: 'Invalid signature' }, 401);
        }

        // Hand off to Durable Object for processing
        const durableObjectId = c.env.STRIPE_WEBHOOK_PROCESSOR.idFromName('singleton');
        const durableObject = c.env.STRIPE_WEBHOOK_PROCESSOR.get(durableObjectId);

        try {
            await durableObject.fetch('http://internal/process-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
            });
        } catch (error) {
            console.error('Durable Object call failed:', error);
            // Return 500 to signal Stripe to retry
            return c.json({ error: 'Processing failed' }, 500);
        }

        // Return 200 immediately to acknowledge receipt
        return c.json({ received: true });
    });
```

---

## Testing Patterns

### Unit Test: Stripe Service

**File**: `worker/services/stripeService.test.ts`

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from './stripeService.ts';

describe('StripeService', () => {
    let stripeService: StripeService;

    beforeEach(() => {
        stripeService = new StripeService('sk_test_...');
    });

    it('should create checkout session', async () => {
        const session = await stripeService.createCheckoutSession({
            priceId: 'price_test_...',
            successUrl: 'https://example.com/success',
            cancelUrl: 'https://example.com/cancel',
            metadata: { userId: 'user_123' },
        });

        expect(session.id).toBeDefined();
        expect(session.url).toBeDefined();
    });

    it('should report meter event', async () => {
        const adjustment = await stripeService.reportMeterEvent({
            customerId: 'cus_test_...',
            eventName: 'compilation.executed',
            value: 10,
        });

        expect(adjustment.id).toBeDefined();
    });
});
```

### Integration Test: Webhook Processing

**File**: `worker/durable-objects/StripeWebhookProcessor.test.ts`

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { StripeWebhookProcessor } from './StripeWebhookProcessor.ts';

describe('StripeWebhookProcessor', () => {
    let processor: StripeWebhookProcessor;
    let mockState: any;
    let mockEnv: any;

    beforeEach(() => {
        mockState = {
            storage: {
                get: vi.fn().mockResolvedValue([]),
                put: vi.fn().mockResolvedValue(undefined),
            },
        };

        mockEnv = {
            STRIPE_SECRET_KEY: 'sk_test_...',
            DATABASE_PROXY: {},
        };

        processor = new StripeWebhookProcessor(mockState, mockEnv);
    });

    it('should idempotently process events', async () => {
        const event = {
            id: 'evt_test_123',
            type: 'customer.subscription.created',
            data: {
                object: {
                    id: 'sub_test_...',
                    customer: 'cus_test_...',
                },
            },
        };

        // First call processes the event
        const response1 = await processor.fetch(
            new Request('http://internal', {
                method: 'POST',
                body: JSON.stringify(event),
            }),
        );

        expect(response1.ok).toBe(true);
        const data1 = await response1.json();
        expect(data1.processed).toBe(true);

        // Second call hits the cache
        mockState.storage.get = vi.fn().mockResolvedValue(['evt_test_123']);

        const response2 = await processor.fetch(
            new Request('http://internal', {
                method: 'POST',
                body: JSON.stringify(event),
            }),
        );

        expect(response2.ok).toBe(true);
        const data2 = await response2.json();
        expect(data2.cached).toBe(true);
    });
});
```

---

## Environment Configuration

### wrangler.toml Setup

```toml
# wrangler.toml

name = "adblock-compiler-worker"

[env.development]
routes = [{ pattern = "api.localhost.test/*", zone_name = "localhost" }]
vars = {
  ENVIRONMENT = "development",
  STRIPE_PUBLISHABLE_KEY = "pk_test_...",
  FRONTEND_URL = "http://localhost:4200",
}

[env.development.durable_objects]
bindings = [
  {
    name = "STRIPE_WEBHOOK_PROCESSOR",
    class_name = "StripeWebhookProcessor",
    script_name = "adblock-compiler-worker"
  }
]

[env.production]
routes = [{ pattern = "api.example.com/*", zone_name = "example.com" }]
vars = {
  ENVIRONMENT = "production",
  STRIPE_PUBLISHABLE_KEY = "pk_live_...",
  FRONTEND_URL = "https://example.com",
}

[env.production.durable_objects]
bindings = [
  {
    name = "STRIPE_WEBHOOK_PROCESSOR",
    class_name = "StripeWebhookProcessor",
    script_name = "adblock-compiler-worker"
  }
]

# Secrets (set via: wrangler secret put STRIPE_SECRET_KEY --env production)
# - STRIPE_SECRET_KEY (sk_test_... or sk_live_...)
# - STRIPE_WEBHOOK_SECRET (whsec_test_... or whsec_live_...)
# - JWT_SECRET (for Better Auth)

# Bindings
[env.production.hyperdrive]
binding = "DATABASE_PROXY"
id = "your-hyperdrive-id"

[[durable_objects.migrations]]
tag = "v1"
new_classes = ["StripeWebhookProcessor"]
```

### Secrets Setup

```bash
# Development
wrangler secret put STRIPE_SECRET_KEY --env development
# Value: sk_test_4eC39HqLyjWDarhtT657L51Ee

wrangler secret put STRIPE_WEBHOOK_SECRET --env development
# Value: whsec_test_1234567890

# Production
wrangler secret put STRIPE_SECRET_KEY --env production
# Value: sk_live_xxx (never commit this!)

wrangler secret put STRIPE_WEBHOOK_SECRET --env production
# Value: whsec_live_yyy
```

---

## Error Handling Best Practices

```typescript
// Don't swallow errors silently
// ❌ BAD
try {
    await stripe.customers.create({ email });
} catch {
    console.log('error'); // Vague, loses context
}

// ✅ GOOD
try {
    await stripe.customers.create({ email });
} catch (error) {
    console.error('Failed to create Stripe customer for email:', email, error);
    throw new BillingError(
        `Stripe customer creation failed: ${error.message}`,
        { cause: error, email },
    );
}

// Custom error class for better error handling
class BillingError extends Error {
    constructor(
        message: string,
        public context: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'BillingError';
    }
}
```

---

## Monitoring Queries

### Useful Metrics to Track

```typescript
// In AnalyticsService
trackEvent('checkout.initiated', {
    planId: 'pro_monthly',
    userId,
    timestamp: new Date().toISOString(),
});

trackEvent('checkout.completed', {
    planId: 'pro_monthly',
    userId,
    sessionId,
    revenue: 2900, // in cents
    timestamp: new Date().toISOString(),
});

trackEvent('subscription.event', {
    type: 'created' | 'updated' | 'deleted' | 'trial_will_end',
    planId,
    userId,
    timestamp: new Date().toISOString(),
});
```

### CloudflareAnalytics Queries

```javascript
// Query via GraphQL (Cloudflare Dashboard → GraphQL)
query {
  viewer {
    zones(filter: { names: ["example.com"] }) {
      httpRequests1dGroups(
        filter: { clientRequestPath: "/stripe/*" }
        limit: 100
      ) {
        dimensions {
          date
        }
        sum {
          requests
          errors
        }
        quantiles {
          cpuTimeMs
        }
      }
    }
  }
}
```

---

## References

- [Stripe Node SDK](https://github.com/stripe/stripe-node)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Billing Meters (PAYG)](https://stripe.com/docs/billing/meter-events/overview)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)
- [Stripe Go Live Checklist](https://stripe.com/docs/get-started/checklist/go-live)

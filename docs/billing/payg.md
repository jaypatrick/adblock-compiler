# Pay As You Go (PAYG) — Developer Guide

PAYG lets any developer make API calls without creating an account or subscribing.
You pay $0.01 per call (configurable) and receive a session token granting 10 requests.

---

## Quick Start

### 1. Check the current pricing

```bash
curl https://api.bloqr.jaysonknight.com/api/payg/pricing
```

Response:
```json
{
  "pricePerCallUsdCents": 1,
  "includedRequestsPerSession": 10,
  "sessionTtlSeconds": 3600,
  "tierLimits": { ... }
}
```

### 2. Purchase a session

Visit the PAYG Checkout page (returned as `checkoutUrl` from `/api/stripe/payg/checkout`),
complete payment with your card, and receive a `X-Payg-Session` token.

```bash
curl -X POST https://api.bloqr.jaysonknight.com/api/stripe/payg/checkout \
  -H 'Content-Type: application/json' \
  -d '{ "requestsToPurchase": 10 }'
```

### 3. Use your session token

Include the `X-Payg-Session` header on every API request:

```bash
curl https://api.bloqr.jaysonknight.com/api/compile \
  -H 'X-Payg-Session: <your-session-token>' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```

The response includes `X-Payg-Session-Remaining` so you know how many calls remain:

```
X-Payg-Session-Remaining: 9
```

### 4. Check your usage

```bash
curl https://api.bloqr.jaysonknight.com/api/payg/usage \
  -H 'X-Stripe-Customer-Id: cus_...'
```

---

## x402 Protocol

Endpoints protected by `paygMiddleware()` follow the [x402 protocol](https://x402.org):

1. **Without a session**: Server returns `402 Payment Required` with:
   - Body: human-readable JSON describing pricing.
   - `X-Payment-Required` header: machine-readable payment specification.

2. **With a valid session**: Request proceeds normally. Response includes
   `X-Payg-Session-Remaining`.

3. **With an exhausted/expired session**: Server returns `402 Payment Required`
   prompting the client to purchase a new session.

### Payment Specification (X-Payment-Required)

```json
{
  "version": "2",
  "scheme": "exact",
  "network": "stripe",
  "maxAmountRequired": "1",
  "resource": "payg_per_call",
  "description": "Pay As You Go — $0.01 per API call",
  "mimeType": "application/json",
  "outputSchema": null,
  "extra": {
    "stripePublishableKey": "pk_live_...",
    "checkoutUrl": "/api/stripe/payg/checkout",
    "sessionRequestsGranted": 10,
    "sessionTtlSeconds": 3600
  }
}
```

---

## PAYG Limits

All limits are defined in `PAYG_TIER_LIMITS` in `worker/types.ts` and exposed
at `/api/payg/pricing`.

| Limit | Value |
|---|---|
| Requests per minute | 120 |
| Requests per day | 500 |
| Max rules per list | 50,000 |
| Max sources per compile | 5 |
| Max list size | 5 MB |
| Max concurrent jobs | 2 |
| Queue timeout | 30 seconds |
| Output retention | 7 days |
| Max stored outputs | 10 |

### Disabled Features

The following features are disabled for PAYG customers and require a subscription:

- AST storage
- Translation
- Global sharing
- Batch API
- Webhooks
- Version history
- CDN distribution

---

## Conversion to Subscription

When a PAYG customer's cumulative spend exceeds `PAYG_CONVERSION_THRESHOLD_USD_CENTS`
(default $20), the API sets a `conversionEligible: true` flag in usage responses and
route handlers can surface an upsell prompt.

`paygConversionCheckMiddleware()` handles this non-blocking check automatically.

---

## Session Lifecycle

```
[Purchase] → PaygCustomer upserted → PaygSession created
                                      requestsGranted = 10
                                      expiresAt = now + 1h
                                      revokedAt = null

[API call with valid session] → requestsUsed++
                                X-Payg-Session-Remaining: n

[Session exhausted] → requestsUsed >= requestsGranted → 402

[Session expired]   → expiresAt < now → 402

[Session revoked]   → revokedAt != null → 402
```

---

## Database Models

### PaygCustomer

Stores the Stripe customer record. Created on first PAYG payment; no account required.

```
id               UUID  (PK)
stripeCustomerId TEXT  (unique)
totalSpendUsdCents INT
totalRequests    INT
firstSeenAt      TIMESTAMPTZ
lastSeenAt       TIMESTAMPTZ
convertedAt      TIMESTAMPTZ?  (set when customer subscribes)
convertedUserId  UUID?
```

### PaygPaymentEvent

Append-only audit log. Never delete rows.

```
id                     UUID (PK)
paygCustomerId         UUID → payg_customers
stripePaymentIntentId  TEXT (unique)
amountUsdCents         INT
endpoint               TEXT
requestId              TEXT?
workerRegion           TEXT?
createdAt              TIMESTAMPTZ
```

### PaygSession

x402-style session token granting N requests within a TTL.

```
id              UUID (PK)
paygCustomerId  UUID → payg_customers
sessionToken    TEXT (unique)
requestsGranted INT
requestsUsed    INT
expiresAt       TIMESTAMPTZ
createdAt       TIMESTAMPTZ
revokedAt       TIMESTAMPTZ?
```

---

## Middleware Reference

| Middleware | Purpose |
|---|---|
| `paygMiddleware()` | Gates a route behind PAYG payment |
| `paygSessionMiddleware()` | Validates X-Payg-Session, returns 401 if missing |
| `paygConversionCheckMiddleware()` | Non-blocking spend threshold check |

All exported from `worker/middleware/payg-middleware.ts`.

---

## Related Documentation

- [Billing Overview](./README.md)
- [Stripe Setup Guide](./stripe-setup.md)

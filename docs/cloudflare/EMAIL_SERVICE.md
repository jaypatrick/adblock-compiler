# Email Service

The `EmailService` layer gives every Worker handler a single, provider-agnostic way to send transactional email. You call `createEmailService(env)`, get back an `IEmailService`, and call `sendEmail(payload)` — the service picks the best available provider automatically.

---

## Architecture

```mermaid
flowchart TD
    Factory["createEmailService(env, opts)"] --> P1{EMAIL_QUEUE?}
    P1 -- yes --> QSvc["QueuedEmailService\n(durable, queue-backed)"]
    P1 -- no --> P2{priority=critical\n+ RESEND_API_KEY?}
    P2 -- yes --> ResendSvc["ResendEmailService\n(Resend REST — direct fetch to /emails)"]
    P2 -- no --> P3{priority=transactional\n+ CF_EMAIL_API_TOKEN\n+ CF_ACCOUNT_ID?}
    P3 -- yes --> CFRestSvc["CfEmailServiceRestService\n(CF Email Service REST)"]
    P3 -- no --> P4{SEND_EMAIL binding?}
    P4 -- yes --> CFSvc["CfEmailWorkerService\n(adblock-email worker)"]
    P4 -- no --> NullSvc["NullEmailService\n(no-op, logs warning)"]

    QSvc --> Queue["EMAIL_QUEUE\n(Cloudflare Queue)"]
    Queue --> QHandler["email-queue.ts handler"]
    QHandler --> WF["EmailDeliveryWorkflow"]
    WF --> Receipt["Delivery receipt"]
    Receipt --> KV["KV: METRICS (7-day TTL)"]
    Receipt --> D1["D1: email_log_edge"]

    style ResendSvc fill:#1565c0,stroke:#0d47a1,color:#fff
    style QSvc fill:#1b5e20,stroke:#0a3010,color:#fff
    style NullSvc fill:#c62828,stroke:#8e1c1c,color:#fff
```

---

## Provider priority

| Priority | Provider | Trigger condition | Durability | Notes |
|----------|----------|-------------------|------------|-------|
| 1 (best) | `QueuedEmailService` | `EMAIL_QUEUE` binding present | Durable (queue + Workflow) | Preferred for production |
| 2a | `ResendEmailService` | `priority='critical'` + `RESEND_API_KEY` | Best-effort | Auth critical path only |
| 2b | `CfEmailServiceRestService` | `priority='transactional'` + `CF_EMAIL_API_TOKEN` + `CF_ACCOUNT_ID` | Best-effort | Transactional notifications |
| 2c | `CfEmailWorkerService` | `SEND_EMAIL` binding present | Best-effort | Fallback |
| 3 | `NullEmailService` | Nothing configured | N/A | Logs a warning; no send |

---

## Configuration

### 1. `wrangler.toml` bindings (added by PR #1664)

The following bindings are already present in `wrangler.toml`:

```toml
[[send_email]]
name = "SEND_EMAIL"
# Optional: restrict sends to a single verified address.
# Omit to allow sending to all verified addresses.
# destination_address = "notifications@bloqr.dev"

[[queues.producers]]
queue = "adblock-compiler-email-queue"
binding = "EMAIL_QUEUE"

[[queues.consumers]]
queue = "adblock-compiler-email-queue"
max_batch_size = 5
max_batch_timeout = 5  # seconds
max_retries = 3
dead_letter_queue = "adblock-compiler-email-dlq"

[[workflows]]
name = "email-delivery-workflow"
binding = "EMAIL_DELIVERY_WORKFLOW"
class_name = "EmailDeliveryWorkflow"
```

### 2. Worker Secrets

The following Worker Secrets are used by the email system:

| Secret | Required for | Command |
|---|---|---|
| `RESEND_API_KEY` | Auth critical email (verification, password reset) | `wrangler secret put RESEND_API_KEY` |
| `RESEND_AUDIENCE_ID` | User lifecycle contact sync to Resend audience | `wrangler secret put RESEND_AUDIENCE_ID` |
| `CF_EMAIL_API_TOKEN` | Transactional notifications via CF Email Service REST | `wrangler secret put CF_EMAIL_API_TOKEN` |

`SEND_EMAIL` does not require a secret — it is a native Cloudflare binding configured in `wrangler.toml`.

Obtain `RESEND_API_KEY` from [resend.com/api-keys](https://resend.com/api-keys) — use Full Access or a domain-scoped key for `bloqr.dev`.

Obtain `RESEND_AUDIENCE_ID` from [resend.com/audiences](https://resend.com/audiences) — create an audience named "Bloqr Users" and copy the UUID.

### 3. D1 migration (edge tracking tables)

```bash
wrangler d1 execute adblock-db --file=migrations/0011_email_tracking_edge.sql
```

Creates `email_log_edge` and `email_idempotency_keys` tables in D1.

### 4. Neon migration (primary tracking tables)

```bash
deno task db:migrate:deploy
# Applies: prisma/migrations/20260425000000_email_tracking/
```

Creates `EmailTemplate`, `EmailLog`, and `EmailNotificationPreference` tables in Neon.

---

## How to send an email

Use a fire-and-forget pattern so email never blocks the primary response:

```typescript
import { createEmailService } from '../services/email-service.ts';
import { renderCompilationComplete } from '../services/email-templates.ts';

// Inside a handler that has access to ctx (ExecutionContext):
const mailer = createEmailService(env);
const payload = renderCompilationComplete({
    configName: req.configName,
    ruleCount: result.ruleCount,
    durationMs: elapsed,
    requestId: req.id,
});

ctx.waitUntil(
    mailer.sendEmail(payload).catch((err) =>
        console.warn('[email] send error:', err)
    )
);
```

`ctx.waitUntil` ensures the Worker does not terminate before the email is enqueued, without blocking the HTTP response to the user.

---

## Admin API

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| `GET` | `/admin/email/config` | `UserTier.Admin` + `X-Admin-Key` | Current provider type, binding status, env var presence |
| `POST` | `/admin/email/test` | `UserTier.Admin` + `X-Admin-Key` | Delivery result for a test email to the specified address |

---

## Idempotency

`QueuedEmailService` derives an idempotency key internally as `email-${requestId ?? uuid}`. Pass the optional `requestId` option to make the key deterministic:

```typescript
const mailer = new QueuedEmailService(env.EMAIL_QUEUE, {
    requestId: compilationRequestId,   // derives idempotencyKey = "email-<compilationRequestId>"
    reason: 'compilation_complete',
});
```

Inside `EmailDeliveryWorkflow`, the Workflow instance ID is set to the idempotency key when the queue consumer creates the workflow (`env.EMAIL_DELIVERY_WORKFLOW.create({ id: idempotencyKey })`). Cloudflare's Workflow runtime rejects duplicate `create()` calls with the same instance ID, preventing duplicate workflow runs. After successful delivery, Step 3 writes the key to `email_idempotency_keys` (D1) so the queue consumer can short-circuit replays before even triggering a new workflow.

---

## ZTA notes

- All inbound `EmailPayload` objects are Zod-validated (`EmailPayloadSchema`) at the service boundary.
- Admin endpoints (`/admin/email/*`) require `UserTier.Admin` + a valid `X-Admin-Key` header.
- Email subject lines are RFC 2047-encoded and validated against a `^[^\r\n]*$` pattern to prevent MIME header injection.
- HTML email bodies are passed through `escapeHtml()` (`worker/utils/escape-html.ts`) before template interpolation to prevent XSS in email clients.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No emails sent, no errors logged | `NullEmailService` selected — no provider configured | Configure `SEND_EMAIL` or `EMAIL_QUEUE` bindings in `wrangler.toml` |
| Queue backlog growing | `EmailDeliveryWorkflow` failing repeatedly | Check Workflow logs via `wrangler tail`; verify `SEND_EMAIL` binding is correctly configured |
| `503` from `POST /admin/email/test` | No email provider available | Confirm bindings in `wrangler.toml` are deployed; check `GET /admin/email/config` for binding status |
| `[ResendEmailService] Delivery failed: HTTP 401` | `RESEND_API_KEY` invalid or expired | `wrangler secret put RESEND_API_KEY` to rotate |
| `[ResendContactService] syncUserCreated failed` | `RESEND_AUDIENCE_ID` missing or wrong | Verify audience UUID in Resend dashboard; `wrangler secret put RESEND_AUDIENCE_ID` |

---

## See also

- [`worker/services/email-service.ts`](../../worker/services/email-service.ts) — implementation
- [`worker/services/resend-api-service.ts`](../../worker/services/resend-api-service.ts) — typed Resend Contacts/Audiences REST API wrapper
- [`worker/services/resend-contact-service.ts`](../../worker/services/resend-contact-service.ts) — user lifecycle contact sync
- [`worker/workflows/EmailDeliveryWorkflow.ts`](../../worker/workflows/EmailDeliveryWorkflow.ts) — durable delivery workflow
- [`worker/handlers/email-queue.ts`](../../worker/handlers/email-queue.ts) — queue consumer
- [`worker/handlers/admin-email.ts`](../../worker/handlers/admin-email.ts) — admin endpoints
- [`docs/cloudflare/EMAIL_DELIVERY_WORKFLOW.md`](EMAIL_DELIVERY_WORKFLOW.md) — step-by-step workflow documentation
- [`docs/auth/email-architecture.md`](../auth/email-architecture.md) — full hybrid email architecture reference

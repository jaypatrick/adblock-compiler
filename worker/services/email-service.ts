/**
 * EmailService — extensible transactional email for the Adblock Compiler Worker.
 *
 * ## Providers
 *
 * Five provider implementations follow the {@link IEmailService} interface,
 * selected automatically by {@link createEmailService} at startup:
 *
 * | Priority | Class                           | When used                                                          |
 * |----------|---------------------------------|--------------------------------------------------------------------|
 * | 1 (best) | {@link QueuedEmailService}      | `EMAIL_QUEUE` binding present (durable, retryable)                 |
 * | 2a       | {@link ResendEmailService}      | `priority=critical` + `RESEND_API_KEY` (auth critical path)        |
 * | 2b       | {@link CfEmailServiceRestService} | `priority=transactional` + `CF_EMAIL_API_TOKEN` + `CF_ACCOUNT_ID`|
 * | 2c       | {@link CfEmailWorkerService}    | `SEND_EMAIL` binding present (fallback, any priority)              |
 * | 3        | {@link NullEmailService}        | Nothing configured — logs a warning, no sends                      |
 *
 * ## Integration points
 *   1. **Compilation complete** — notify Pro/Vendor/Enterprise users
 *      (`webhooksEnabled: true`).
 *   2. **Critical error alert** — notify admins when a critical error lands in
 *      the `ERROR_QUEUE` dead-letter queue.
 *
 * ## Usage (fire-and-forget)
 * ```ts
 * import { createEmailService } from './services/email-service.ts';
 * import { renderCompilationComplete } from './services/email-templates.ts';
 *
 * const mailer = createEmailService(env);
 * ctx.waitUntil(
 *     mailer.sendEmail(renderCompilationComplete({ configName, ruleCount, durationMs, requestId }))
 *         .catch((err) => console.warn('[email] send failed:', err))
 * );
 * ```
 *
 * All sends are fire-and-forget; callers should use `.catch()` or `ctx.waitUntil`.
 * Non-2xx responses and network errors log a warning and resolve — they never
 * throw, so they never block primary Worker responses.
 *
 * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/ — CF Email Workers
 * @see worker/services/email-templates.ts — HTML/text template renderers
 */

import { z } from 'zod';
import { EmailMessage } from 'cloudflare:email';
import { createCloudflareApiService } from '../../src/services/cloudflareApiService.ts';
import type { CloudflareApiService } from '../../src/services/cloudflareApiService.ts';

// ============================================================================
// Schemas & Types
// ============================================================================

/**
 * Payload for a single transactional email send.
 *
 * All fields are Zod-validated by {@link EmailPayloadSchema} before any network
 * call or message construction, ensuring trust-boundary integrity.
 *
 * ## Bloqr reply-to address conventions
 * ```
 *   hello@bloqr.dev        — waitlist confirmations, general contact
 *   support@bloqr.dev      — compilation complete notifications, app support
 *   sales@bloqr.dev        — upgrade/sales flows
 *   news@bloqr.dev         — newsletter sends
 *   admin@bloqr.dev        — internal admin alerts
 *   abuse@bloqr.dev        — abuse reports
 *   (omit replyTo)         — noreply/system notifications
 * ```
 */
export const EmailPayloadSchema = z.object({
    /** Recipient email address. */
    to: z.string().email().describe('Recipient email address'),
    /** Email subject line. CR/LF characters are forbidden to prevent MIME header injection. */
    subject: z
        .string()
        .min(1)
        .max(998)
        .regex(/^[^\r\n]*$/, 'Subject must not contain CR or LF characters')
        .describe('Email subject line (max 998 chars per RFC 5322)'),
    /** HTML body. Must be non-empty. */
    html: z.string().min(1).describe('HTML body of the email'),
    /** Plain-text fallback body. Must be non-empty. */
    text: z.string().min(1).describe('Plain-text fallback body of the email'),
    /**
     * Optional Reply-To address. When set, email clients direct replies here
     * instead of the From address. Use to route replies to the correct
     * @bloqr.dev alias (e.g. hello@, support@, sales@).
     *
     * Must be a valid RFC 5322 address or display-name qualified address,
     * e.g. `"Bloqr Support <support@bloqr.dev>"`.
     *
     * Omit for noreply/system notifications.
     */
    replyTo: z
        .string()
        .min(1)
        .max(998)
        .regex(/^[^\r\n]*$/, 'Reply-To must not contain CR or LF characters')
        .optional()
        .describe('Optional Reply-To address'),
});

export type EmailPayload = z.infer<typeof EmailPayloadSchema>;

// ============================================================================
// IEmailService interface — extensibility contract
// ============================================================================

/**
 * Extensibility interface for email providers.
 *
 * Implement this interface to swap in a custom provider (Resend, Postmark,
 * SendGrid, etc.) without touching call sites:
 *
 * ```ts
 * class MyCustomEmailService implements IEmailService {
 *     async sendEmail(payload: EmailPayload): Promise<void> { ... }
 * }
 * ```
 *
 * Inject the custom implementation by passing it directly wherever
 * {@link createEmailService} is called, or by wrapping the factory.
 */
export interface IEmailService {
    /**
     * Send a transactional email.
     *
     * Implementations **must**:
     * - Validate `payload` before use (throw `'Invalid email payload'` on failure).
     * - Never throw on delivery failures — log a warning and resolve instead.
     *
     * @param payload - Validated email payload.
     * @throws {Error} `'Invalid email payload'` when Zod validation fails.
     */
    sendEmail(payload: EmailPayload): Promise<void>;
}

// ============================================================================
// CF Email Worker binding type
// ============================================================================

/**
 * Local interface for the Cloudflare `SendEmail` binding.
 *
 * Matches the shape provided by `@cloudflare/workers-types` (`interface SendEmail`),
 * defined locally to avoid a hard dependency on the global type in this module.
 */
interface SendEmailBinding {
    // deno-lint-ignore no-explicit-any
    send(message: any): Promise<void>;
}

// ============================================================================
// Address / header helpers
// ============================================================================

/**
 * Parse a potentially display-name-qualified email address into its components.
 *
 * Handles both plain addresses (`notifications@bloqr.dev`) and RFC 5322
 * display-name format (`"Bloqr" <notifications@bloqr.dev>` or
 * `Bloqr <notifications@bloqr.dev>`).
 *
 * **Invalid addresses:** If the extracted local-part is missing an `@`
 * character, the function returns `{ email }` with the malformed value.
 * This is intentional — the caller (Zod `z.string().email()`) is the
 * authoritative validator and must reject invalid addresses. Passing the
 * value through ensures the validator sees the intended input rather than
 * a silently substituted placeholder.
 *
 * @param displayAddress - Raw address string (plain or display-name qualified).
 * @returns Object with `email` (bare address, possibly malformed) and optional `name`.
 */
export function parseEmailAddress(displayAddress: string): { email: string; name?: string } {
    const match = displayAddress.match(/^(.+?)\s*<([^>]+)>$/);
    if (match) {
        // Strip CRLF first, then remove leading/trailing quotes, to prevent
        // injection if quotes themselves contain CR or LF characters.
        const name = match[1].trim().replace(/[\r\n]/g, '').replace(/^["']+|["']+$/g, '');
        const email = match[2].trim();
        // Pass malformed addresses (missing '@') to downstream Zod validators.
        return name && email.includes('@') ? { email, name } : { email };
    }
    return { email: displayAddress.trim() };
}

/**
 * Encode an email subject for use in an RFC 5322 `Subject:` header.
 *
 * If the subject contains only printable ASCII characters (0x20–0x7E) it is
 * returned unchanged. Otherwise it is wrapped in an RFC 2047 Base64 encoded
 * word (`=?UTF-8?B?<base64>?=`) so that non-ASCII characters (emojis, dashes,
 * accented letters, etc.) are transmitted correctly and do not corrupt the MIME
 * structure.
 *
 * This encoding is applied **before** the value is interpolated into a raw MIME
 * header string — it is the last defence against garbled subjects in non-ASCII
 * locales.
 *
 * @param subject - Raw subject string (already stripped of CR/LF by the Zod schema).
 * @returns        RFC 2047-safe subject value ready for interpolation into a header line.
 */
export function encodeSubjectRfc2047(subject: string): string {
    // Printable ASCII only — safe to use as-is
    if (/^[\x20-\x7E]*$/.test(subject)) {
        return subject;
    }
    // RFC 2047 Base64 encoded word: =?UTF-8?B?<base64>?=
    //
    // Build the binary string via a pre-allocated array to avoid spread-operator
    // stack overflow on subjects approaching the 998-character RFC 5322 limit.
    // `String.fromCharCode(...bytes)` is avoided for the same reason — it
    // spreads all bytes as function arguments and will throw a RangeError on
    // long subjects in V8/SpiderMonkey.
    const bytes = new TextEncoder().encode(subject);
    const chars = new Array<string>(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        chars[i] = String.fromCharCode(bytes[i]);
    }
    return `=?UTF-8?B?${btoa(chars.join(''))}?=`;
}

// ============================================================================
// MIME builder (for CfEmailWorkerService)
// ============================================================================

/**
 * Build a minimal RFC 5322 MIME multipart/alternative message string.
 *
 * Produces a `text/plain` + `text/html` multipart body suitable for passing
 * to `new EmailMessage(from, to, raw)` from the `cloudflare:email` module.
 *
 * @param from    - Sender address (envelope From).
 * @param to      - Recipient address (envelope To).
 * @param subject - Subject line. Non-ASCII characters are RFC 2047 Base64-encoded
 *                  automatically; CR/LF must be stripped by the Zod schema before
 *                  reaching this function.
 * @param text    - Plain-text body.
 * @param html    - HTML body.
 * @param replyTo - Optional Reply-To address. When set, a `Reply-To:` header is
 *                  emitted so email clients route replies to this address instead
 *                  of the From address. CR/LF characters are stripped defensively
 *                  to prevent header injection when called outside Zod-validated paths.
 * @returns       Raw MIME message string.
 */
export function buildRawMimeMessage(
    from: string,
    to: string,
    subject: string,
    text: string,
    html: string,
    replyTo?: string,
): string {
    const boundary = `b_${crypto.randomUUID().replaceAll('-', '_')}`;
    // Strip CR/LF defensively — this function is exported and may be called
    // outside of the Zod-validated path (e.g. direct unit tests).
    const safeReplyTo = replyTo?.replace(/[\r\n]/g, '');

    return [
        'MIME-Version: 1.0',
        `From: ${from}`,
        `To: ${to}`,
        ...(safeReplyTo ? [`Reply-To: ${safeReplyTo}`] : []),
        `Subject: ${encodeSubjectRfc2047(subject)}`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        text,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        html,
        '',
        `--${boundary}--`,
    ].join('\r\n');
}

// ============================================================================
// Provider: CF Email Worker binding (bloqr-email)
// ============================================================================

/**
 * Email provider that uses the Cloudflare Email Workers `SEND_EMAIL` binding
 * (the `bloqr-email` email worker).
 *
 * Outbound email is routed through Cloudflare Email Routing infrastructure.
 * No third-party HTTP API key is required — delivery authority is granted via
 * the `[[send_email]]` binding in `wrangler.toml`.
 *
 * ## wrangler.toml setup
 * ```toml
 * [[send_email]]
 * name = "SEND_EMAIL"
 * # destination_address = "notifications@bloqr.dev"  # optional: restrict to one address
 * ```
 *
 * ## Limitations
 * - Requires Cloudflare Email Routing to be enabled on the account/zone.
 * - Email Routing only supports `allowed_destination_addresses` which restricts
 *   recipients unless omitted (allows all verified addresses).
 *
 * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
 */
export class CfEmailWorkerService implements IEmailService {
    private readonly binding: SendEmailBinding;
    /** Bare email address for the SMTP envelope (no display name). */
    private readonly envelopeFrom: string;
    /** Full display address for the MIME `From:` header (may include display name). */
    private readonly mimeFrom: string;

    /**
     * @param binding     - The `SEND_EMAIL` binding from `env`.
     * @param fromAddress - Sender address. May be a plain address
     *                      (`notifications@bloqr.dev`) or a display-name qualified
     *                      address (`"Bloqr <notifications@bloqr.dev>"`).
     *                      The bare email is extracted for the SMTP envelope;
     *                      the full value is used for the MIME `From:` header.
     */
    constructor(binding: SendEmailBinding, fromAddress: string) {
        this.binding = binding;
        // Strip CR/LF from display name to prevent MIME header injection in the
        // From: header.  The bare email address is safe because parseEmailAddress
        // only captures characters inside the angle brackets (no newlines allowed).
        const sanitized = fromAddress.replace(/[\r\n]/g, '');
        this.mimeFrom = sanitized;
        this.envelopeFrom = parseEmailAddress(sanitized).email;
    }

    /**
     * Sends a transactional email via the Cloudflare `SEND_EMAIL` binding.
     *
     * Constructs a RFC 5322 multipart/alternative MIME message (plain-text +
     * HTML) and dispatches it through the `bloqr-email` Email Worker.
     *
     * @param payload - Validated email payload from {@link EmailPayloadSchema}.
     * @throws {Error} `'Invalid email payload'` on Zod validation failure.
     */
    async sendEmail(payload: EmailPayload): Promise<void> {
        const parsed = EmailPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error('Invalid email payload');
        }

        const { to, subject, html, text, replyTo } = parsed.data;
        const rawMime = buildRawMimeMessage(this.mimeFrom, to, subject, text, html, replyTo);
        const message = new EmailMessage(this.envelopeFrom, to, rawMime);

        try {
            await this.binding.send(message);
        } catch (err: unknown) {
            // CF Email Workers can throw on misconfigured bindings or delivery
            // failures. Log a warning but do not rethrow — fire-and-forget.
            // deno-lint-ignore no-console
            console.warn(
                '[CfEmailWorkerService] Failed to send email via SEND_EMAIL binding:',
                err instanceof Error ? err.message : String(err),
            );
        }
    }
}

// ============================================================================
// Provider: Null (no-op fallback)
// ============================================================================

/**
 * No-op email provider used when neither `EMAIL_QUEUE` nor `SEND_EMAIL` is configured.
 *
 * Every call logs a warning and immediately resolves. This ensures callers never
 * fail due to missing email configuration — degrading gracefully is preferred
 * over hard failures that block primary Worker responses.
 */
export class NullEmailService implements IEmailService {
    async sendEmail(payload: EmailPayload): Promise<void> {
        // deno-lint-ignore no-console
        console.warn(
            `[NullEmailService] No email provider configured — email to <${payload.to}> was dropped. ` +
                'Set EMAIL_QUEUE binding or SEND_EMAIL binding to enable transactional email.',
        );
    }
}

// ============================================================================
// Provider: Resend REST API (critical auth path)
// ============================================================================

/**
 * Email provider that sends via the Resend REST API.
 *
 * Used exclusively for critical auth-path emails where silent delivery failure
 * is unacceptable: email verification, password reset, security alerts.
 *
 * No SDK dependency — uses a single fetch() call to the Resend v1 API.
 *
 * @see https://resend.com/docs/api-reference/emails/send-email
 */
export class ResendEmailService implements IEmailService {
    constructor(
        private readonly apiKey: string,
        private readonly fromAddress: string,
        /** When `true`, delivery failures are rethrown rather than logged-and-swallowed.
         *  Set by {@link createEmailService} when `throwOnFailure: true` is requested
         *  (e.g. from {@link EmailDeliveryWorkflow} so step retries trigger on failure). */
        private readonly throwOnFailure = false,
    ) {}

    async sendEmail(payload: EmailPayload): Promise<void> {
        const parsed = EmailPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error('Invalid email payload');
        }

        const { to, subject, html, text, replyTo } = parsed.data;

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: this.fromAddress,
                    to,
                    subject,
                    html,
                    text,
                    ...(replyTo ? { reply_to: replyTo } : {}),
                }),
            });

            if (!res.ok) {
                const msg = `[ResendEmailService] Delivery failed: HTTP ${res.status} — ${await res.text()}`;
                if (this.throwOnFailure) {
                    throw new Error(msg);
                }
                // deno-lint-ignore no-console
                console.warn(msg);
            }
        } catch (err: unknown) {
            if (this.throwOnFailure) {
                throw err;
            }
            // deno-lint-ignore no-console
            console.warn(
                '[ResendEmailService] Network error:',
                err instanceof Error ? err.message : String(err),
            );
        }
    }
}

// ============================================================================
// Provider: Cloudflare Email Service REST API (transactional)
// ============================================================================

/**
 * Email provider that sends via the Cloudflare Email Service REST API.
 *
 * Uses the new CF Email Service (not the legacy cloudflare:email module binding).
 * Requires a scoped CF API token with Email Send permissions and the account ID.
 *
 * All Cloudflare REST API calls are routed through {@link CloudflareApiService}
 * (the project-wide typed wrapper around the official `cloudflare` SDK), rather
 * than calling `api.cloudflare.com` directly with raw `fetch()`.
 *
 * Used for transactional/notification emails (compilation complete, bulk alerts, etc.)
 * that do not require Resend's deliverability guarantees.
 *
 * @see https://developers.cloudflare.com/email-service/api/send-emails/
 */
export class CfEmailServiceRestService implements IEmailService {
    private readonly cfApi: CloudflareApiService;

    constructor(
        apiToken: string,
        private readonly accountId: string,
        private readonly fromAddress: string,
        /** When `true`, delivery failures are rethrown rather than logged-and-swallowed.
         *  Set by {@link createEmailService} when `throwOnFailure: true` is requested
         *  (e.g. from {@link EmailDeliveryWorkflow} so step retries trigger on failure). */
        private readonly throwOnFailure = false,
    ) {
        this.cfApi = createCloudflareApiService({ apiToken });
    }

    async sendEmail(payload: EmailPayload): Promise<void> {
        const parsed = EmailPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error('Invalid email payload');
        }

        const { to, subject, html, text, replyTo } = parsed.data;

        try {
            await this.cfApi.sendEmail(this.accountId, {
                from: this.fromAddress,
                to: [to],
                subject,
                html,
                text,
                ...(replyTo ? { reply_to: replyTo } : {}),
            });
        } catch (err: unknown) {
            if (this.throwOnFailure) {
                throw err;
            }
            // deno-lint-ignore no-console
            console.warn(
                '[CfEmailServiceRestService] Delivery failed:',
                err instanceof Error ? err.message : String(err),
            );
        }
    }
}

// ============================================================================
// Provider: Queued (via Cloudflare Queue → EmailDeliveryWorkflow)
// ============================================================================

/**
 * Email provider that enqueues delivery jobs on the `bloqr-backend-email-queue`
 * Cloudflare Queue, which is consumed by `handleEmailQueue` and dispatched to
 * `EmailDeliveryWorkflow` for durable, step-checkpointed delivery.
 *
 * ## When to use
 *
 * Prefer `QueuedEmailService` over the direct provider (`CfEmailWorkerService`)
 * for **critical sends** where durability is
 * required (e.g. compilation-complete notifications for paying users):
 *
 * - Survives Worker restarts and isolate evictions (queue is durable).
 * - Automatic retry on transient delivery failures (via the Workflow).
 * - Deduplication via `idempotencyKey` — replayed queue messages never send twice.
 * - Observable progress and delivery receipts in KV.
 *
 * For low-stakes sends (admin test emails, best-effort alerts) the direct
 * providers are sufficient.
 *
 * ## Usage
 * ```ts
 * const mailer = new QueuedEmailService(env, { requestId: 'abc', reason: 'compilation_complete' });
 * ctx.waitUntil(
 *     mailer.sendEmail(renderCompilationComplete({ configName, ruleCount, durationMs, requestId }))
 *         .catch((err) => console.warn('[email] queue error:', err))
 * );
 * ```
 *
 * @see worker/handlers/email-queue.ts — queue consumer
 * @see worker/workflows/EmailDeliveryWorkflow.ts — durable delivery workflow
 */
export class QueuedEmailService implements IEmailService {
    // deno-lint-ignore no-explicit-any
    private readonly queue: { send: (msg: any, opts?: any) => Promise<unknown> };
    private readonly requestId?: string;
    private readonly reason?: string;

    constructor(
        // deno-lint-ignore no-explicit-any
        queue: { send: (msg: any, opts?: any) => Promise<unknown> },
        opts: { requestId?: string; reason?: string } = {},
    ) {
        this.queue = queue;
        this.requestId = opts.requestId;
        this.reason = opts.reason;
    }

    /**
     * Enqueue an email delivery job on `EMAIL_QUEUE`.
     *
     * Does **not** send the email directly — the queue consumer
     * (`handleEmailQueue`) will create an `EmailDeliveryWorkflow` instance to
     * handle the actual delivery with retries.
     *
     * @param payload - Email payload to deliver.
     * @throws {Error} `'Invalid email payload'` on Zod validation failure.
     */
    async sendEmail(payload: EmailPayload): Promise<void> {
        const parsed = EmailPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error('Invalid email payload');
        }

        const idempotencyKey = `email-${this.requestId ?? crypto.randomUUID()}`;

        const message = {
            type: 'email' as const,
            requestId: this.requestId,
            timestamp: Date.now(),
            payload: parsed.data,
            idempotencyKey,
            reason: this.reason,
        };

        try {
            await this.queue.send(message, { contentType: 'json' });
            // deno-lint-ignore no-console
            console.log(
                `[QueuedEmailService] Enqueued email delivery (key=${idempotencyKey}, to=${parsed.data.to})`,
            );
        } catch (err: unknown) {
            // Queue failure — log warning, do not rethrow (fire-and-forget contract)
            // deno-lint-ignore no-console
            console.warn(
                '[QueuedEmailService] Failed to enqueue email job:',
                err instanceof Error ? err.message : String(err),
            );
        }
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Default from-address for critical auth-path emails sent via Resend.
 * Used for email verification, password reset, and security alerts.
 */
export const FROM_ADDRESS_CRITICAL = 'noreply@bloqr.dev';

/**
 * Default from-address for transactional/notification emails sent via
 * CfEmailServiceRestService or CfEmailWorkerService.
 */
export const FROM_ADDRESS_TRANSACTIONAL = 'notifications@bloqr.dev';

/**
 * Create the best available {@link IEmailService} from the Worker `Env`.
 *
 * **Provider selection order** (first match wins):
 * 1. `EMAIL_QUEUE` binding present + `useQueue !== false` →
 *    {@link QueuedEmailService} (durable, queue-backed + Workflow delivery).
 * 2. Direct sends — based on `priority`:
 *    - `priority === 'critical'` AND `RESEND_API_KEY` present →
 *      {@link ResendEmailService} (auth critical path: verification, reset, security alerts).
 *    - `priority === 'transactional'` AND `CF_EMAIL_API_TOKEN` + `CF_ACCOUNT_ID` present →
 *      {@link CfEmailServiceRestService} (CF Email Service REST API).
 *    - `SEND_EMAIL` present (any priority, fallback) →
 *      {@link CfEmailWorkerService} (`bloqr-email` worker).
 * 3. Nothing configured → {@link NullEmailService} (logs a warning, no sends).
 *
 * The `QueuedEmailService` is the preferred production choice for critical
 * notifications: it enqueues the job on `EMAIL_QUEUE`, which is consumed by
 * `handleEmailQueue` and dispatched to `EmailDeliveryWorkflow` for durable,
 * step-checkpointed delivery with automatic retry.
 *
 * Pass `{ useQueue: false }` to bypass the queue and send directly — useful
 * for admin test emails where you want immediate synchronous feedback.
 *
 * ## Usage (preferred — durable queue-backed)
 * ```ts
 * import { createEmailService } from './services/email-service.ts';
 *
 * // In a handler:
 * const mailer = createEmailService(env, { requestId: ctx.requestId, reason: 'compilation_complete' });
 * ctx.waitUntil(
 *     mailer.sendEmail({ to, subject, html, text })
 *         .catch((err) => console.warn('[email] enqueue failed:', err))
 * );
 * ```
 *
 * ## Usage (direct — for admin test sends)
 * ```ts
 * const mailer = createEmailService(env, { useQueue: false });
 * await mailer.sendEmail({ to, subject, html, text });
 * ```
 *
 * @param env  - Worker `Env` object (or any partial that has the required bindings).
 * @param opts - Optional options: `useQueue` (default `true`), tracing fields, `priority`,
 *               and `throwOnFailure` (default `false`; set `true` in workflow step callbacks
 *               so delivery errors propagate and trigger step retries).
 * @returns    An {@link IEmailService} instance appropriate for the environment.
 */
export function createEmailService(
    env: {
        // deno-lint-ignore no-explicit-any
        EMAIL_QUEUE?: { send: (msg: any, opts?: any) => Promise<unknown> } | null;
        SEND_EMAIL?: SendEmailBinding | null;
        RESEND_API_KEY?: string | null;
        CF_EMAIL_API_TOKEN?: string | null;
        CF_ACCOUNT_ID?: string | null;
    },
    opts: {
        useQueue?: boolean;
        requestId?: string;
        reason?: string;
        priority?: 'critical' | 'transactional';
        /**
         * When `true`, delivery failures in {@link ResendEmailService} and
         * {@link CfEmailServiceRestService} are rethrown instead of being
         * logged-and-swallowed. Use this inside Cloudflare Workflow step callbacks
         * so step retries fire on real delivery failures.
         *
         * @default false
         */
        throwOnFailure?: boolean;
    } = {},
): IEmailService {
    const { useQueue = true, requestId, reason, priority, throwOnFailure = false } = opts;

    // Priority 1: Durable queue-backed delivery (EMAIL_QUEUE → EmailDeliveryWorkflow)
    if (useQueue && env.EMAIL_QUEUE) {
        return new QueuedEmailService(env.EMAIL_QUEUE, { requestId, reason });
    }

    // Priority 2: Direct sends — provider selected by `priority` hint.
    if (priority === 'critical' && env.RESEND_API_KEY) {
        return new ResendEmailService(env.RESEND_API_KEY, FROM_ADDRESS_CRITICAL, throwOnFailure);
    }

    if (priority === 'transactional' && env.CF_EMAIL_API_TOKEN && env.CF_ACCOUNT_ID) {
        return new CfEmailServiceRestService(env.CF_EMAIL_API_TOKEN, env.CF_ACCOUNT_ID, FROM_ADDRESS_TRANSACTIONAL, throwOnFailure);
    }

    // Priority 2 fallback: CF Email Workers binding (bloqr-email worker)
    if (env.SEND_EMAIL) {
        return new CfEmailWorkerService(env.SEND_EMAIL, FROM_ADDRESS_TRANSACTIONAL);
    }

    // Priority 3: No-op fallback
    // deno-lint-ignore no-console
    console.warn(
        '[createEmailService] No email provider configured (EMAIL_QUEUE and SEND_EMAIL both absent). ' +
            'Falling back to NullEmailService — all email sends will be dropped.',
    );
    return new NullEmailService();
}

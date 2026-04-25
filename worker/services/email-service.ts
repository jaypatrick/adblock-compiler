/**
 * EmailService — extensible transactional email for the Adblock Compiler Worker.
 *
 * ## Providers
 *
 * Three provider implementations follow the {@link IEmailService} interface,
 * selected automatically by {@link createEmailService} at startup:
 *
 * | Priority | Class                        | When used                                             |
 * |----------|------------------------------|-------------------------------------------------------|
 * | 1 (best) | {@link CfEmailWorkerService} | `SEND_EMAIL` binding present (adblock-email worker)   |
 * | 2        | {@link MailChannelsEmailService} | `FROM_EMAIL` env var set, no `SEND_EMAIL` binding  |
 * | 3        | {@link NullEmailService}     | Neither configured — logs a warning, no sends         |
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
 *     mailer.sendEmail(renderCompilationComplete({ userEmail, configName, ruleCount, durationMs, requestId }))
 *         .catch((err) => console.warn('[email] send failed:', err))
 * );
 * ```
 *
 * All sends are fire-and-forget; callers should use `.catch()` or `ctx.waitUntil`.
 * Non-2xx responses and network errors log a warning and resolve — they never
 * throw, so they never block primary Worker responses.
 *
 * @see https://api.mailchannels.net/tx/v1/send — MailChannels transactional send API
 * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/ — CF Email Workers
 * @see worker/services/email-templates.ts — HTML/text template renderers
 */

import { z } from 'zod';
import { EmailMessage } from 'cloudflare:email';

// ============================================================================
// MailChannels endpoint
// ============================================================================

const MAILCHANNELS_SEND_URL = 'https://api.mailchannels.net/tx/v1/send';

// ============================================================================
// Schemas & Types
// ============================================================================

/**
 * Environment variables required by {@link MailChannelsEmailService}.
 *
 * `FROM_EMAIL` is mandatory. DKIM fields are optional — all three must be
 * present for DKIM signing to be applied to outbound messages.
 */
export const EmailEnvSchema = z.object({
    FROM_EMAIL: z.string().min(1).describe('Sender address, e.g. "Bloqr <notifications@bloqr.dev>"'),
    DKIM_DOMAIN: z.string().optional().describe('Domain used for DKIM signing (must match DNS TXT record)'),
    DKIM_SELECTOR: z.string().optional().describe('DKIM selector name'),
    DKIM_PRIVATE_KEY: z.string().optional().describe('Base64-encoded RSA private key for DKIM signing (Worker Secret)'),
});

export type EmailEnv = z.infer<typeof EmailEnvSchema>;

/**
 * Payload for a single transactional email send.
 *
 * All fields are Zod-validated by {@link EmailPayloadSchema} before any network
 * call or message construction, ensuring trust-boundary integrity.
 */
export const EmailPayloadSchema = z.object({
    /** Recipient email address. */
    to: z.string().email().describe('Recipient email address'),
    /** Email subject line. */
    subject: z.string().min(1).max(998).describe('Email subject line (max 998 chars per RFC 5322)'),
    /** HTML body. Must be non-empty. */
    html: z.string().min(1).describe('HTML body of the email'),
    /** Plain-text fallback body. Must be non-empty. */
    text: z.string().min(1).describe('Plain-text fallback body of the email'),
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
 * @param subject - Subject line (special characters are NOT encoded here;
 *                  callers must ensure subject is RFC 5322 safe).
 * @param text    - Plain-text body.
 * @param html    - HTML body.
 * @returns       Raw MIME message string.
 */
export function buildRawMimeMessage(
    from: string,
    to: string,
    subject: string,
    text: string,
    html: string,
): string {
    const boundary = `b_${crypto.randomUUID().replaceAll('-', '_')}`;

    return [
        'MIME-Version: 1.0',
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
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
// Provider: CF Email Worker binding (adblock-email)
// ============================================================================

/**
 * Email provider that uses the Cloudflare Email Workers `SEND_EMAIL` binding
 * (the `adblock-email` email worker).
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
    private readonly fromAddress: string;

    /**
     * @param binding     - The `SEND_EMAIL` binding from `env`.
     * @param fromAddress - Sender address (e.g. `"Bloqr <notifications@bloqr.dev>"`).
     */
    constructor(binding: SendEmailBinding, fromAddress: string) {
        this.binding = binding;
        this.fromAddress = fromAddress;
    }

    /**
     * Sends a transactional email via the Cloudflare `SEND_EMAIL` binding.
     *
     * Constructs a RFC 5322 multipart/alternative MIME message (plain-text +
     * HTML) and dispatches it through the `adblock-email` Email Worker.
     *
     * @param payload - Validated email payload from {@link EmailPayloadSchema}.
     * @throws {Error} `'Invalid email payload'` on Zod validation failure.
     */
    async sendEmail(payload: EmailPayload): Promise<void> {
        const parsed = EmailPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error('Invalid email payload');
        }

        const { to, subject, html, text } = parsed.data;
        const rawMime = buildRawMimeMessage(this.fromAddress, to, subject, text, html);
        const message = new EmailMessage(this.fromAddress, to, rawMime);

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
// Provider: MailChannels HTTP API
// ============================================================================

/**
 * MailChannels wire types (internal — not exported).
 */
interface MailChannelsPersonalization {
    readonly to: ReadonlyArray<{ readonly email: string }>;
    readonly dkim_domain?: string;
    readonly dkim_selector?: string;
    readonly dkim_private_key?: string;
}

interface MailChannelsSendBody {
    readonly from: { readonly email: string; readonly name?: string };
    readonly personalizations: readonly MailChannelsPersonalization[];
    readonly subject: string;
    readonly content: ReadonlyArray<{ readonly type: string; readonly value: string }>;
}

/**
 * Email provider that sends via the MailChannels transactional API
 * (`https://api.mailchannels.net/tx/v1/send`).
 *
 * Used as the secondary provider when the `SEND_EMAIL` CF Email Workers binding
 * is not configured. Supports optional DKIM signing via three env vars.
 *
 * @see https://api.mailchannels.net/tx/v1/send
 */
export class MailChannelsEmailService implements IEmailService {
    private readonly env: EmailEnv;

    constructor(env: EmailEnv) {
        this.env = env;
    }

    /**
     * Sends a transactional email via the MailChannels HTTP API.
     *
     * - Validates `payload` with {@link EmailPayloadSchema}.
     * - DKIM personalisation fields are only included when all three DKIM env
     *   vars (`DKIM_DOMAIN`, `DKIM_SELECTOR`, `DKIM_PRIVATE_KEY`) are present.
     * - Non-2xx responses log a warning and resolve (fire-and-forget).
     * - Network-level errors log a warning and resolve (fire-and-forget).
     *
     * @param payload - Email send payload.
     * @throws {Error} `'Invalid email payload'` when Zod validation fails.
     */
    async sendEmail(payload: EmailPayload): Promise<void> {
        const parsed = EmailPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error('Invalid email payload');
        }

        const { to, subject, html, text } = parsed.data;
        const { FROM_EMAIL, DKIM_DOMAIN, DKIM_SELECTOR, DKIM_PRIVATE_KEY } = this.env;

        const personalization: MailChannelsPersonalization = {
            to: [{ email: to }],
            ...(DKIM_DOMAIN && DKIM_SELECTOR && DKIM_PRIVATE_KEY
                ? {
                    dkim_domain: DKIM_DOMAIN,
                    dkim_selector: DKIM_SELECTOR,
                    dkim_private_key: DKIM_PRIVATE_KEY,
                }
                : {}),
        };

        const body: MailChannelsSendBody = {
            from: { email: FROM_EMAIL },
            personalizations: [personalization],
            subject,
            content: [
                { type: 'text/plain', value: text },
                { type: 'text/html', value: html },
            ],
        };

        let response: Response;
        try {
            response = await globalThis.fetch(MAILCHANNELS_SEND_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (err: unknown) {
            // Network-level error — log warning, do not rethrow (fire-and-forget)
            // deno-lint-ignore no-console
            console.warn(
                '[MailChannelsEmailService] Network error sending email:',
                err instanceof Error ? err.message : String(err),
            );
            return;
        }

        if (!response.ok) {
            // deno-lint-ignore no-console
            console.warn(
                `[MailChannelsEmailService] MailChannels returned non-2xx status ${response.status} for recipient <${to}>`,
            );
        }
    }
}

// ============================================================================
// Provider: Null (no-op fallback)
// ============================================================================

/**
 * No-op email provider used when no email binding or env var is configured.
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
                'Set SEND_EMAIL binding or FROM_EMAIL env var to enable transactional email.',
        );
    }
}

// ============================================================================
// Provider: Queued (via Cloudflare Queue → EmailDeliveryWorkflow)
// ============================================================================

/**
 * Email provider that enqueues delivery jobs on the `adblock-compiler-email-queue`
 * Cloudflare Queue, which is consumed by `handleEmailQueue` and dispatched to
 * `EmailDeliveryWorkflow` for durable, step-checkpointed delivery.
 *
 * ## When to use
 *
 * Prefer `QueuedEmailService` over direct providers (`CfEmailWorkerService`,
 * `MailChannelsEmailService`) for **critical sends** where durability is
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
 *     mailer.sendEmail(renderCompilationComplete({ userEmail, configName, ruleCount, durationMs, requestId }))
 *         .catch((err) => console.warn('[email] queue error:', err))
 * );
 * ```
 *
 * @see worker/handlers/email-queue.ts — queue consumer
 * @see worker/workflows/EmailDeliveryWorkflow.ts — durable delivery workflow
 */
export class QueuedEmailService implements IEmailService {
    private readonly queue: { send: (msg: unknown, opts?: { contentType?: string }) => Promise<void> };
    private readonly requestId?: string;
    private readonly reason?: string;

    constructor(
        queue: { send: (msg: unknown, opts?: { contentType?: string }) => Promise<void> },
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
// Backward-compat alias
// ============================================================================

/**
 * @deprecated Prefer {@link MailChannelsEmailService} or {@link createEmailService}.
 *
 * `EmailService` is kept as an alias for backward compatibility with existing
 * call sites that instantiate it directly. New code should use the factory
 * ({@link createEmailService}) or inject {@link IEmailService} via the interface.
 */
// Re-export as both value and type so `new EmailService()` and `import type { EmailService }` both work.
export { MailChannelsEmailService as EmailService };

// ============================================================================
// Factory
// ============================================================================

/**
 * Create the best available {@link IEmailService} from the Worker `Env`.
 *
 * **Provider selection order** (first match wins):
 * 1. `EMAIL_QUEUE` binding present + `useQueue !== false` →
 *    {@link QueuedEmailService} (durable, queue-backed + Workflow delivery).
 * 2. `SEND_EMAIL` binding present → {@link CfEmailWorkerService} (`adblock-email` worker).
 * 3. `FROM_EMAIL` env var set → {@link MailChannelsEmailService} (HTTP API).
 * 4. Neither → {@link NullEmailService} (logs a warning, no sends).
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
 * @param opts - Optional options: `useQueue` (default `true`) and tracing fields.
 * @returns    An {@link IEmailService} instance appropriate for the environment.
 */
export function createEmailService(
    env: {
        EMAIL_QUEUE?: { send: (msg: unknown, opts?: { contentType?: string }) => Promise<void> } | null;
        SEND_EMAIL?: SendEmailBinding | null;
        FROM_EMAIL?: string;
        DKIM_DOMAIN?: string;
        DKIM_SELECTOR?: string;
        DKIM_PRIVATE_KEY?: string;
    },
    opts: { useQueue?: boolean; requestId?: string; reason?: string } = {},
): IEmailService {
    const { useQueue = true, requestId, reason } = opts;

    // Priority 1: Durable queue-backed delivery (EMAIL_QUEUE → EmailDeliveryWorkflow)
    if (useQueue && env.EMAIL_QUEUE) {
        return new QueuedEmailService(env.EMAIL_QUEUE, { requestId, reason });
    }

    // Priority 2: CF Email Workers binding (adblock-email worker)
    if (env.SEND_EMAIL) {
        return new CfEmailWorkerService(env.SEND_EMAIL, env.FROM_EMAIL ?? 'notifications@bloqr.dev');
    }

    // Priority 3: MailChannels HTTP API
    const mailchannelsParsed = EmailEnvSchema.safeParse(env);
    if (mailchannelsParsed.success) {
        return new MailChannelsEmailService(mailchannelsParsed.data);
    }

    // Priority 4: No-op fallback
    // deno-lint-ignore no-console
    console.warn(
        '[createEmailService] No email provider configured (EMAIL_QUEUE, SEND_EMAIL, and FROM_EMAIL all absent). ' +
            'Falling back to NullEmailService — all email sends will be dropped.',
    );
    return new NullEmailService();
}

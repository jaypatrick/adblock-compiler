/**
 * EmailService — sends transactional email via the MailChannels API.
 *
 * Integration points:
 *   1. Compilation complete — notify Pro/Vendor/Enterprise users (webhooksEnabled: true).
 *   2. Critical error alert — notify admins when a critical error lands in ERROR_QUEUE.
 *
 * All sends are fire-and-forget; callers should use `.catch()` or `ctx.waitUntil`.
 * Non-2xx responses log a warning and resolve — they never throw, so they never
 * block primary Worker responses.
 *
 * @see https://api.mailchannels.net/tx/v1/send — MailChannels transactional send API
 * @see https://developers.cloudflare.com/email-routing/ — CF Email Routing (inbound only)
 */

import { z } from 'zod';

// ============================================================================
// MailChannels endpoint
// ============================================================================

const MAILCHANNELS_SEND_URL = 'https://api.mailchannels.net/tx/v1/send';

// ============================================================================
// Schemas & Types
// ============================================================================

/**
 * Environment variables required by {@link EmailService}.
 *
 * `FROM_EMAIL` is mandatory. DKIM fields are optional — all three must be
 * present for DKIM signing to be applied to outbound messages.
 */
export const EmailEnvSchema = z.object({
    FROM_EMAIL: z.string().min(1),
    DKIM_DOMAIN: z.string().optional(),
    DKIM_SELECTOR: z.string().optional(),
    DKIM_PRIVATE_KEY: z.string().optional(),
});

export type EmailEnv = z.infer<typeof EmailEnvSchema>;

/**
 * Payload for a single transactional email send.
 * All fields are validated by {@link EmailPayloadSchema} before any network call.
 */
export const EmailPayloadSchema = z.object({
    to: z.string().min(1),
    subject: z.string().min(1),
    html: z.string().min(1),
    text: z.string().min(1),
});

export type EmailPayload = z.infer<typeof EmailPayloadSchema>;

// ============================================================================
// MailChannels wire types (internal)
// ============================================================================

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

// ============================================================================
// Service implementation
// ============================================================================

/**
 * Thin service for sending transactional email via the MailChannels API.
 *
 * Use {@link createEmailService} to instantiate from an `Env` object.
 *
 * @example
 * ```ts
 * const mailer = createEmailService(env);
 * ctx.waitUntil(mailer.sendEmail({
 *     to: 'user@example.com',
 *     subject: 'Compilation complete',
 *     html: '<p>Done!</p>',
 *     text: 'Done!',
 * }).catch((err) => console.warn('[email] fire-and-forget error:', err)));
 * ```
 */
export class EmailService {
    private readonly env: EmailEnv;

    constructor(env: EmailEnv) {
        this.env = env;
    }

    /**
     * Send a transactional email via MailChannels.
     *
     * - Validates `payload` with {@link EmailPayloadSchema}; throws `'Invalid email payload'`
     *   on validation failure (callers can `.catch()` this).
     * - Resolves without throwing on non-2xx responses (logs a warning instead).
     * - DKIM fields are included only when all three DKIM env vars are present.
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
                '[EmailService] Network error sending email:',
                err instanceof Error ? err.message : String(err),
            );
            return;
        }

        if (!response.ok) {
            // deno-lint-ignore no-console
            console.warn(
                `[EmailService] MailChannels returned non-2xx status ${response.status} for recipient <${to}>`,
            );
        }
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an {@link EmailService} from an `EmailEnv`-compatible environment.
 *
 * @example
 * ```ts
 * import { createEmailService } from './services/email-service.ts';
 *
 * const mailer = createEmailService(env);
 * ```
 */
export function createEmailService(env: EmailEnv): EmailService {
    return new EmailService(env);
}

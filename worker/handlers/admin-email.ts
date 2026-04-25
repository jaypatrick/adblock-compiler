/**
 * Admin Email Handler — configuration status and test send.
 *
 * Provides two admin-only endpoints for managing and verifying the Worker's
 * outbound email configuration:
 *
 *   GET  /admin/email/config — returns which email provider is active, which
 *                              bindings/vars are present, and DKIM status.
 *   POST /admin/email/test   — sends a test email to a specified recipient to
 *                              verify end-to-end delivery.
 *
 * ## ZTA compliance
 * - `checkRoutePermission()` applied on both handlers — Admin tier + role required.
 * - Request bodies validated with Zod (`AdminEmailTestRequestSchema`) before use.
 * - `SEND_EMAIL` binding is treated as opaque — its presence is reported but
 *   its internals are never surfaced in responses.
 * - Test sends use the same {@link IEmailService} code path as production sends,
 *   ensuring integration tests reflect real behaviour.
 *
 * @see worker/services/email-service.ts — provider selection logic
 * @see worker/services/email-templates.ts — HTML/text template renderers
 * @see worker/routes/admin.routes.ts — OpenAPI route registration
 */

import { z } from 'zod';
import type { AppContext } from '../routes/shared.ts';
import { JsonResponse } from '../utils/response.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';
import { createEmailService } from '../services/email-service.ts';
import { escapeHtml } from '../utils/escape-html.ts';

// ============================================================================
// Request / response Zod schemas (exported for reuse in route definitions)
// ============================================================================

/**
 * Request body for `POST /admin/email/test`.
 *
 * Validated before any send attempt — Zod validation failure → 400.
 */
export const AdminEmailTestRequestSchema = z.object({
    /** Recipient email address for the test send. */
    to: z.string().email().describe('Recipient email address for the test send'),
    /** Optional subject override. Defaults to a standard test subject line. */
    subject: z.string().min(1).max(200).optional().describe('Optional subject override'),
});

export type AdminEmailTestRequest = z.infer<typeof AdminEmailTestRequestSchema>;

/**
 * Response shape for `GET /admin/email/config`.
 */
export const AdminEmailConfigResponseSchema = z.object({
    success: z.literal(true),
    /** ISO 8601 timestamp when the config status was evaluated. */
    timestamp: z.string().describe('ISO 8601 timestamp'),
    /**
     * Active email provider identifier.
     *
     * - `'queued'`         — Durable queue-backed delivery (`EMAIL_QUEUE` → `EmailDeliveryWorkflow`)
     * - `'cf_email_worker'` — Cloudflare Email Workers (`SEND_EMAIL` binding, direct)
     * - `'mailchannels'`    — MailChannels HTTP API (`FROM_EMAIL` env var, direct)
     * - `'none'`            — No provider configured; sends are dropped
     */
    provider: z.enum(['queued', 'cf_email_worker', 'mailchannels', 'none']).describe('Active email provider'),
    /** `true` when the `EMAIL_QUEUE` binding is present (durable queue delivery). */
    email_queue_configured: z.boolean(),
    /** `true` when the `SEND_EMAIL` CF Email Workers binding is present. */
    send_email_binding_configured: z.boolean(),
    /** `true` when `FROM_EMAIL` env var is set (used by MailChannels provider). */
    from_email_configured: z.boolean(),
    /** Sender address extracted from `FROM_EMAIL` (masked if absent). */
    from_address: z.string().nullable().describe('Configured sender address, or null if not set'),
    /**
     * DKIM signing status.
     *
     * `'configured'` — all three DKIM env vars are present.
     * `'partial'`    — one or two DKIM env vars are set but not all three.
     * `'disabled'`   — no DKIM env vars are set.
     */
    dkim_status: z.enum(['configured', 'partial', 'disabled']).describe('DKIM signing status'),
});

export type AdminEmailConfigResponse = z.infer<typeof AdminEmailConfigResponseSchema>;

/**
 * Response shape for `POST /admin/email/test`.
 */
export const AdminEmailTestResponseSchema = z.object({
    success: z.literal(true),
    /** ISO 8601 timestamp of the send attempt. */
    timestamp: z.string().describe('ISO 8601 timestamp'),
    /** Human-readable result message. */
    message: z.string().describe('Result message'),
    /** Provider used for this send attempt. */
    provider: z.enum(['cf_email_worker', 'mailchannels', 'none']).describe('Provider used'),
    /** Recipient address used for the test. */
    to: z.string().email().describe('Recipient address'),
});

// ============================================================================
// Internal helpers
// ============================================================================

/** Determine active provider label from env. */
function detectProvider(env: {
    EMAIL_QUEUE?: unknown;
    SEND_EMAIL?: unknown;
    FROM_EMAIL?: string;
}): 'queued' | 'cf_email_worker' | 'mailchannels' | 'none' {
    if (env.EMAIL_QUEUE) return 'queued';
    if (env.SEND_EMAIL) return 'cf_email_worker';
    if (env.FROM_EMAIL) return 'mailchannels';
    return 'none';
}

/**
 * Determine the direct (non-queue) provider for admin test sends.
 *
 * Admin test emails always bypass the queue so admins get synchronous feedback.
 * Returns the best direct provider available, or `'none'` when neither
 * `SEND_EMAIL` nor `FROM_EMAIL` is configured.
 */
function detectDirectProvider(env: {
    SEND_EMAIL?: unknown;
    FROM_EMAIL?: string;
}): 'cf_email_worker' | 'mailchannels' | 'none' {
    if (env.SEND_EMAIL) return 'cf_email_worker';
    if (env.FROM_EMAIL) return 'mailchannels';
    return 'none';
}

/** Determine DKIM status from env. */
function detectDkimStatus(env: {
    DKIM_DOMAIN?: string;
    DKIM_SELECTOR?: string;
    DKIM_PRIVATE_KEY?: string;
}): 'configured' | 'partial' | 'disabled' {
    const presentCount = [env.DKIM_DOMAIN, env.DKIM_SELECTOR, env.DKIM_PRIVATE_KEY].filter(Boolean).length;
    if (presentCount === 3) return 'configured';
    if (presentCount > 0) return 'partial';
    return 'disabled';
}

// ============================================================================
// GET /admin/email/config
// ============================================================================

/**
 * Returns the current email configuration status.
 *
 * Reports which provider is active, whether the `SEND_EMAIL` binding and
 * `FROM_EMAIL` env var are present, the sender address, and DKIM status.
 * No secrets or private keys are surfaced in the response.
 *
 * ### Response codes
 * - **200** — Config status returned (always, even when no provider is configured).
 * - **401** — Not authenticated.
 * - **403** — Authenticated but not an admin.
 *
 * @param c - Hono app context carrying `env` and `authContext`.
 */
export async function handleAdminEmailConfig(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/email/config', c.get('authContext'));
    if (denied) return denied;

    const provider = detectProvider(c.env);
    const dkimStatus = detectDkimStatus(c.env);

    const response: AdminEmailConfigResponse = {
        success: true,
        timestamp: new Date().toISOString(),
        provider,
        email_queue_configured: Boolean(c.env.EMAIL_QUEUE),
        send_email_binding_configured: Boolean(c.env.SEND_EMAIL),
        from_email_configured: Boolean(c.env.FROM_EMAIL),
        from_address: c.env.FROM_EMAIL ?? null,
        dkim_status: dkimStatus,
    };

    return JsonResponse.success(response);
}

// ============================================================================
// POST /admin/email/test
// ============================================================================

/**
 * Sends a test email to verify end-to-end email delivery.
 *
 * Uses the same {@link createEmailService} factory as production sends, so the
 * test reflects the actual active provider. The test email includes a clear
 * subject and body identifying it as a system verification send.
 *
 * ### Request body (JSON)
 * ```json
 * { "to": "admin@example.com" }
 * ```
 *
 * ### Response codes
 * - **200** — Send attempted (non-2xx delivery failures are logged, not surfaced).
 * - **400** — Invalid request body (`to` missing or not a valid email address).
 * - **401** — Not authenticated.
 * - **403** — Authenticated but not an admin.
 * - **503** — No email provider configured.
 *
 * @param c - Hono app context carrying `env` and `authContext`.
 */
export async function handleAdminEmailTest(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/email/test', c.get('authContext'));
    if (denied) return denied;

    // Check any provider exists (includes queue-backed) for 503 guard
    const anyProvider = detectProvider(c.env);
    if (anyProvider === 'none') {
        return JsonResponse.serviceUnavailable(
            'No email provider configured. Set EMAIL_QUEUE binding, SEND_EMAIL binding, or FROM_EMAIL env var.',
        );
    }

    // Admin tests always use direct delivery (bypass queue) for synchronous feedback
    const directProvider = detectDirectProvider(c.env);
    if (directProvider === 'none') {
        return JsonResponse.serviceUnavailable(
            'No direct email provider configured for admin test sends. ' +
                'Set SEND_EMAIL binding or FROM_EMAIL env var in addition to EMAIL_QUEUE.',
        );
    }

    // Zod-validate request body at the trust boundary
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return JsonResponse.badRequest('Request body must be valid JSON with a "to" field');
    }

    const parsed = AdminEmailTestRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body');
    }

    const { to, subject } = parsed.data;
    const timestamp = new Date().toISOString();

    const mailer = createEmailService(c.env, { useQueue: false });

    const testSubject = subject ?? `[Bloqr] Email configuration test — ${timestamp}`;
    const testText = [
        'This is a test email sent from the Bloqr admin panel.',
        '',
        `Provider: ${directProvider}`,
        `Timestamp: ${timestamp}`,
        '',
        'If you received this message, outbound email is working correctly.',
    ].join('\n');
    const testHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Email Configuration Test</title></head>
<body style="font-family:sans-serif;max-width:560px;margin:32px auto;padding:0 16px;">
  <h2 style="color:#1a1a2e;">📧 Email Configuration Test</h2>
  <p>This is a test email sent from the <strong>Bloqr admin panel</strong>.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <tr><td style="padding:6px 12px;background:#f4f4f8;font-weight:600;width:120px;">Provider</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e0e0e8;">${directProvider}</td></tr>
    <tr><td style="padding:6px 12px;background:#f4f4f8;font-weight:600;">Timestamp</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e0e0e8;">${escapeHtml(timestamp)}</td></tr>
    <tr><td style="padding:6px 12px;background:#f4f4f8;font-weight:600;">Recipient</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e0e0e8;">${escapeHtml(to)}</td></tr>
  </table>
  <p style="color:#666;font-size:13px;">
    If you received this message, outbound email is working correctly.
  </p>
</body>
</html>`.trim();

    await mailer.sendEmail({ to, subject: testSubject, html: testHtml, text: testText });

    return JsonResponse.success({
        success: true,
        timestamp,
        message: `Test email dispatched to <${to}> via ${directProvider}. Check your inbox — delivery may take up to 60 seconds.`,
        provider: directProvider,
        to,
    });
}

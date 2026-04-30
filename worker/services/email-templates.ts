/**
 * Email templates for transactional notifications.
 *
 * Two templates:
 *   1. Compilation complete — sent to users (Pro/Vendor/Enterprise, webhooksEnabled)
 *      when a compile job finishes.
 *   2. Critical error alert — sent to admins when a critical-severity error lands
 *      in the ERROR_QUEUE dead-letter queue.
 *
 * Design constraints:
 *   - Dark Bloqr theme: body bg #070B14, card bg #0E1829, accent #FF5500
 *   - Plain-text fallback is readable on its own (no image-only content)
 *   - No external images or tracking pixels
 *   - Table-based layout — compatible with Gmail, Outlook, Apple Mail
 *   - All styles inline; no flexbox, no grid
 *   - Canonical brand URL: https://bloqr.dev
 */

import { escapeHtml } from '../utils/escape-html.ts';

// ============================================================================
// Shared design tokens
// ============================================================================

const T = {
    /** Email body background (darkest). */
    bodyBg: '#070B14',
    /** Card / content area background. */
    cardBg: '#0E1829',
    /** Brand accent (orange). */
    accent: '#FF5500',
    /** Interactive link colour (cyan). */
    link: '#00D4FF',
    /** Primary text (near-white). */
    textPrimary: '#F0F4FF',
    /** Secondary / muted text. */
    textSecondary: '#D0D9F0',
    /** Subtle text (footer etc.). */
    textMuted: '#7A8BAA',
    /** Card border. */
    border: '#1D2E4A',
    /** Monospace font stack. */
    mono: 'Consolas, "Courier New", Courier, monospace',
    /** Body font stack. */
    sans: 'Arial, Helvetica, sans-serif',
} as const;

/** Wraps content HTML in the shared dark-theme outer layout. */
function wrapLayout(title: string, bodyContent: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${T.bodyBg};font-family:${T.sans};">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${T.bodyBg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!-- Card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;background-color:${T.cardBg};border:1px solid ${T.border};border-radius:8px;">
          <!-- Header bar -->
          <tr>
            <td style="padding:0;border-radius:8px 8px 0 0;background-color:${T.accent};height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Brand -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <a href="https://bloqr.dev" style="text-decoration:none;font-family:${T.sans};font-size:18px;font-weight:700;color:${T.accent};letter-spacing:-0.5px;">bloqr</a>
            </td>
          </tr>
          <!-- Body -->
${bodyContent}
          <!-- Footer -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top:1px solid ${T.border};padding-top:20px;font-family:${T.sans};font-size:12px;line-height:18px;color:${T.textMuted};">
                    <a href="https://bloqr.dev" style="color:${T.textMuted};text-decoration:none;">Bloqr</a>
                    &nbsp;&mdash;&nbsp;Internet Hygiene. Automated.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ============================================================================
// Compilation complete
// ============================================================================

export interface RenderCompilationCompleteOpts {
    readonly configName: string;
    readonly ruleCount: number;
    readonly durationMs: number;
    readonly requestId: string;
}

/**
 * Render the "compilation complete" email for a user whose filter list
 * compilation job has finished.
 */
export function renderCompilationComplete(opts: RenderCompilationCompleteOpts): {
    subject: string;
    html: string;
    text: string;
    replyTo: string;
} {
    const { configName, ruleCount, durationMs, requestId } = opts;
    const durationSec = (durationMs / 1000).toFixed(2);

    const subject = `Compilation complete — ${configName}`;

    const text = [
        `Your filter list compilation has finished.`,
        ``,
        `Configuration : ${configName}`,
        `Rules compiled: ${ruleCount.toLocaleString()}`,
        `Duration      : ${durationSec}s`,
        `Request ID    : ${requestId}`,
        ``,
        `Visit https://bloqr.dev to manage your filter lists.`,
        ``,
        `— The Bloqr team`,
    ].join('\n');

    const bodyContent = `
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${T.sans};font-size:22px;font-weight:700;line-height:28px;color:${T.textPrimary};">
                    &#x2705; Compilation complete
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px;font-family:${T.sans};font-size:15px;line-height:22px;color:${T.textSecondary};">
                    Your filter list has been compiled successfully.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Stats table -->
          <tr>
            <td style="padding:16px 32px 24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background-color:${T.bodyBg};border:1px solid ${T.border};border-radius:6px;">
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};border-bottom:1px solid ${T.border};width:160px;">Configuration</td>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textPrimary};font-weight:600;border-bottom:1px solid ${T.border};">${
        escapeHtml(configName)
    }</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};border-bottom:1px solid ${T.border};">Rules compiled</td>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textPrimary};font-weight:600;border-bottom:1px solid ${T.border};">${ruleCount.toLocaleString()}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};border-bottom:1px solid ${T.border};">Duration</td>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textPrimary};font-weight:600;border-bottom:1px solid ${T.border};">${durationSec}s</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};">Request ID</td>
                  <td style="padding:12px 16px;font-family:${T.mono};font-size:12px;line-height:18px;color:${T.textSecondary};">${escapeHtml(requestId)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${T.accent}" style="border-radius:5px;">
                    <a href="https://bloqr.dev"
                       style="display:inline-block;font-family:${T.sans};font-size:14px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;">
                      Manage filter lists
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

    const html = wrapLayout(subject, bodyContent);

    return { subject, html, text, replyTo: 'Bloqr Support <support@bloqr.dev>' };
}

// ============================================================================
// Critical error alert
// ============================================================================

export interface RenderCriticalErrorAlertOpts {
    readonly requestId: string;
    readonly path: string;
    readonly message: string;
    readonly timestamp: string;
}

/**
 * Render the "critical error alert" admin email for errors that land in the
 * ERROR_QUEUE dead-letter queue with `severity === 'critical'`.
 */
export function renderCriticalErrorAlert(opts: RenderCriticalErrorAlertOpts): {
    subject: string;
    html: string;
    text: string;
    replyTo: string;
} {
    const { requestId, path, message, timestamp } = opts;

    const subject = `[CRITICAL] Worker error — ${path}`;

    const text = [
        `A critical error has been recorded in the Bloqr Worker error queue.`,
        ``,
        `Path      : ${path}`,
        `Message   : ${message}`,
        `Request ID: ${requestId}`,
        `Timestamp : ${timestamp}`,
        ``,
        `Investigate at https://bloqr.dev/admin or via Cloudflare Workers Logs.`,
        ``,
        `— Bloqr automated alerting`,
    ].join('\n');

    const bodyContent = `
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${T.sans};font-size:22px;font-weight:700;line-height:28px;color:#FF4444;">
                    &#x1F6A8; Critical Worker Error
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px;font-family:${T.sans};font-size:15px;line-height:22px;color:${T.textSecondary};">
                    A critical-severity error has been received in the dead-letter queue.
                    Immediate investigation is recommended.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Details table -->
          <tr>
            <td style="padding:16px 32px 24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background-color:${T.bodyBg};border:1px solid #3D1515;border-radius:6px;">
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};border-bottom:1px solid ${T.border};width:120px;">Path</td>
                  <td style="padding:12px 16px;font-family:${T.mono};font-size:12px;line-height:18px;color:${T.textSecondary};border-bottom:1px solid ${T.border};">${
        escapeHtml(path)
    }</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};border-bottom:1px solid ${T.border};">Message</td>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textPrimary};font-weight:600;border-bottom:1px solid ${T.border};">${
        escapeHtml(message)
    }</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};border-bottom:1px solid ${T.border};">Request ID</td>
                  <td style="padding:12px 16px;font-family:${T.mono};font-size:12px;line-height:18px;color:${T.textSecondary};border-bottom:1px solid ${T.border};">${
        escapeHtml(requestId)
    }</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:18px;color:${T.textMuted};">Timestamp</td>
                  <td style="padding:12px 16px;font-family:${T.mono};font-size:12px;line-height:18px;color:${T.textSecondary};">${escapeHtml(timestamp)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CTAs -->
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${T.accent}" style="border-radius:5px;">
                    <a href="https://bloqr.dev/admin"
                       style="display:inline-block;font-family:${T.sans};font-size:14px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;">
                      Open admin panel
                    </a>
                  </td>
                  <td style="width:16px;">&nbsp;</td>
                  <td>
                    <a href="https://dash.cloudflare.com"
                       style="font-family:${T.sans};font-size:14px;line-height:20px;color:${T.link};text-decoration:none;">
                      Cloudflare dashboard &#x2192;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

    const html = wrapLayout(subject, bodyContent);

    return { subject, html, text, replyTo: 'Bloqr Admin <admin@bloqr.dev>' };
}

// ============================================================================
// Email verification
// ============================================================================

export interface RenderEmailVerificationOpts {
    readonly email: string;
    readonly url: string;
}

export function renderEmailVerification(opts: RenderEmailVerificationOpts): {
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
} {
    const { email, url } = opts;

    const subject = 'Verify your email address — Bloqr';

    const text = [
        `Hi,`,
        ``,
        `Please verify the email address for your Bloqr account: ${email}`,
        ``,
        `Verify your email: ${url}`,
        ``,
        `If you did not create a Bloqr account, you can safely ignore this email.`,
        ``,
        `— The Bloqr team`,
    ].join('\n');

    const bodyContent = `
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${T.sans};font-size:22px;font-weight:700;line-height:28px;color:${T.textPrimary};">
                    Verify your email address
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px;font-family:${T.sans};font-size:15px;line-height:22px;color:${T.textSecondary};">
                    Click the button below to verify
                    <strong style="color:${T.textPrimary};">${escapeHtml(email)}</strong>
                    and activate your Bloqr account.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${T.accent}" style="border-radius:5px;">
                    <a href="${escapeHtml(url)}"
                       style="display:inline-block;font-family:${T.sans};font-size:14px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:5px;">
                      Verify email address
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Fallback link -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="font-family:${T.sans};font-size:13px;line-height:20px;color:${T.textMuted};margin:0;">
                Or copy and paste this link into your browser:<br />
                <a href="${escapeHtml(url)}" style="color:${T.link};word-break:break-all;">${escapeHtml(url)}</a>
              </p>
            </td>
          </tr>
          <!-- Ignore notice -->
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <p style="font-family:${T.sans};font-size:13px;line-height:20px;color:${T.textMuted};margin:0;">
                If you did not create a Bloqr account, you can safely ignore this email.
              </p>
            </td>
          </tr>`;

    const html = wrapLayout(subject, bodyContent);

    return { subject, html, text };
}

// ============================================================================
// Password reset
// ============================================================================

export interface RenderPasswordResetOpts {
    readonly email: string;
    readonly url: string;
}

export function renderPasswordReset(opts: RenderPasswordResetOpts): {
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
} {
    const { email, url } = opts;

    const subject = 'Reset your password — Bloqr';

    const text = [
        `Hi,`,
        ``,
        `We received a request to reset the password for ${email}.`,
        `Click the link below to choose a new password:`,
        ``,
        `${url}`,
        ``,
        `This link expires in 1 hour.`,
        ``,
        `If you did not request a password reset, you can safely ignore this email.`,
        `Your password has not been changed.`,
        ``,
        `— The Bloqr team`,
    ].join('\n');

    const bodyContent = `
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${T.sans};font-size:22px;font-weight:700;line-height:28px;color:${T.textPrimary};">
                    Reset your password
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px;font-family:${T.sans};font-size:15px;line-height:22px;color:${T.textSecondary};">
                    We received a request to reset the password for
                    <strong style="color:${T.textPrimary};">${escapeHtml(email)}</strong>.
                    Click the button below to choose a new password.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${T.accent}" style="border-radius:5px;">
                    <a href="${escapeHtml(url)}"
                       style="display:inline-block;font-family:${T.sans};font-size:14px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:5px;">
                      Reset password
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Fallback link -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="font-family:${T.sans};font-size:13px;line-height:20px;color:${T.textMuted};margin:0;">
                Or copy and paste this link into your browser:<br />
                <a href="${escapeHtml(url)}" style="color:${T.link};word-break:break-all;">${escapeHtml(url)}</a>
              </p>
            </td>
          </tr>
          <!-- Expiry / ignore notice -->
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <p style="font-family:${T.sans};font-size:13px;line-height:20px;color:${T.textMuted};margin:0;">
                This link expires in 1 hour. If you did not request a password reset,
                you can safely ignore this email — your password has not been changed.
              </p>
            </td>
          </tr>`;

    const html = wrapLayout(subject, bodyContent);

    return { subject, html, text };
}

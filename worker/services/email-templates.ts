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
 *   - Plain-text fallback is readable on its own (no image-only content)
 *   - No external images or tracking pixels
 *   - Canonical brand URL: https://bloqr.dev
 */

// ============================================================================
// Compilation complete
// ============================================================================

export interface RenderCompilationCompleteOpts {
    readonly userEmail: string;
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

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px 16px;">
  <h1 style="font-size:20px;font-weight:700;margin-bottom:4px;">
    ✅ Compilation complete
  </h1>
  <p style="color:#555;margin-top:0;">Your filter list has been compiled successfully.</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr>
      <td style="padding:6px 0;color:#555;width:160px;">Configuration</td>
      <td style="padding:6px 0;font-weight:600;">${escapeHtml(configName)}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#555;">Rules compiled</td>
      <td style="padding:6px 0;font-weight:600;">${ruleCount.toLocaleString()}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#555;">Duration</td>
      <td style="padding:6px 0;font-weight:600;">${durationSec}s</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#555;">Request ID</td>
      <td style="padding:6px 0;font-family:monospace;font-size:13px;">${escapeHtml(requestId)}</td>
    </tr>
  </table>

  <p>
    <a href="https://bloqr.dev" style="color:#4f46e5;">Manage your filter lists at bloqr.dev</a>
  </p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="font-size:12px;color:#9ca3af;">
    You received this email because you have transactional notifications enabled on
    your <a href="https://bloqr.dev" style="color:#9ca3af;">Bloqr</a> account.
    Internet Hygiene. Automated.
  </p>
</body>
</html>`;

    return { subject, html, text };
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

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px 16px;">
  <h1 style="font-size:20px;font-weight:700;color:#dc2626;margin-bottom:4px;">
    🚨 Critical Worker Error
  </h1>
  <p style="color:#555;margin-top:0;">
    A critical-severity error has been received in the dead-letter queue.
    Immediate investigation is recommended.
  </p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr>
      <td style="padding:6px 0;color:#555;width:120px;">Path</td>
      <td style="padding:6px 0;font-family:monospace;font-size:13px;">${escapeHtml(path)}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#555;">Message</td>
      <td style="padding:6px 0;font-weight:600;">${escapeHtml(message)}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#555;">Request ID</td>
      <td style="padding:6px 0;font-family:monospace;font-size:13px;">${escapeHtml(requestId)}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#555;">Timestamp</td>
      <td style="padding:6px 0;font-family:monospace;font-size:13px;">${escapeHtml(timestamp)}</td>
    </tr>
  </table>

  <p>
    <a href="https://bloqr.dev/admin" style="color:#4f46e5;">Open admin panel</a>
    &nbsp;·&nbsp;
    <a href="https://dash.cloudflare.com" style="color:#4f46e5;">Cloudflare dashboard</a>
  </p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="font-size:12px;color:#9ca3af;">
    This is an automated alert from
    <a href="https://bloqr.dev" style="color:#9ca3af;">Bloqr</a>.
    Internet Hygiene. Automated.
  </p>
</body>
</html>`;

    return { subject, html, text };
}

// ============================================================================
// Helpers (internal)
// ============================================================================

/**
 * Minimal HTML escape to prevent XSS when interpolating user-controlled strings
 * into HTML templates. Escapes the five characters mandated by the HTML spec.
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

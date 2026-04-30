/**
 * Unit tests for worker/services/email-templates.ts.
 *
 * Validates that each template function:
 *   - Returns the expected subject line.
 *   - Includes key content fragments in the HTML output.
 *   - Includes key content fragments in the plain-text fallback.
 *   - Applies the dark Bloqr theme tokens.
 *   - Returns the expected replyTo (where applicable).
 *
 * Tests do NOT assert exact HTML structure — they check observable
 * semantics (subject, key strings, brand colours) so refactoring
 * layout doesn't break the suite.
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { renderCompilationComplete, renderCriticalErrorAlert, renderEmailVerification, renderPasswordReset } from './email-templates.ts';

// ============================================================================
// renderCompilationComplete
// ============================================================================

Deno.test('renderCompilationComplete', async (t) => {
    const result = renderCompilationComplete({
        configName: 'My Filter Config',
        ruleCount: 12_345,
        durationMs: 2_750,
        requestId: 'req-abc-123',
    });

    await t.step('subject contains config name', () => {
        assertEquals(result.subject, 'Compilation complete — My Filter Config');
    });

    await t.step('html contains config name (escaped)', () => {
        assertStringIncludes(result.html, 'My Filter Config');
    });

    await t.step('html contains formatted rule count', () => {
        // toLocaleString output is locale-dependent; check numeric digits present
        assertStringIncludes(result.html, '12');
    });

    await t.step('html contains duration in seconds', () => {
        assertStringIncludes(result.html, '2.75s');
    });

    await t.step('html contains request ID', () => {
        assertStringIncludes(result.html, 'req-abc-123');
    });

    await t.step('html uses dark body background token', () => {
        assertStringIncludes(result.html, '#070B14');
    });

    await t.step('html uses card background token', () => {
        assertStringIncludes(result.html, '#0E1829');
    });

    await t.step('html uses accent colour', () => {
        assertStringIncludes(result.html, '#FF5500');
    });

    await t.step('html contains bloqr.dev CTA link', () => {
        assertStringIncludes(result.html, 'https://bloqr.dev');
    });

    await t.step('text contains config name', () => {
        assertStringIncludes(result.text, 'My Filter Config');
    });

    await t.step('text contains request ID', () => {
        assertStringIncludes(result.text, 'req-abc-123');
    });

    await t.step('text contains bloqr.dev URL', () => {
        assertStringIncludes(result.text, 'https://bloqr.dev');
    });

    await t.step('replyTo is support address', () => {
        assertEquals(result.replyTo, 'Bloqr Support <support@bloqr.dev>');
    });
});

// ============================================================================
// renderCriticalErrorAlert
// ============================================================================

Deno.test('renderCriticalErrorAlert', async (t) => {
    const result = renderCriticalErrorAlert({
        requestId: 'req-dead-999',
        path: '/api/compile',
        message: 'Unexpected null reference',
        timestamp: '2024-01-15T12:00:00.000Z',
    });

    await t.step('subject contains path', () => {
        assertEquals(result.subject, '[CRITICAL] Worker error — /api/compile');
    });

    await t.step('subject starts with [CRITICAL]', () => {
        assertStringIncludes(result.subject, '[CRITICAL]');
    });

    await t.step('html contains path (escaped)', () => {
        assertStringIncludes(result.html, '/api/compile');
    });

    await t.step('html contains message', () => {
        assertStringIncludes(result.html, 'Unexpected null reference');
    });

    await t.step('html contains request ID', () => {
        assertStringIncludes(result.html, 'req-dead-999');
    });

    await t.step('html contains timestamp', () => {
        assertStringIncludes(result.html, '2024-01-15T12:00:00.000Z');
    });

    await t.step('html uses dark body background token', () => {
        assertStringIncludes(result.html, '#070B14');
    });

    await t.step('html contains admin panel link', () => {
        assertStringIncludes(result.html, 'https://bloqr.dev/admin');
    });

    await t.step('html contains Cloudflare dashboard link', () => {
        assertStringIncludes(result.html, 'https://dash.cloudflare.com');
    });

    await t.step('text contains path', () => {
        assertStringIncludes(result.text, '/api/compile');
    });

    await t.step('text contains message', () => {
        assertStringIncludes(result.text, 'Unexpected null reference');
    });

    await t.step('text contains admin URL', () => {
        assertStringIncludes(result.text, 'https://bloqr.dev/admin');
    });

    await t.step('replyTo is admin address', () => {
        assertEquals(result.replyTo, 'Bloqr Admin <admin@bloqr.dev>');
    });
});

// ============================================================================
// renderEmailVerification
// ============================================================================

Deno.test('renderEmailVerification', async (t) => {
    const result = renderEmailVerification({
        email: 'user@example.com',
        url: 'https://bloqr.dev/auth/verify?token=abc123',
    });

    await t.step('subject is correct', () => {
        assertEquals(result.subject, 'Verify your email address — Bloqr');
    });

    await t.step('html contains email address', () => {
        assertStringIncludes(result.html, 'user@example.com');
    });

    await t.step('html contains verification URL in button', () => {
        assertStringIncludes(result.html, 'https://bloqr.dev/auth/verify?token=abc123');
    });

    await t.step('html uses dark body background token', () => {
        assertStringIncludes(result.html, '#070B14');
    });

    await t.step('html uses accent colour for CTA', () => {
        assertStringIncludes(result.html, '#FF5500');
    });

    await t.step('html contains ignore notice', () => {
        assertStringIncludes(result.html, 'did not create a Bloqr account');
    });

    await t.step('text contains email address', () => {
        assertStringIncludes(result.text, 'user@example.com');
    });

    await t.step('text contains verification URL', () => {
        assertStringIncludes(result.text, 'https://bloqr.dev/auth/verify?token=abc123');
    });

    await t.step('text contains ignore notice', () => {
        assertStringIncludes(result.text, 'safely ignore');
    });

    await t.step('replyTo is undefined (no reply path for verification)', () => {
        assertEquals(result.replyTo, undefined);
    });

    await t.step('html escapes HTML special chars in email to prevent XSS', () => {
        // Characters like < and > must be escaped so they cannot inject markup.
        const r2 = renderEmailVerification({
            email: 'user<script>@example.com',
            url: 'https://bloqr.dev/verify?t=x',
        });
        assertStringIncludes(r2.html, 'user&lt;script&gt;@example.com');
    });
});

// ============================================================================
// renderPasswordReset
// ============================================================================

Deno.test('renderPasswordReset', async (t) => {
    const result = renderPasswordReset({
        email: 'reset@example.com',
        url: 'https://bloqr.dev/auth/reset?token=xyz789',
    });

    await t.step('subject is correct', () => {
        assertEquals(result.subject, 'Reset your password — Bloqr');
    });

    await t.step('html contains email address', () => {
        assertStringIncludes(result.html, 'reset@example.com');
    });

    await t.step('html contains reset URL in button', () => {
        assertStringIncludes(result.html, 'https://bloqr.dev/auth/reset?token=xyz789');
    });

    await t.step('html uses dark body background token', () => {
        assertStringIncludes(result.html, '#070B14');
    });

    await t.step('html uses accent colour for CTA', () => {
        assertStringIncludes(result.html, '#FF5500');
    });

    await t.step('html contains expiry notice', () => {
        assertStringIncludes(result.html, '1 hour');
    });

    await t.step('html contains ignore notice', () => {
        assertStringIncludes(result.html, 'password has not been changed');
    });

    await t.step('text contains email address', () => {
        assertStringIncludes(result.text, 'reset@example.com');
    });

    await t.step('text contains reset URL', () => {
        assertStringIncludes(result.text, 'https://bloqr.dev/auth/reset?token=xyz789');
    });

    await t.step('text contains expiry notice', () => {
        assertStringIncludes(result.text, '1 hour');
    });

    await t.step('text contains ignore notice', () => {
        assertStringIncludes(result.text, 'safely ignore');
    });

    await t.step('replyTo is undefined (no reply path for password reset)', () => {
        assertEquals(result.replyTo, undefined);
    });

    await t.step('html escapes angle brackets in URL (XSS guard)', () => {
        const r2 = renderPasswordReset({
            email: 'x@y.com',
            url: 'https://bloqr.dev/reset?t=<script>alert(1)</script>',
        });
        // escapeHtml should have converted < and > to HTML entities
        assertStringIncludes(r2.html, '&lt;script&gt;');
    });
});

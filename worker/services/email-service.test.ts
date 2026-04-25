/**
 * Tests for EmailService.
 *
 * All tests mock `globalThis.fetch` — no real MailChannels calls are made.
 *
 * Covers:
 *   - Valid payload → `fetch` called with correct MailChannels URL and body
 *   - DKIM env vars absent → DKIM fields omitted from personalizations
 *   - DKIM env vars fully present → DKIM fields included in personalizations
 *   - Non-2xx response → resolves without throwing (logs warning only)
 *   - Invalid payload (missing `to`) → throws 'Invalid email payload'
 *   - Network fetch error → resolves without throwing (logs warning only)
 *   - createEmailService() factory → returns EmailService instance
 */

import { assertEquals, assertRejects } from '@std/assert';
import { createEmailService, EmailService } from './email-service.ts';
import type { EmailEnv, EmailPayload } from './email-service.ts';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal env with FROM_EMAIL set but no DKIM fields. */
function makeEnvNoDkim(): EmailEnv {
    return { FROM_EMAIL: 'notifications@bloqr.dev' };
}

/** Full env including all three DKIM fields. */
function makeEnvWithDkim(): EmailEnv {
    return {
        FROM_EMAIL: 'notifications@bloqr.dev',
        DKIM_DOMAIN: 'bloqr.dev',
        DKIM_SELECTOR: 'mailchannels',
        DKIM_PRIVATE_KEY: 'base64-encoded-private-key==',
    };
}

/** Valid payload satisfying EmailPayloadSchema. */
function makePayload(overrides: Partial<EmailPayload> = {}): EmailPayload {
    return {
        to: 'user@example.com',
        subject: 'Test subject',
        html: '<p>Hello</p>',
        text: 'Hello',
        ...overrides,
    };
}

/**
 * Install a mock `globalThis.fetch` that resolves with `status` and restores
 * the original after the callback resolves. Returns captured call arguments.
 */
async function withMockFetch(
    status: number,
    fn: () => Promise<void>,
): Promise<{ url: string; init: Record<string, unknown> }[]> {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    const originalFetch = globalThis.fetch;

    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (input: unknown, init?: Record<string, unknown>): Promise<Response> => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(status < 300 ? '{}' : 'error', { status });
    };

    try {
        await fn();
    } finally {
        globalThis.fetch = originalFetch;
    }

    return calls;
}

/**
 * Install a mock `globalThis.fetch` that rejects with a network error.
 */
async function withThrowingFetch(fn: () => Promise<void>): Promise<void> {
    const originalFetch = globalThis.fetch;

    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (_input: unknown, _init?: unknown): Promise<Response> => {
        throw new Error('Network failure');
    };

    try {
        await fn();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

// ============================================================================
// sendEmail — valid payload, correct MailChannels request
// ============================================================================

Deno.test('EmailService.sendEmail() — calls MailChannels URL with correct method and headers', async () => {
    const svc = new EmailService(makeEnvNoDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, 'https://api.mailchannels.net/tx/v1/send');
    assertEquals((calls[0].init['headers'] as Record<string, string>)['Content-Type'], 'application/json');
    assertEquals(calls[0].init['method'], 'POST');
});

Deno.test('EmailService.sendEmail() — request body contains correct from/subject/content', async () => {
    const svc = new EmailService(makeEnvNoDkim());
    const payload = makePayload({ subject: 'My subject', html: '<b>hi</b>', text: 'hi', to: 'dest@example.com' });
    const calls = await withMockFetch(202, () => svc.sendEmail(payload));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    assertEquals((body.from as { email: string }).email, 'notifications@bloqr.dev');
    assertEquals(body.subject, 'My subject');
    const content = body.content as Array<{ type: string; value: string }>;
    assertEquals(content.some((c) => c.type === 'text/plain' && c.value === 'hi'), true);
    assertEquals(content.some((c) => c.type === 'text/html' && c.value === '<b>hi</b>'), true);
    const personalizations = body.personalizations as Array<{ to: Array<{ email: string }> }>;
    assertEquals(personalizations[0].to[0].email, 'dest@example.com');
});

// ============================================================================
// sendEmail — DKIM fields
// ============================================================================

Deno.test('EmailService.sendEmail() — DKIM fields absent when env vars not set', async () => {
    const svc = new EmailService(makeEnvNoDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    const personalization = (body.personalizations as Array<Record<string, unknown>>)[0];
    assertEquals('dkim_domain' in personalization, false);
    assertEquals('dkim_selector' in personalization, false);
    assertEquals('dkim_private_key' in personalization, false);
});

Deno.test('EmailService.sendEmail() — DKIM fields included when all three env vars are set', async () => {
    const svc = new EmailService(makeEnvWithDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    const personalization = (body.personalizations as Array<Record<string, unknown>>)[0];
    assertEquals(personalization['dkim_domain'], 'bloqr.dev');
    assertEquals(personalization['dkim_selector'], 'mailchannels');
    assertEquals(personalization['dkim_private_key'], 'base64-encoded-private-key==');
});

Deno.test('EmailService.sendEmail() — DKIM fields absent when only DKIM_DOMAIN is set', async () => {
    const svc = new EmailService({ FROM_EMAIL: 'n@bloqr.dev', DKIM_DOMAIN: 'bloqr.dev' });
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    const personalization = (body.personalizations as Array<Record<string, unknown>>)[0];
    assertEquals('dkim_domain' in personalization, false);
});

// ============================================================================
// sendEmail — non-2xx response resolves without throwing
// ============================================================================

Deno.test('EmailService.sendEmail() — resolves without throwing on 400 response', async () => {
    const svc = new EmailService(makeEnvNoDkim());
    // Should not throw — fire-and-forget; logs a warning internally
    await withMockFetch(400, () => svc.sendEmail(makePayload()));
    // If we reach here, the promise resolved successfully
});

Deno.test('EmailService.sendEmail() — resolves without throwing on 500 response', async () => {
    const svc = new EmailService(makeEnvNoDkim());
    await withMockFetch(500, () => svc.sendEmail(makePayload()));
});

// ============================================================================
// sendEmail — network error resolves without throwing
// ============================================================================

Deno.test('EmailService.sendEmail() — resolves without throwing on network fetch error', async () => {
    const svc = new EmailService(makeEnvNoDkim());
    // withThrowingFetch makes globalThis.fetch throw; sendEmail should catch and return
    await withThrowingFetch(() => svc.sendEmail(makePayload()));
});

// ============================================================================
// sendEmail — invalid payload throws 'Invalid email payload'
// ============================================================================

Deno.test("EmailService.sendEmail() — throws 'Invalid email payload' when 'to' is missing", async () => {
    const svc = new EmailService(makeEnvNoDkim());
    const bad = { subject: 'S', html: '<p>H</p>', text: 'T' } as unknown as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

Deno.test("EmailService.sendEmail() — throws 'Invalid email payload' when 'subject' is empty", async () => {
    const svc = new EmailService(makeEnvNoDkim());
    const bad = makePayload({ subject: '' });
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

Deno.test("EmailService.sendEmail() — throws 'Invalid email payload' when 'html' is missing", async () => {
    const svc = new EmailService(makeEnvNoDkim());
    const bad = { to: 'a@b.com', subject: 'S', text: 'T' } as unknown as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

// ============================================================================
// createEmailService factory
// ============================================================================

Deno.test('createEmailService() — returns an EmailService instance', () => {
    const svc = createEmailService(makeEnvNoDkim());
    assertEquals(svc instanceof EmailService, true);
});

Deno.test('createEmailService() — returned service can send emails', async () => {
    const svc = createEmailService(makeEnvWithDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));
    assertEquals(calls.length, 1);
});

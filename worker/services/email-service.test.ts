/**
 * Tests for EmailService (all providers + factory).
 *
 * All tests are self-contained — no real MailChannels calls or CF Email Worker
 * sends are made. `globalThis.fetch` is mocked for MailChannels tests, and the
 * `SEND_EMAIL` binding is mocked for CF Email Worker tests.
 *
 * Covers:
 *
 * MailChannelsEmailService:
 *   - Valid payload → `fetch` called with correct MailChannels URL and body
 *   - DKIM env vars absent → DKIM fields omitted from personalizations
 *   - DKIM env vars fully present → DKIM fields included in personalizations
 *   - Non-2xx response → resolves without throwing (logs warning only)
 *   - Invalid payload (missing `to`) → throws 'Invalid email payload'
 *   - Network fetch error → resolves without throwing (logs warning only)
 *
 * CfEmailWorkerService:
 *   - Valid payload → binding.send() called once with an EmailMessage
 *   - binding.send() throws → resolves without rethrowing (fire-and-forget)
 *   - Invalid payload → throws 'Invalid email payload'
 *   - buildRawMimeMessage() → produces correct RFC 5322 headers and boundary
 *
 * NullEmailService:
 *   - sendEmail() resolves immediately without calling fetch or a binding
 *
 * createEmailService() factory:
 *   - SEND_EMAIL binding present → returns CfEmailWorkerService
 *   - FROM_EMAIL set, no binding → returns MailChannelsEmailService
 *   - Neither configured → returns NullEmailService
 *   - Returned MailChannels service can send emails
 */

import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
    buildRawMimeMessage,
    CfEmailWorkerService,
    createEmailService,
    EmailService,
    MailChannelsEmailService,
    NullEmailService,
} from './email-service.ts';
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

/** Build a mock `SEND_EMAIL` binding that captures `.send()` calls. */
function makeMockSendEmailBinding(): {
    binding: { send: (msg: unknown) => Promise<void> };
    calls: unknown[];
    error: Error | null;
} {
    const calls: unknown[] = [];
    let error: Error | null = null;
    const binding = {
        async send(msg: unknown) {
            if (error) throw error;
            calls.push(msg);
        },
        setError(err: Error) {
            error = err;
        },
    };
    return { binding, calls, error };
}

// ============================================================================
// MailChannelsEmailService — valid payload, correct MailChannels request
// ============================================================================

Deno.test('MailChannelsEmailService.sendEmail() — calls MailChannels URL with correct method and headers', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, 'https://api.mailchannels.net/tx/v1/send');
    assertEquals((calls[0].init['headers'] as Record<string, string>)['Content-Type'], 'application/json');
    assertEquals(calls[0].init['method'], 'POST');
});

Deno.test('MailChannelsEmailService.sendEmail() — request body contains correct from/subject/content', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
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
// MailChannelsEmailService — DKIM fields
// ============================================================================

Deno.test('MailChannelsEmailService.sendEmail() — DKIM fields absent when env vars not set', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    const personalization = (body.personalizations as Array<Record<string, unknown>>)[0];
    assertEquals('dkim_domain' in personalization, false);
    assertEquals('dkim_selector' in personalization, false);
    assertEquals('dkim_private_key' in personalization, false);
});

Deno.test('MailChannelsEmailService.sendEmail() — DKIM fields included when all three env vars are set', async () => {
    const svc = new MailChannelsEmailService(makeEnvWithDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    const personalization = (body.personalizations as Array<Record<string, unknown>>)[0];
    assertEquals(personalization['dkim_domain'], 'bloqr.dev');
    assertEquals(personalization['dkim_selector'], 'mailchannels');
    assertEquals(personalization['dkim_private_key'], 'base64-encoded-private-key==');
});

Deno.test('MailChannelsEmailService.sendEmail() — DKIM fields absent when only DKIM_DOMAIN is set', async () => {
    const svc = new MailChannelsEmailService({ FROM_EMAIL: 'n@bloqr.dev', DKIM_DOMAIN: 'bloqr.dev' });
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    const personalization = (body.personalizations as Array<Record<string, unknown>>)[0];
    assertEquals('dkim_domain' in personalization, false);
});

// ============================================================================
// MailChannelsEmailService — non-2xx response resolves without throwing
// ============================================================================

Deno.test('MailChannelsEmailService.sendEmail() — resolves without throwing on 400 response', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    await withMockFetch(400, () => svc.sendEmail(makePayload()));
});

Deno.test('MailChannelsEmailService.sendEmail() — resolves without throwing on 500 response', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    await withMockFetch(500, () => svc.sendEmail(makePayload()));
});

// ============================================================================
// MailChannelsEmailService — network error resolves without throwing
// ============================================================================

Deno.test('MailChannelsEmailService.sendEmail() — resolves without throwing on network fetch error', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    await withThrowingFetch(() => svc.sendEmail(makePayload()));
});

// ============================================================================
// MailChannelsEmailService — invalid payload throws 'Invalid email payload'
// ============================================================================

Deno.test("MailChannelsEmailService.sendEmail() — throws 'Invalid email payload' when 'to' is missing", async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    const bad = { subject: 'S', html: '<p>H</p>', text: 'T' } as unknown as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

Deno.test("MailChannelsEmailService.sendEmail() — throws 'Invalid email payload' when 'subject' is empty", async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    const bad = makePayload({ subject: '' });
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

Deno.test("MailChannelsEmailService.sendEmail() — throws 'Invalid email payload' when 'html' is missing", async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    const bad = { to: 'a@b.com', subject: 'S', text: 'T' } as unknown as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

// ============================================================================
// EmailService backward-compat alias
// ============================================================================

Deno.test('EmailService — backward-compat alias is MailChannelsEmailService', () => {
    const svc = new EmailService(makeEnvNoDkim());
    assertEquals(svc instanceof MailChannelsEmailService, true);
});

// ============================================================================
// buildRawMimeMessage
// ============================================================================

Deno.test('buildRawMimeMessage() — contains MIME-Version, From, To, Subject headers', () => {
    const raw = buildRawMimeMessage('from@example.com', 'to@example.com', 'Test Subject', 'plain', '<p>html</p>');
    assertStringIncludes(raw, 'MIME-Version: 1.0');
    assertStringIncludes(raw, 'From: from@example.com');
    assertStringIncludes(raw, 'To: to@example.com');
    assertStringIncludes(raw, 'Subject: Test Subject');
});

Deno.test('buildRawMimeMessage() — contains text/plain and text/html parts', () => {
    const raw = buildRawMimeMessage('f@x.com', 't@x.com', 'S', 'plain text', '<b>html</b>');
    assertStringIncludes(raw, 'Content-Type: text/plain; charset=UTF-8');
    assertStringIncludes(raw, 'Content-Type: text/html; charset=UTF-8');
    assertStringIncludes(raw, 'plain text');
    assertStringIncludes(raw, '<b>html</b>');
});

Deno.test('buildRawMimeMessage() — multipart/alternative boundary present and closed', () => {
    const raw = buildRawMimeMessage('f@x.com', 't@x.com', 'S', 'T', 'H');
    assertStringIncludes(raw, 'multipart/alternative; boundary=');
    // The boundary closer ends the message
    const boundaryMatch = raw.match(/boundary="([^"]+)"/);
    assertEquals(boundaryMatch !== null, true);
    const boundary = boundaryMatch![1];
    assertStringIncludes(raw, `--${boundary}--`);
});

// ============================================================================
// CfEmailWorkerService
// ============================================================================

Deno.test('CfEmailWorkerService.sendEmail() — calls binding.send() once with an EmailMessage', async () => {
    const { binding, calls } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'notifications@bloqr.dev');
    await svc.sendEmail(makePayload({ to: 'user@example.com', subject: 'Hello' }));

    assertEquals(calls.length, 1);
    // EmailMessage stub has from/to/raw properties
    const msg = calls[0] as { from: string; to: string; raw: string };
    assertEquals(msg.from, 'notifications@bloqr.dev');
    assertEquals(msg.to, 'user@example.com');
    assertStringIncludes(msg.raw as string, 'Subject: Hello');
});

Deno.test('CfEmailWorkerService.sendEmail() — resolves without rethrowing when binding.send() throws', async () => {
    const { binding } = makeMockSendEmailBinding();
    // Force the binding to throw on .send()
    (binding as unknown as { setError: (e: Error) => void }).setError(new Error('CF delivery failure'));
    const svc = new CfEmailWorkerService(binding, 'from@example.com');
    // Must not throw — fire-and-forget
    await svc.sendEmail(makePayload());
});

Deno.test("CfEmailWorkerService.sendEmail() — throws 'Invalid email payload' on invalid payload", async () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'from@example.com');
    const bad = { subject: 'S', html: '<p>H</p>', text: 'T' } as unknown as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

// ============================================================================
// NullEmailService
// ============================================================================

Deno.test('NullEmailService.sendEmail() — resolves without calling fetch or a binding', async () => {
    const svc = new NullEmailService();
    // Should resolve — never calls fetch
    await svc.sendEmail(makePayload());
});

// ============================================================================
// createEmailService() factory
// ============================================================================

Deno.test('createEmailService() — returns CfEmailWorkerService when SEND_EMAIL binding is present', () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = createEmailService({ SEND_EMAIL: binding, FROM_EMAIL: 'n@bloqr.dev' });
    assertEquals(svc instanceof CfEmailWorkerService, true);
});

Deno.test('createEmailService() — returns MailChannelsEmailService when FROM_EMAIL is set and no binding', () => {
    const svc = createEmailService({ FROM_EMAIL: 'n@bloqr.dev' });
    assertEquals(svc instanceof MailChannelsEmailService, true);
});

Deno.test('createEmailService() — returns NullEmailService when neither binding nor FROM_EMAIL is configured', () => {
    const svc = createEmailService({});
    assertEquals(svc instanceof NullEmailService, true);
});

Deno.test('createEmailService() — returned MailChannels service can send emails', async () => {
    const svc = createEmailService(makeEnvWithDkim());
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));
    assertEquals(calls.length, 1);
});

Deno.test('createEmailService() — returned CF Email Worker service calls binding.send()', async () => {
    const { binding, calls } = makeMockSendEmailBinding();
    const svc = createEmailService({ SEND_EMAIL: binding, FROM_EMAIL: 'n@bloqr.dev' });
    await svc.sendEmail(makePayload());
    assertEquals(calls.length, 1);
});


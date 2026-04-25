/**
 * Tests for EmailService (all providers + factory).
 *
 * All tests are self-contained — no real MailChannels calls or CF Email Worker
 * sends are made. `globalThis.fetch` is mocked for MailChannels tests, and the
 * `SEND_EMAIL` binding is mocked for CF Email Worker tests.
 *
 * Covers:
 *
 * parseEmailAddress():
 *   - Plain address → returns { email }
 *   - Display-name format → returns { email, name }
 *   - Quoted display-name → strips quotes, returns { email, name }
 *
 * encodeSubjectRfc2047():
 *   - Pure ASCII subject → returned unchanged
 *   - Subject with emoji → wrapped in =?UTF-8?B?...?= encoded word
 *   - Subject with em-dash → wrapped in encoded word
 *
 * EmailPayloadSchema:
 *   - Subject with CR → rejected with 'must not contain CR or LF characters'
 *   - Subject with LF → rejected with 'must not contain CR or LF characters'
 *
 * MailChannelsEmailService:
 *   - Valid payload → `fetch` called with correct MailChannels URL and body
 *   - FROM_EMAIL display-name format → from.email is bare, from.name populated
 *   - DKIM env vars absent → DKIM fields omitted from personalizations
 *   - DKIM env vars fully present → DKIM fields included in personalizations
 *   - Non-2xx response → resolves without throwing (logs warning only)
 *   - Invalid payload (missing `to`) → throws 'Invalid email payload'
 *   - Network fetch error → resolves without throwing (logs warning only)
 *
 * CfEmailWorkerService:
 *   - Valid payload → binding.send() called once with an EmailMessage
 *   - Display-name FROM_EMAIL → envelope uses bare address, MIME From: has display name
 *   - binding.send() throws → resolves without rethrowing (fire-and-forget)
 *   - Invalid payload → throws 'Invalid email payload'
 *   - buildRawMimeMessage() → produces correct RFC 5322 headers and boundary
 *   - Non-ASCII subject → RFC 2047 encoded in Subject header
 *
 * NullEmailService:
 *   - sendEmail() resolves immediately without calling fetch or a binding
 *
 * QueuedEmailService:
 *   - Valid payload → queue.send() called once with correct message shape
 *   - Invalid payload → throws 'Invalid email payload'
 *   - queue.send() throws → resolves without rethrowing (fire-and-forget contract)
 *   - idempotencyKey derived from requestId option
 *   - reason field included in queue message when provided
 *
 * createEmailService() factory:
 *   - EMAIL_QUEUE binding present (useQueue=true default) → returns QueuedEmailService
 *   - EMAIL_QUEUE present but useQueue=false → skips queue, uses SEND_EMAIL binding
 *   - SEND_EMAIL binding present, no EMAIL_QUEUE → returns CfEmailWorkerService
 *   - FROM_EMAIL set, no binding or queue → returns MailChannelsEmailService
 *   - Neither configured → returns NullEmailService
 *   - Returned MailChannels service can send emails
 */

import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
    buildRawMimeMessage,
    CfEmailWorkerService,
    createEmailService,
    encodeSubjectRfc2047,
    MailChannelsEmailService,
    NullEmailService,
    parseEmailAddress,
    QueuedEmailService,
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
// parseEmailAddress
// ============================================================================

Deno.test('parseEmailAddress() — plain address returns { email }', () => {
    const result = parseEmailAddress('notifications@bloqr.dev');
    assertEquals(result, { email: 'notifications@bloqr.dev' });
});

Deno.test('parseEmailAddress() — display-name format returns { email, name }', () => {
    const result = parseEmailAddress('Bloqr <notifications@bloqr.dev>');
    assertEquals(result, { email: 'notifications@bloqr.dev', name: 'Bloqr' });
});

Deno.test('parseEmailAddress() — quoted display-name strips quotes', () => {
    const result = parseEmailAddress('"Bloqr Notifications" <noreply@bloqr.dev>');
    assertEquals(result, { email: 'noreply@bloqr.dev', name: 'Bloqr Notifications' });
});

Deno.test('parseEmailAddress() — address with no display name has no name field', () => {
    const result = parseEmailAddress('plain@bloqr.dev');
    assertEquals(result.email, 'plain@bloqr.dev');
    assertEquals(result.name, undefined);
});

// ============================================================================
// encodeSubjectRfc2047
// ============================================================================

Deno.test('encodeSubjectRfc2047() — pure ASCII subject returned unchanged', () => {
    assertEquals(encodeSubjectRfc2047('Hello World'), 'Hello World');
    assertEquals(encodeSubjectRfc2047('[CRITICAL] Error in /api/compile'), '[CRITICAL] Error in /api/compile');
    assertEquals(encodeSubjectRfc2047('Compilation complete (3 rules)'), 'Compilation complete (3 rules)');
});

Deno.test('encodeSubjectRfc2047() — subject with emoji is wrapped in RFC 2047 encoded word', () => {
    const encoded = encodeSubjectRfc2047('✅ Compilation complete');
    // Must start with =?UTF-8?B? (RFC 2047 Base64 encoded word)
    assertStringIncludes(encoded, '=?UTF-8?B?');
    assertStringIncludes(encoded, '?=');
    // Must NOT contain the raw emoji
    assertEquals(encoded.includes('✅'), false);
});

Deno.test('encodeSubjectRfc2047() — subject with em-dash is RFC 2047 encoded', () => {
    const encoded = encodeSubjectRfc2047('Result — done');
    assertStringIncludes(encoded, '=?UTF-8?B?');
    assertEquals(encoded.includes('—'), false);
});

// ============================================================================
// EmailPayloadSchema — CRLF rejection
// ============================================================================

Deno.test('EmailPayloadSchema — subject with CR character is rejected', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    await assertRejects(
        () => svc.sendEmail(makePayload({ subject: 'Bad\rSubject' })),
        Error,
        'Invalid email payload',
    );
});

Deno.test('EmailPayloadSchema — subject with LF character is rejected', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    await assertRejects(
        () => svc.sendEmail(makePayload({ subject: 'Injected\nHeader: x' })),
        Error,
        'Invalid email payload',
    );
});

Deno.test('EmailPayloadSchema — subject with CRLF sequence is rejected', async () => {
    const svc = new MailChannelsEmailService(makeEnvNoDkim());
    await assertRejects(
        () => svc.sendEmail(makePayload({ subject: 'Bad\r\nHeader: injected' })),
        Error,
        'Invalid email payload',
    );
});

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

Deno.test('MailChannelsEmailService.sendEmail() — display-name FROM_EMAIL sets from.email (bare) and from.name', async () => {
    const svc = new MailChannelsEmailService({ FROM_EMAIL: 'Bloqr Notifications <noreply@bloqr.dev>' });
    const calls = await withMockFetch(202, () => svc.sendEmail(makePayload()));

    const body = JSON.parse(calls[0].init['body'] as string) as Record<string, unknown>;
    const from = body.from as { email: string; name?: string };
    assertEquals(from.email, 'noreply@bloqr.dev');
    assertEquals(from.name, 'Bloqr Notifications');
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

Deno.test('CfEmailWorkerService.sendEmail() — display-name address: envelope uses bare email, MIME From has display name', async () => {
    const { binding, calls } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'Bloqr <notifications@bloqr.dev>');
    await svc.sendEmail(makePayload({ to: 'user@example.com', subject: 'Hi' }));

    assertEquals(calls.length, 1);
    const msg = calls[0] as { from: string; to: string; raw: string };
    // Envelope 'from' must be the bare email address (no display name)
    assertEquals(msg.from, 'notifications@bloqr.dev');
    assertEquals(msg.to, 'user@example.com');
    // MIME From: header may include the display name
    assertStringIncludes(msg.raw as string, 'From: Bloqr <notifications@bloqr.dev>');
});

Deno.test('CfEmailWorkerService.sendEmail() — non-ASCII subject is RFC 2047 encoded in MIME header', async () => {
    const { binding, calls } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await svc.sendEmail(makePayload({ subject: '✅ Compilation complete' }));

    assertEquals(calls.length, 1);
    const msg = calls[0] as { from: string; to: string; raw: string };
    // The raw MIME must not contain the bare emoji in the Subject header
    const subjectLine = (msg.raw as string).split('\r\n').find((l) => l.startsWith('Subject:'));
    assertEquals(subjectLine !== undefined, true);
    assertEquals(subjectLine!.includes('✅'), false);
    assertStringIncludes(subjectLine!, '=?UTF-8?B?');
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

function makeMockQueue(): { queue: { send: (msg: unknown, opts?: unknown) => Promise<void> }; messages: unknown[] } {
    const messages: unknown[] = [];
    return {
        queue: {
            async send(msg: unknown, _opts?: unknown) {
                messages.push(msg);
            },
        },
        messages,
    };
}

Deno.test('createEmailService() — returns QueuedEmailService when EMAIL_QUEUE binding is present (default useQueue=true)', () => {
    const { queue } = makeMockQueue();
    const { binding } = makeMockSendEmailBinding();
    const svc = createEmailService({ EMAIL_QUEUE: queue, SEND_EMAIL: binding, FROM_EMAIL: 'n@bloqr.dev' });
    assertEquals(svc instanceof QueuedEmailService, true);
});

Deno.test('createEmailService() — skips queue and returns CfEmailWorkerService when useQueue=false', () => {
    const { queue } = makeMockQueue();
    const { binding } = makeMockSendEmailBinding();
    const svc = createEmailService({ EMAIL_QUEUE: queue, SEND_EMAIL: binding, FROM_EMAIL: 'n@bloqr.dev' }, { useQueue: false });
    assertEquals(svc instanceof CfEmailWorkerService, true);
});

Deno.test('createEmailService() — returns CfEmailWorkerService when SEND_EMAIL binding is present (no EMAIL_QUEUE)', () => {
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

// ============================================================================
// QueuedEmailService
// ============================================================================

Deno.test('QueuedEmailService.sendEmail() — valid payload enqueues message with correct shape', async () => {
    const { queue, messages } = makeMockQueue();
    const svc = new QueuedEmailService(queue, { requestId: 'req-123', reason: 'test' });
    await svc.sendEmail(makePayload());
    assertEquals(messages.length, 1);
    const msg = messages[0] as Record<string, unknown>;
    assertEquals(msg['type'], 'email');
    assertEquals(msg['reason'], 'test');
    assertEquals((msg['payload'] as Record<string, unknown>)['to'], 'user@example.com');
    assertEquals(typeof msg['timestamp'], 'number');
    assertEquals(typeof msg['idempotencyKey'], 'string');
    assertStringIncludes(msg['idempotencyKey'] as string, 'req-123');
});

Deno.test('QueuedEmailService.sendEmail() — invalid payload throws "Invalid email payload"', async () => {
    const { queue } = makeMockQueue();
    const svc = new QueuedEmailService(queue);
    const bad = { to: '', subject: 'x', html: '<p>x</p>', text: 'x' } as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

Deno.test('QueuedEmailService.sendEmail() — queue.send() throws, resolves without rethrowing', async () => {
    const failQueue = {
        async send(_msg: unknown, _opts?: unknown) {
            throw new Error('queue unavailable');
        },
    };
    const svc = new QueuedEmailService(failQueue);
    // Fire-and-forget: should resolve, not throw
    await svc.sendEmail(makePayload());
});

Deno.test('QueuedEmailService.sendEmail() — idempotencyKey includes requestId when provided', async () => {
    const { queue, messages } = makeMockQueue();
    const svc = new QueuedEmailService(queue, { requestId: 'abc-def-999' });
    await svc.sendEmail(makePayload());
    const msg = messages[0] as Record<string, unknown>;
    assertStringIncludes(msg['idempotencyKey'] as string, 'abc-def-999');
});

Deno.test('QueuedEmailService.sendEmail() — reason field included in queue message when provided', async () => {
    const { queue, messages } = makeMockQueue();
    const svc = new QueuedEmailService(queue, { reason: 'compilation_complete' });
    await svc.sendEmail(makePayload());
    const msg = messages[0] as Record<string, unknown>;
    assertEquals(msg['reason'], 'compilation_complete');
});

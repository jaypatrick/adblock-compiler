/**
 * Tests for EmailService (all providers + factory).
 *
 * All tests are self-contained — no real CF Email Worker sends are made.
 * The `SEND_EMAIL` binding is mocked for CF Email Worker tests.
 * fetch() is mocked globally for ResendEmailService and CfEmailServiceRestService tests.
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
 * CfEmailWorkerService:
 *   - Valid payload → binding.send() called once with an EmailMessage
 *   - Display-name FROM_EMAIL → envelope uses bare address, MIME From: has display name
 *   - binding.send() throws → resolves without rethrowing (fire-and-forget)
 *   - Invalid payload → throws 'Invalid email payload'
 *   - buildRawMimeMessage() → produces correct RFC 5322 headers and boundary
 *   - Non-ASCII subject → RFC 2047 encoded in Subject header
 *   - replyTo set → MIME string contains Reply-To: header
 *   - replyTo absent → MIME string does not contain Reply-To: header
 *
 * NullEmailService:
 *   - sendEmail() resolves immediately without calling fetch or a binding
 *
 * ResendEmailService:
 *   - Valid payload → fetch() called once with correct Resend API shape
 *   - Invalid payload → throws 'Invalid email payload'
 *   - Non-2xx HTTP response → resolves (warns, doesn't throw)
 *   - fetch() throws → resolves (warns, doesn't throw)
 *   - replyTo set → reply_to included in request body
 *
 * CfEmailServiceRestService:
 *   - Valid payload → fetch() called once with correct CF API shape (to as array)
 *   - Invalid payload → throws 'Invalid email payload'
 *   - Non-2xx HTTP response → resolves (warns, doesn't throw)
 *   - replyTo set → reply_to included in request body
 *
 * QueuedEmailService:
 *   - Valid payload → queue.send() called once with correct message shape
 *   - Invalid payload → throws 'Invalid email payload'
 *   - queue.send() throws → resolves without rethrowing (fire-and-forget contract)
 *   - idempotencyKey derived from requestId option
 *   - reason field included in queue message when provided
 *   - replyTo field included in enqueued message payload when provided
 *
 * createEmailService() factory:
 *   - EMAIL_QUEUE binding present (useQueue=true default) → returns QueuedEmailService
 *   - EMAIL_QUEUE present but useQueue=false → skips queue, uses SEND_EMAIL binding
 *   - priority=critical + RESEND_API_KEY → returns ResendEmailService
 *   - priority=transactional + CF_EMAIL_API_TOKEN + CF_ACCOUNT_ID → returns CfEmailServiceRestService
 *   - SEND_EMAIL binding present, no EMAIL_QUEUE → returns CfEmailWorkerService (fallback)
 *   - Neither configured → returns NullEmailService (priority 3 fallback)
 *   - Returned CF Email Worker service calls binding.send()
 */

import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
    buildRawMimeMessage,
    CfEmailServiceRestService,
    CfEmailWorkerService,
    createEmailService,
    encodeSubjectRfc2047,
    NullEmailService,
    parseEmailAddress,
    QueuedEmailService,
    ResendEmailService,
} from './email-service.ts';
import type { EmailPayload } from './email-service.ts';

// ============================================================================
// Helpers
// ============================================================================

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
    const { binding } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await assertRejects(
        () => svc.sendEmail(makePayload({ subject: 'Bad\rSubject' })),
        Error,
        'Invalid email payload',
    );
});

Deno.test('EmailPayloadSchema — subject with LF character is rejected', async () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await assertRejects(
        () => svc.sendEmail(makePayload({ subject: 'Injected\nHeader: x' })),
        Error,
        'Invalid email payload',
    );
});

Deno.test('EmailPayloadSchema — subject with CRLF sequence is rejected', async () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await assertRejects(
        () => svc.sendEmail(makePayload({ subject: 'Bad\r\nHeader: injected' })),
        Error,
        'Invalid email payload',
    );
});

Deno.test('EmailPayloadSchema — replyTo with CR character is rejected (header injection guard)', async () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await assertRejects(
        () => svc.sendEmail(makePayload({ replyTo: 'x\r\nBcc: attacker@evil.com' })),
        Error,
        'Invalid email payload',
    );
});

Deno.test('EmailPayloadSchema — replyTo with LF character is rejected (header injection guard)', async () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await assertRejects(
        () => svc.sendEmail(makePayload({ replyTo: 'x\nBcc: attacker@evil.com' })),
        Error,
        'Invalid email payload',
    );
});

Deno.test('EmailPayloadSchema — replyTo with CRLF sequence is rejected (header injection guard)', async () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await assertRejects(
        () => svc.sendEmail(makePayload({ replyTo: 'x\r\nBcc: attacker@evil.com' })),
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

Deno.test('buildRawMimeMessage() — Reply-To header present when replyTo is provided', () => {
    const raw = buildRawMimeMessage('f@x.com', 't@x.com', 'S', 'T', 'H', 'Bloqr Support <support@bloqr.dev>');
    assertStringIncludes(raw, 'Reply-To: Bloqr Support <support@bloqr.dev>');
});

Deno.test('buildRawMimeMessage() — no Reply-To header when replyTo is omitted', () => {
    const raw = buildRawMimeMessage('f@x.com', 't@x.com', 'S', 'T', 'H');
    assertEquals(raw.includes('Reply-To:'), false);
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

Deno.test('CfEmailWorkerService.sendEmail() — Reply-To header present in MIME when replyTo is set', async () => {
    const { binding, calls } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await svc.sendEmail(makePayload({ replyTo: 'Bloqr Support <support@bloqr.dev>' }));

    assertEquals(calls.length, 1);
    const msg = calls[0] as { raw: string };
    assertStringIncludes(msg.raw, 'Reply-To: Bloqr Support <support@bloqr.dev>');
});

Deno.test('CfEmailWorkerService.sendEmail() — no Reply-To header in MIME when replyTo is absent', async () => {
    const { binding, calls } = makeMockSendEmailBinding();
    const svc = new CfEmailWorkerService(binding, 'n@bloqr.dev');
    await svc.sendEmail(makePayload());

    assertEquals(calls.length, 1);
    const msg = calls[0] as { raw: string };
    assertEquals(msg.raw.includes('Reply-To:'), false);
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
    const svc = createEmailService({ EMAIL_QUEUE: queue, SEND_EMAIL: binding });
    assertEquals(svc instanceof QueuedEmailService, true);
});

Deno.test('createEmailService() — skips queue and returns CfEmailWorkerService when useQueue=false', () => {
    const { queue } = makeMockQueue();
    const { binding } = makeMockSendEmailBinding();
    const svc = createEmailService({ EMAIL_QUEUE: queue, SEND_EMAIL: binding }, { useQueue: false });
    assertEquals(svc instanceof CfEmailWorkerService, true);
});

Deno.test('createEmailService() — returns CfEmailWorkerService when SEND_EMAIL binding is present (no EMAIL_QUEUE)', () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = createEmailService({ SEND_EMAIL: binding });
    assertEquals(svc instanceof CfEmailWorkerService, true);
});

Deno.test('createEmailService() — returns NullEmailService (priority 3) when neither binding nor queue is configured', () => {
    const svc = createEmailService({});
    assertEquals(svc instanceof NullEmailService, true);
});

Deno.test('createEmailService() — returned CF Email Worker service calls binding.send()', async () => {
    const { binding, calls } = makeMockSendEmailBinding();
    const svc = createEmailService({ SEND_EMAIL: binding });
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

Deno.test('QueuedEmailService.sendEmail() — replyTo included in enqueued payload when provided', async () => {
    const { queue, messages } = makeMockQueue();
    const svc = new QueuedEmailService(queue);
    await svc.sendEmail(makePayload({ replyTo: 'Bloqr Support <support@bloqr.dev>' }));
    const msg = messages[0] as Record<string, unknown>;
    assertEquals((msg['payload'] as Record<string, unknown>)['replyTo'], 'Bloqr Support <support@bloqr.dev>');
});

// ============================================================================
// ResendEmailService
// ============================================================================

/** Creates a stubbed globalThis.fetch that resolves with the given status. */
function stubFetch(status: number, body = ''): { calls: { url: string; init: RequestInit }[]; restore: () => void } {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: url.toString(), init: init ?? {} });
        return new Response(body, { status });
    };
    return {
        calls,
        restore: () => {
            globalThis.fetch = original;
        },
    };
}

Deno.test('ResendEmailService.sendEmail() — valid payload calls Resend API with correct shape', async () => {
    const { calls, restore } = stubFetch(200);
    try {
        const svc = new ResendEmailService('re_test_key', 'noreply@bloqr.dev');
        await svc.sendEmail(makePayload());
        assertEquals(calls.length, 1);
        assertEquals(calls[0].url, 'https://api.resend.com/emails');
        assertEquals((calls[0].init.headers as Record<string, string>)['Authorization'], 'Bearer re_test_key');
        const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
        assertEquals(body['from'], 'noreply@bloqr.dev');
        assertEquals(body['to'], 'user@example.com');
        assertEquals(body['subject'], 'Test subject');
    } finally {
        restore();
    }
});

Deno.test("ResendEmailService.sendEmail() — throws 'Invalid email payload' on invalid payload", async () => {
    const svc = new ResendEmailService('re_test_key', 'noreply@bloqr.dev');
    const bad = { to: '', subject: 'x', html: '<p>x</p>', text: 'x' } as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

Deno.test('ResendEmailService.sendEmail() — non-2xx response resolves without throwing', async () => {
    const { restore } = stubFetch(422, 'unprocessable');
    try {
        const svc = new ResendEmailService('re_test_key', 'noreply@bloqr.dev');
        // Should resolve (fire-and-forget — logs a warning, never throws)
        await svc.sendEmail(makePayload());
    } finally {
        restore();
    }
});

Deno.test('ResendEmailService.sendEmail() — fetch() throws resolves without rethrowing', async () => {
    const original = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async () => {
        throw new Error('network error');
    };
    try {
        const svc = new ResendEmailService('re_test_key', 'noreply@bloqr.dev');
        await svc.sendEmail(makePayload());
    } finally {
        globalThis.fetch = original;
    }
});

Deno.test('ResendEmailService.sendEmail() — replyTo present → reply_to included in request body', async () => {
    const { calls, restore } = stubFetch(200);
    try {
        const svc = new ResendEmailService('re_test_key', 'noreply@bloqr.dev');
        await svc.sendEmail(makePayload({ replyTo: 'support@bloqr.dev' }));
        const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
        assertEquals(body['reply_to'], 'support@bloqr.dev');
    } finally {
        restore();
    }
});

// ============================================================================
// CfEmailServiceRestService
// ============================================================================

Deno.test('CfEmailServiceRestService.sendEmail() — valid payload calls CF Email API with correct shape (to as array)', async () => {
    const { calls, restore } = stubFetch(200);
    try {
        const svc = new CfEmailServiceRestService('cf_token', 'acct_123', 'notifications@bloqr.dev');
        await svc.sendEmail(makePayload());
        assertEquals(calls.length, 1);
        assertStringIncludes(calls[0].url, '/accounts/acct_123/email/sending/send');
        assertEquals((calls[0].init.headers as Record<string, string>)['Authorization'], 'Bearer cf_token');
        const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
        assertEquals(body['from'], 'notifications@bloqr.dev');
        // CF API expects `to` as an array
        assertEquals(Array.isArray(body['to']), true);
        assertEquals((body['to'] as string[])[0], 'user@example.com');
        assertEquals(body['subject'], 'Test subject');
    } finally {
        restore();
    }
});

Deno.test("CfEmailServiceRestService.sendEmail() — throws 'Invalid email payload' on invalid payload", async () => {
    const svc = new CfEmailServiceRestService('cf_token', 'acct_123', 'notifications@bloqr.dev');
    const bad = { to: '', subject: 'x', html: '<p>x</p>', text: 'x' } as EmailPayload;
    await assertRejects(
        () => svc.sendEmail(bad),
        Error,
        'Invalid email payload',
    );
});

Deno.test('CfEmailServiceRestService.sendEmail() — non-2xx response resolves without throwing', async () => {
    const { restore } = stubFetch(500, 'internal error');
    try {
        const svc = new CfEmailServiceRestService('cf_token', 'acct_123', 'notifications@bloqr.dev');
        await svc.sendEmail(makePayload());
    } finally {
        restore();
    }
});

Deno.test('CfEmailServiceRestService.sendEmail() — replyTo present → reply_to included in request body', async () => {
    const { calls, restore } = stubFetch(200);
    try {
        const svc = new CfEmailServiceRestService('cf_token', 'acct_123', 'notifications@bloqr.dev');
        await svc.sendEmail(makePayload({ replyTo: 'support@bloqr.dev' }));
        const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>;
        assertEquals(body['reply_to'], 'support@bloqr.dev');
    } finally {
        restore();
    }
});

// ============================================================================
// createEmailService() factory — new priority options
// ============================================================================

Deno.test('createEmailService() — priority=critical + RESEND_API_KEY → returns ResendEmailService', () => {
    const svc = createEmailService({ RESEND_API_KEY: 're_test_key' }, { useQueue: false, priority: 'critical' });
    assertEquals(svc instanceof ResendEmailService, true);
});

Deno.test('createEmailService() — priority=transactional + CF_EMAIL_API_TOKEN + CF_ACCOUNT_ID → returns CfEmailServiceRestService', () => {
    const svc = createEmailService(
        { CF_EMAIL_API_TOKEN: 'token', CF_ACCOUNT_ID: 'acct' },
        { useQueue: false, priority: 'transactional' },
    );
    assertEquals(svc instanceof CfEmailServiceRestService, true);
});

Deno.test('createEmailService() — priority=critical but RESEND_API_KEY absent → falls back to CfEmailWorkerService', () => {
    const { binding } = makeMockSendEmailBinding();
    const svc = createEmailService({ SEND_EMAIL: binding }, { useQueue: false, priority: 'critical' });
    assertEquals(svc instanceof CfEmailWorkerService, true);
});

Deno.test('createEmailService() — EMAIL_QUEUE takes priority over RESEND_API_KEY (priority 1 wins)', () => {
    const { queue } = makeMockQueue();
    const svc = createEmailService({ EMAIL_QUEUE: queue, RESEND_API_KEY: 're_test_key' }, { priority: 'critical' });
    assertEquals(svc instanceof QueuedEmailService, true);
});

/**
 * Tests for Admin Email Handlers.
 *
 * Covers:
 *
 * handleAdminEmailConfig():
 *   - 403 when user is not an admin
 *   - 200 with provider='cf_email_worker' when SEND_EMAIL binding is present
 *   - 200 with provider='mailchannels' when FROM_EMAIL is set and no binding
 *   - 200 with provider='none' when neither is configured
 *   - DKIM status: 'configured' when all three DKIM env vars present
 *   - DKIM status: 'partial' when only one DKIM env var is present
 *   - DKIM status: 'disabled' when no DKIM vars are set
 *   - from_address matches FROM_EMAIL env var
 *   - from_address is null when FROM_EMAIL is absent
 *
 * handleAdminEmailTest():
 *   - 403 when user is not an admin
 *   - 503 when no provider is configured
 *   - 400 on missing/invalid 'to' field
 *   - 400 on non-JSON body
 *   - 200 via MailChannels provider — send is dispatched
 *   - 200 via CF Email Worker provider — binding.send() is called
 *
 * @see worker/handlers/admin-email.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleAdminEmailConfig, handleAdminEmailTest } from './admin-email.ts';
import { type Env, type IAuthContext, type SendEmail, UserTier } from '../types.ts';
import { makeAppContext, makeEnv } from '../test-helpers.ts';

// ============================================================================
// Auth context fixtures
// ============================================================================

function makeAdminContext(): IAuthContext {
    return {
        userId: 'admin-001',
        tier: UserTier.Admin,
        role: 'admin',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
}

function makeUserContext(): IAuthContext {
    return {
        userId: 'user-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
}

// ============================================================================
// Env factories
// ============================================================================

function makeEnvWithCfBinding(): Env {
    return makeEnv({
        SEND_EMAIL: {
            async send(_message: unknown) {},
        } as unknown as SendEmail,
        FROM_EMAIL: 'notifications@bloqr.dev',
    });
}

function makeEnvMailChannels(dkim = false): Env {
    return makeEnv({
        FROM_EMAIL: 'notifications@bloqr.dev',
        ...(dkim
            ? {
                DKIM_DOMAIN: 'bloqr.dev',
                DKIM_SELECTOR: 'mailchannels',
                DKIM_PRIVATE_KEY: 'key==',
            }
            : {}),
    });
}

function makeEnvNoEmail(): Env {
    return makeEnv({});
}

// ============================================================================
// Mock fetch helper for MailChannels sends
// ============================================================================

async function withMockFetch(
    status: number,
    fn: () => Promise<void>,
): Promise<void> {
    const originalFetch = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async () => new Response('{}', { status });
    try {
        await fn();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

// ============================================================================
// handleAdminEmailConfig — authorization
// ============================================================================

Deno.test('handleAdminEmailConfig — 403 for non-admin user', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvNoEmail(), makeUserContext());
    const res = await handleAdminEmailConfig(c);
    assertEquals(res.status, 403);
});

// ============================================================================
// handleAdminEmailConfig — provider detection
// ============================================================================

Deno.test('handleAdminEmailConfig — provider=cf_email_worker when SEND_EMAIL binding is present', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvWithCfBinding(), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['provider'], 'cf_email_worker');
    assertEquals(body['send_email_binding_configured'], true);
});

Deno.test('handleAdminEmailConfig — provider=mailchannels when FROM_EMAIL set and no binding', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvMailChannels(), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['provider'], 'mailchannels');
    assertEquals(body['from_email_configured'], true);
    assertEquals(body['from_address'], 'notifications@bloqr.dev');
});

Deno.test('handleAdminEmailConfig — provider=none when neither is configured', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvNoEmail(), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['provider'], 'none');
    assertEquals(body['send_email_binding_configured'], false);
    assertEquals(body['from_email_configured'], false);
    assertEquals(body['from_address'], null);
});

// ============================================================================
// handleAdminEmailConfig — DKIM status
// ============================================================================

Deno.test('handleAdminEmailConfig — dkim_status=configured when all three DKIM vars present', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvMailChannels(true), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['dkim_status'], 'configured');
});

Deno.test('handleAdminEmailConfig — dkim_status=partial when only DKIM_DOMAIN is set', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const env = makeEnv({ FROM_EMAIL: 'n@bloqr.dev', DKIM_DOMAIN: 'bloqr.dev' });
    const c = makeAppContext(req, env, makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['dkim_status'], 'partial');
});

Deno.test('handleAdminEmailConfig — dkim_status=disabled when no DKIM vars', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvMailChannels(false), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['dkim_status'], 'disabled');
});

// ============================================================================
// handleAdminEmailConfig — response envelope
// ============================================================================

Deno.test('handleAdminEmailConfig — response includes timestamp field', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvMailChannels(), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    const body = await res.json() as Record<string, unknown>;
    assertExists(body['timestamp']);
    assertEquals(typeof body['timestamp'], 'string');
});

// ============================================================================
// handleAdminEmailTest — authorization
// ============================================================================

Deno.test('handleAdminEmailTest — 403 for non-admin user', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'admin@example.com' }),
    });
    const c = makeAppContext(req, makeEnvMailChannels(), makeUserContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 403);
});

// ============================================================================
// handleAdminEmailTest — 503 when no provider configured
// ============================================================================

Deno.test('handleAdminEmailTest — 503 when no provider is configured', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'admin@example.com' }),
    });
    const c = makeAppContext(req, makeEnvNoEmail(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 503);
});

// ============================================================================
// handleAdminEmailTest — 400 validation errors
// ============================================================================

Deno.test('handleAdminEmailTest — 400 when "to" is missing', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    const c = makeAppContext(req, makeEnvMailChannels(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 400);
});

Deno.test('handleAdminEmailTest — 400 when "to" is not a valid email', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'not-an-email' }),
    });
    const c = makeAppContext(req, makeEnvMailChannels(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 400);
});

Deno.test('handleAdminEmailTest — 400 when body is not JSON', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
    });
    const c = makeAppContext(req, makeEnvMailChannels(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 400);
});

// ============================================================================
// handleAdminEmailTest — 200 success via MailChannels
// ============================================================================

Deno.test('handleAdminEmailTest — 200 via MailChannels, response includes provider and to fields', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'admin@example.com' }),
    });
    const c = makeAppContext(req, makeEnvMailChannels(), makeAdminContext());

    let res: Response | undefined;
    await withMockFetch(202, async () => {
        res = await handleAdminEmailTest(c);
    });

    assertExists(res);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['success'], true);
    assertEquals(body['provider'], 'mailchannels');
    assertEquals(body['to'], 'admin@example.com');
    assertExists(body['timestamp']);
});

// ============================================================================
// handleAdminEmailTest — 200 success via CF Email Worker binding
// ============================================================================

Deno.test('handleAdminEmailTest — 200 via CF Email Worker, binding.send() called', async () => {
    const sends: unknown[] = [];
    const env = makeEnv({
        SEND_EMAIL: {
            async send(msg: unknown) {
                sends.push(msg);
            },
        } as unknown as SendEmail,
        FROM_EMAIL: 'notifications@bloqr.dev',
    });

    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'admin@example.com' }),
    });
    const c = makeAppContext(req, env, makeAdminContext());
    const res = await handleAdminEmailTest(c);

    assertEquals(res.status, 200);
    assertEquals(sends.length, 1);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['provider'], 'cf_email_worker');
});

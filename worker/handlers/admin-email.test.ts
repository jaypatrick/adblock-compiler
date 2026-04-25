/**
 * Tests for Admin Email Handlers.
 *
 * Covers:
 *
 * handleAdminEmailConfig():
 *   - 403 when user is not an admin
 *   - 200 with provider='queued' when EMAIL_QUEUE binding is present
 *   - 200 with provider='cf_email_worker' when SEND_EMAIL binding present but no EMAIL_QUEUE
 *   - 200 with provider='none' when neither is configured
 *   - email_queue_configured field reflects EMAIL_QUEUE binding presence
 *   - response includes timestamp field
 *
 * handleAdminEmailTest():
 *   - 403 when user is not an admin
 *   - 503 when no provider is configured (no EMAIL_QUEUE or SEND_EMAIL)
 *   - 503 when only EMAIL_QUEUE present but no direct provider for test
 *   - 400 on missing/invalid 'to' field
 *   - 400 on non-JSON body
 *   - 200 via CF Email Worker provider — binding.send() is called
 *   - test sends always use direct provider (bypass queue)
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

function makeEnvWithQueue(): Env {
    return makeEnv({
        EMAIL_QUEUE: {
            async send(_msg: unknown, _opts?: unknown) {},
        } as unknown as Queue<unknown>,
        SEND_EMAIL: {
            async send(_message: unknown) {},
        } as unknown as SendEmail,
    });
}

function makeEnvWithQueueOnly(): Env {
    return makeEnv({
        EMAIL_QUEUE: {
            async send(_msg: unknown, _opts?: unknown) {},
        } as unknown as Queue<unknown>,
    });
}

function makeEnvWithCfBinding(): Env {
    return makeEnv({
        SEND_EMAIL: {
            async send(_message: unknown) {},
        } as unknown as SendEmail,
    });
}

function makeEnvNoEmail(): Env {
    return makeEnv({});
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

Deno.test('handleAdminEmailConfig — provider=queued when EMAIL_QUEUE binding is present', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvWithQueue(), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['provider'], 'queued');
    assertEquals(body['email_queue_configured'], true);
});

Deno.test('handleAdminEmailConfig — provider=cf_email_worker when SEND_EMAIL binding is present (no EMAIL_QUEUE)', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvWithCfBinding(), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['provider'], 'cf_email_worker');
    assertEquals(body['send_email_binding_configured'], true);
    assertEquals(body['email_queue_configured'], false);
});

Deno.test('handleAdminEmailConfig — provider=none when neither is configured', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvNoEmail(), makeAdminContext());
    const res = await handleAdminEmailConfig(c);
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body['provider'], 'none');
    assertEquals(body['send_email_binding_configured'], false);
    assertEquals(body['email_queue_configured'], false);
});

// ============================================================================
// handleAdminEmailConfig — response envelope
// ============================================================================

Deno.test('handleAdminEmailConfig — response includes timestamp field', async () => {
    const req = new Request('http://localhost/admin/email/config');
    const c = makeAppContext(req, makeEnvWithCfBinding(), makeAdminContext());
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
    const c = makeAppContext(req, makeEnvWithCfBinding(), makeUserContext());
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

Deno.test('handleAdminEmailTest — 503 when only EMAIL_QUEUE present (no direct provider for test)', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'admin@example.com' }),
    });
    const c = makeAppContext(req, makeEnvWithQueueOnly(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    // Queue-only env has no direct provider — admin test must return 503
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
    const c = makeAppContext(req, makeEnvWithCfBinding(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 400);
});

Deno.test('handleAdminEmailTest — 400 when "to" is not a valid email', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'not-an-email' }),
    });
    const c = makeAppContext(req, makeEnvWithCfBinding(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 400);
});

Deno.test('handleAdminEmailTest — 400 when body is not JSON', async () => {
    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
    });
    const c = makeAppContext(req, makeEnvWithCfBinding(), makeAdminContext());
    const res = await handleAdminEmailTest(c);
    assertEquals(res.status, 400);
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

// ============================================================================
// handleAdminEmailTest — queue bypassed; direct provider used even when queue present
// ============================================================================

Deno.test('handleAdminEmailTest — direct send even when EMAIL_QUEUE is configured (bypass queue for admin tests)', async () => {
    const sends: unknown[] = [];
    const env = makeEnvWithQueue();
    // Override SEND_EMAIL on the queue env to track sends
    (env as unknown as Record<string, unknown>).SEND_EMAIL = {
        async send(msg: unknown) {
            sends.push(msg);
        },
    };

    const req = new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'admin@example.com' }),
    });
    const c = makeAppContext(req, env, makeAdminContext());
    const res = await handleAdminEmailTest(c);

    assertEquals(res.status, 200);
    // Direct SEND_EMAIL.send() must have been called (not enqueued)
    assertEquals(sends.length, 1);
    const body = await res.json() as Record<string, unknown>;
    // Provider in response is the direct provider used
    assertEquals(body['provider'], 'cf_email_worker');
});

/**
 * ResendContactService — unit tests.
 *
 * Tests cover the real service (successful sync, error swallowing), the
 * NullResendContactService, and the createResendContactService factory.
 *
 * The ResendApiService dependency is replaced with a lightweight stub object
 * so no HTTP calls are made.
 */

import { assertEquals } from '@std/assert';
import { createResendContactService, NullResendContactService, ResendContactService } from './resend-contact-service.ts';
import type { IResendContactService } from './resend-contact-service.ts';

// ============================================================================
// Stub helpers
// ============================================================================

interface StubCall {
    method: string;
    args: unknown[];
}

/** Lightweight stub for ResendApiService that records calls. */
function makeApiStub(options: { failCreate?: boolean; failDelete?: boolean } = {}) {
    const calls: StubCall[] = [];
    const stub = {
        calls,
        // deno-lint-ignore require-await
        async createContact(audienceId: string, data: unknown) {
            calls.push({ method: 'createContact', args: [audienceId, data] });
            if (options.failCreate) throw new Error('Resend API error: 500 Internal Server Error');
            return { id: '11111111-2222-3333-4444-555555555555' };
        },
        // deno-lint-ignore require-await
        async deleteContact(audienceId: string, contactIdOrEmail: string) {
            calls.push({ method: 'deleteContact', args: [audienceId, contactIdOrEmail] });
            if (options.failDelete) throw new Error('Resend API error: 404 Not Found');
        },
        // deno-lint-ignore require-await
        async getContact(audienceId: string, contactIdOrEmail: string) {
            calls.push({ method: 'getContact', args: [audienceId, contactIdOrEmail] });
            return { id: contactIdOrEmail, email: '', unsubscribed: false, createdAt: '' };
        },
        // deno-lint-ignore require-await
        async listContacts(audienceId: string) {
            calls.push({ method: 'listContacts', args: [audienceId] });
            return { data: [] };
        },
    };
    return stub;
}

const FAKE_AUDIENCE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ============================================================================
// Tests
// ============================================================================

Deno.test('ResendContactService', async (t) => {
    // ── syncUserCreated ────────────────────────────────────────────────────
    await t.step('syncUserCreated — calls createContact with correct payload', async () => {
        const api = makeApiStub();
        const svc = new ResendContactService(api as never, FAKE_AUDIENCE);
        await svc.syncUserCreated({ id: 'user-1', email: 'alice@example.com', name: 'Alice Smith' });

        assertEquals(api.calls.length, 1);
        assertEquals(api.calls[0].method, 'createContact');
        const [audienceId, data] = api.calls[0].args as [string, Record<string, unknown>];
        assertEquals(audienceId, FAKE_AUDIENCE);
        assertEquals(data.email, 'alice@example.com');
        assertEquals(data.firstName, 'Alice');
        assertEquals(data.lastName, 'Smith');
        assertEquals(data.unsubscribed, false);
    });

    await t.step('syncUserCreated — handles single-word name (no lastName)', async () => {
        const api = makeApiStub();
        const svc = new ResendContactService(api as never, FAKE_AUDIENCE);
        await svc.syncUserCreated({ id: 'user-2', email: 'bob@example.com', name: 'Bob' });

        const [, data] = api.calls[0].args as [string, Record<string, unknown>];
        assertEquals(data.firstName, 'Bob');
        assertEquals(data.lastName, undefined);
    });

    await t.step('syncUserCreated — handles null/undefined name gracefully', async () => {
        const api = makeApiStub();
        const svc = new ResendContactService(api as never, FAKE_AUDIENCE);
        await svc.syncUserCreated({ id: 'user-3', email: 'carol@example.com', name: null });

        const [, data] = api.calls[0].args as [string, Record<string, unknown>];
        assertEquals(data.firstName, undefined);
        assertEquals(data.lastName, undefined);
    });

    await t.step('syncUserCreated — swallows API errors (fire-and-forget)', async () => {
        const api = makeApiStub({ failCreate: true });
        const svc = new ResendContactService(api as never, FAKE_AUDIENCE);
        // Must not throw — errors are caught and logged.
        await svc.syncUserCreated({ id: 'user-4', email: 'dave@example.com' });
        // If we get here, the error was swallowed — pass.
    });

    // ── syncUserDeleted ────────────────────────────────────────────────────
    await t.step('syncUserDeleted — calls deleteContact with email', async () => {
        const api = makeApiStub();
        const svc = new ResendContactService(api as never, FAKE_AUDIENCE);
        await svc.syncUserDeleted({ id: 'user-5', email: 'eve@example.com' });

        assertEquals(api.calls.length, 1);
        assertEquals(api.calls[0].method, 'deleteContact');
        const [audienceId, contactIdOrEmail] = api.calls[0].args as [string, string];
        assertEquals(audienceId, FAKE_AUDIENCE);
        assertEquals(contactIdOrEmail, 'eve@example.com');
    });

    await t.step('syncUserDeleted — swallows API errors (fire-and-forget)', async () => {
        const api = makeApiStub({ failDelete: true });
        const svc = new ResendContactService(api as never, FAKE_AUDIENCE);
        // Must not throw — errors are caught and logged.
        await svc.syncUserDeleted({ id: 'user-6', email: 'ghost@example.com' });
        // If we get here, the error was swallowed — pass.
    });
});

Deno.test('NullResendContactService', async (t) => {
    await t.step('syncUserCreated — resolves without error', async () => {
        const svc: IResendContactService = new NullResendContactService();
        await svc.syncUserCreated({ id: 'user-1', email: 'alice@example.com' });
        // No assertion needed — completion without throw is the contract.
    });

    await t.step('syncUserDeleted — resolves without error', async () => {
        const svc: IResendContactService = new NullResendContactService();
        await svc.syncUserDeleted({ id: 'user-1', email: 'alice@example.com' });
    });
});

Deno.test('createResendContactService', async (t) => {
    await t.step('returns NullResendContactService when RESEND_API_KEY is absent', () => {
        const svc = createResendContactService({ RESEND_API_KEY: undefined, RESEND_AUDIENCE_ID: FAKE_AUDIENCE });
        assertEquals(svc instanceof NullResendContactService, true);
    });

    await t.step('returns NullResendContactService when RESEND_AUDIENCE_ID is absent', () => {
        const svc = createResendContactService({ RESEND_API_KEY: 're_test_xxx', RESEND_AUDIENCE_ID: undefined });
        assertEquals(svc instanceof NullResendContactService, true);
    });

    await t.step('returns NullResendContactService when both are absent', () => {
        const svc = createResendContactService({ RESEND_API_KEY: undefined, RESEND_AUDIENCE_ID: undefined });
        assertEquals(svc instanceof NullResendContactService, true);
    });

    await t.step('returns ResendContactService when both env vars are present', () => {
        const svc = createResendContactService({ RESEND_API_KEY: 're_test_xxx', RESEND_AUDIENCE_ID: FAKE_AUDIENCE });
        assertEquals(svc instanceof ResendContactService, true);
    });

    await t.step('returns NullResendContactService when values are null', () => {
        const svc = createResendContactService({ RESEND_API_KEY: null, RESEND_AUDIENCE_ID: null });
        assertEquals(svc instanceof NullResendContactService, true);
    });
});

/**
 * ResendApiService — unit tests.
 *
 * All HTTP calls are intercepted by patching the global `fetch`. Tests run
 * inside a single `Deno.test` block with sequential `t.step` calls to avoid
 * global fetch patch interference.
 */

import { assertEquals, assertRejects } from '@std/assert';
import { createResendApiService, ResendApiError } from './resend-api-service.ts';

const FAKE_API_KEY = 're_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const FAKE_AUDIENCE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FAKE_CONTACT_ID = '11111111-2222-3333-4444-555555555555';

/**
 * Installs a temporary fetch mock, executes `fn`, then always restores the
 * original fetch — even if `fn` throws. This prevents mock leakage into later
 * steps when an assertion fails.
 */
async function withFetch<T>(
    handler: (url: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
    fn: () => Promise<T>,
): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = handler as typeof fetch;
    try {
        return await fn();
    } finally {
        globalThis.fetch = original;
    }
}

Deno.test('ResendApiService', async (t) => {
    // ── createContact ──────────────────────────────────────────────────────
    await t.step('createContact — success returns { id }', () =>
        withFetch(
            (_url, _init) =>
                new Response(JSON.stringify({ id: FAKE_CONTACT_ID }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                const result = await svc.createContact(FAKE_AUDIENCE_ID, { email: 'alice@example.com' });
                assertEquals(result.id, FAKE_CONTACT_ID);
            },
        ));

    await t.step('createContact — sends Authorization header and JSON body', () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;
        return withFetch(
            (url, init) => {
                capturedUrl = typeof url === 'string' ? url : url.toString();
                capturedInit = init;
                return new Response(JSON.stringify({ id: FAKE_CONTACT_ID }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                await svc.createContact(FAKE_AUDIENCE_ID, {
                    email: 'bob@example.com',
                    firstName: 'Bob',
                    lastName: 'Smith',
                });
                assertEquals(capturedUrl, `https://api.resend.com/audiences/${FAKE_AUDIENCE_ID}/contacts`);
                assertEquals(capturedInit?.method, 'POST');
                assertEquals((capturedInit?.headers as Record<string, string>)['Authorization'], `Bearer ${FAKE_API_KEY}`);
                const body = JSON.parse(capturedInit?.body as string);
                assertEquals(body.email, 'bob@example.com');
                assertEquals(body.firstName, 'Bob');
            },
        );
    });

    await t.step('createContact — throws ResendApiError on non-2xx response', () =>
        withFetch(
            (_url, _init) =>
                new Response(
                    JSON.stringify({ name: 'not_found', message: 'Audience not found', statusCode: 404 }),
                    { status: 404, headers: { 'Content-Type': 'application/json' } },
                ),
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                await assertRejects(
                    () => svc.createContact(FAKE_AUDIENCE_ID, { email: 'nobody@example.com' }),
                    ResendApiError,
                    '404',
                );
            },
        ));

    // ── getContact ─────────────────────────────────────────────────────────
    await t.step('getContact — success parses contact', () => {
        const contactPayload = {
            id: FAKE_CONTACT_ID,
            email: 'alice@example.com',
            firstName: 'Alice',
            unsubscribed: false,
            createdAt: '2024-01-01T00:00:00.000Z',
        };
        return withFetch(
            (_url, _init) =>
                new Response(JSON.stringify(contactPayload), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                const contact = await svc.getContact(FAKE_AUDIENCE_ID, FAKE_CONTACT_ID);
                assertEquals(contact.id, FAKE_CONTACT_ID);
                assertEquals(contact.email, 'alice@example.com');
                assertEquals(contact.unsubscribed, false);
            },
        );
    });

    // ── listContacts ───────────────────────────────────────────────────────
    await t.step('listContacts — success returns data array', () => {
        const listPayload = {
            data: [
                {
                    id: FAKE_CONTACT_ID,
                    email: 'alice@example.com',
                    unsubscribed: false,
                    createdAt: '2024-01-01T00:00:00.000Z',
                },
            ],
        };
        return withFetch(
            (_url, _init) =>
                new Response(JSON.stringify(listPayload), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                const result = await svc.listContacts(FAKE_AUDIENCE_ID);
                assertEquals(result.data.length, 1);
                assertEquals(result.data[0].email, 'alice@example.com');
            },
        );
    });

    // ── deleteContact ──────────────────────────────────────────────────────
    await t.step('deleteContact — encodes email in path and sends DELETE', () => {
        let capturedUrl = '';
        let capturedMethod = '';
        return withFetch(
            (url, init) => {
                capturedUrl = typeof url === 'string' ? url : url.toString();
                capturedMethod = init?.method ?? '';
                return new Response(null, { status: 204 });
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                await svc.deleteContact(FAKE_AUDIENCE_ID, 'alice@example.com');
                assertEquals(capturedUrl, `https://api.resend.com/audiences/${FAKE_AUDIENCE_ID}/contacts/alice%40example.com`);
                assertEquals(capturedMethod, 'DELETE');
            },
        );
    });

    await t.step('deleteContact — throws ResendApiError on non-2xx response', () =>
        withFetch(
            (_url, _init) =>
                new Response(
                    JSON.stringify({ name: 'not_found', message: 'Contact not found', statusCode: 404 }),
                    { status: 404, headers: { 'Content-Type': 'application/json' } },
                ),
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                await assertRejects(
                    () => svc.deleteContact(FAKE_AUDIENCE_ID, 'ghost@example.com'),
                    ResendApiError,
                    '404',
                );
            },
        ));
});

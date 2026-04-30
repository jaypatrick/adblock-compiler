/**
 * ResendApiService — unit tests.
 *
 * All HTTP calls are intercepted by patching the global `fetch`. Tests run
 * inside a single `Deno.test` block with sequential `t.step` calls to avoid
 * global fetch patch interference.
 */

import { assertEquals, assertRejects } from '@std/assert';
import { createResendApiService } from './resend-api-service.ts';

const FAKE_API_KEY = 're_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const FAKE_AUDIENCE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FAKE_CONTACT_ID = '11111111-2222-3333-4444-555555555555';

/** Helper to install a one-shot fetch mock and restore the original after the step. */
function withFetch(handler: (url: string | URL | Request, init?: RequestInit) => Response | Promise<Response>) {
    const original = globalThis.fetch;
    globalThis.fetch = handler as typeof fetch;
    return () => {
        globalThis.fetch = original;
    };
}

Deno.test('ResendApiService', async (t) => {
    // ── createContact ──────────────────────────────────────────────────────
    await t.step('createContact — success returns { id }', async () => {
        const restore = withFetch((_url, _init) =>
            new Response(JSON.stringify({ id: FAKE_CONTACT_ID }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        const svc = createResendApiService(FAKE_API_KEY);
        const result = await svc.createContact(FAKE_AUDIENCE_ID, { email: 'alice@example.com' });
        assertEquals(result.id, FAKE_CONTACT_ID);
        restore();
    });

    await t.step('createContact — sends Authorization header and JSON body', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;
        const restore = withFetch((url, init) => {
            capturedUrl = typeof url === 'string' ? url : url.toString();
            capturedInit = init;
            return new Response(JSON.stringify({ id: FAKE_CONTACT_ID }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
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
        restore();
    });

    await t.step('createContact — throws on non-2xx response', async () => {
        const restore = withFetch((_url, _init) =>
            new Response(
                JSON.stringify({ name: 'not_found', message: 'Audience not found', statusCode: 404 }),
                { status: 404, headers: { 'Content-Type': 'application/json' } },
            )
        );
        const svc = createResendApiService(FAKE_API_KEY);
        await assertRejects(
            () => svc.createContact(FAKE_AUDIENCE_ID, { email: 'nobody@example.com' }),
            Error,
            'Resend API error: 404',
        );
        restore();
    });

    // ── getContact ─────────────────────────────────────────────────────────
    await t.step('getContact — success parses contact', async () => {
        const contactPayload = {
            id: FAKE_CONTACT_ID,
            email: 'alice@example.com',
            firstName: 'Alice',
            unsubscribed: false,
            createdAt: '2024-01-01T00:00:00.000Z',
        };
        const restore = withFetch((_url, _init) =>
            new Response(JSON.stringify(contactPayload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        const svc = createResendApiService(FAKE_API_KEY);
        const contact = await svc.getContact(FAKE_AUDIENCE_ID, FAKE_CONTACT_ID);
        assertEquals(contact.id, FAKE_CONTACT_ID);
        assertEquals(contact.email, 'alice@example.com');
        assertEquals(contact.unsubscribed, false);
        restore();
    });

    // ── listContacts ───────────────────────────────────────────────────────
    await t.step('listContacts — success returns data array', async () => {
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
        const restore = withFetch((_url, _init) =>
            new Response(JSON.stringify(listPayload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        const svc = createResendApiService(FAKE_API_KEY);
        const result = await svc.listContacts(FAKE_AUDIENCE_ID);
        assertEquals(result.data.length, 1);
        assertEquals(result.data[0].email, 'alice@example.com');
        restore();
    });

    // ── deleteContact ──────────────────────────────────────────────────────
    await t.step('deleteContact — encodes email in path and sends DELETE', async () => {
        let capturedUrl = '';
        let capturedMethod = '';
        const restore = withFetch((url, init) => {
            capturedUrl = typeof url === 'string' ? url : url.toString();
            capturedMethod = init?.method ?? '';
            return new Response(null, { status: 204 });
        });
        const svc = createResendApiService(FAKE_API_KEY);
        await svc.deleteContact(FAKE_AUDIENCE_ID, 'alice@example.com');
        assertEquals(capturedUrl, `https://api.resend.com/audiences/${FAKE_AUDIENCE_ID}/contacts/alice%40example.com`);
        assertEquals(capturedMethod, 'DELETE');
        restore();
    });

    await t.step('deleteContact — throws on non-2xx response', async () => {
        const restore = withFetch((_url, _init) =>
            new Response(
                JSON.stringify({ name: 'not_found', message: 'Contact not found', statusCode: 404 }),
                { status: 404, headers: { 'Content-Type': 'application/json' } },
            )
        );
        const svc = createResendApiService(FAKE_API_KEY);
        await assertRejects(
            () => svc.deleteContact(FAKE_AUDIENCE_ID, 'ghost@example.com'),
            Error,
            'Resend API error: 404',
        );
        restore();
    });
});

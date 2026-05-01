/**
 * ResendApiService — unit tests.
 *
 * All HTTP calls are intercepted by patching the global `fetch`. Tests run
 * inside a single `Deno.test` block with sequential `t.step` calls to avoid
 * global fetch patch interference.
 */

import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { createResendApiService, ResendApiError, ResendApiService } from './resend-api-service.ts';

const FAKE_API_KEY = 're_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const FAKE_AUDIENCE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FAKE_CONTACT_ID = '11111111-2222-3333-4444-555555555555';
const FAKE_TEMPLATE_ID = 'tmpl_11111111-2222-3333-4444-555555555555';

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
    await t.step('createContact — success returns { id }', async () =>
        await withFetch(
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

    await t.step('createContact — sends Authorization header and JSON body', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;
        await withFetch(
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

    await t.step('createContact — throws ResendApiError on non-2xx response', async () =>
        await withFetch(
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
    await t.step('getContact — success parses contact', async () => {
        const contactPayload = {
            id: FAKE_CONTACT_ID,
            email: 'alice@example.com',
            firstName: 'Alice',
            unsubscribed: false,
            createdAt: '2024-01-01T00:00:00.000Z',
        };
        await withFetch(
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
        await withFetch(
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
    await t.step('deleteContact — encodes email in path and sends DELETE', async () => {
        let capturedUrl = '';
        let capturedMethod = '';
        await withFetch(
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

    await t.step('deleteContact — throws ResendApiError on non-2xx response', async () =>
        await withFetch(
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

    // ── Constructor — API key format guard ─────────────────────────────────
    await t.step('constructor — throws when API key does not match expected format', () => {
        assertThrows(
            () => new ResendApiService('invalid-key-format'),
            Error,
            'does not match the expected format',
        );
    });

    await t.step('constructor — throws without including key value in error message', () => {
        const badKey = 'sk_live_should_not_appear_in_error';
        let thrownMessage = '';
        try {
            new ResendApiService(badKey);
        } catch (e) {
            thrownMessage = e instanceof Error ? e.message : String(e);
        }
        assertEquals(thrownMessage.includes(badKey), false, 'Error message must not contain the API key value');
    });

    await t.step('constructor — accepts valid re_ key format', () => {
        // Should not throw.
        const svc = new ResendApiService(FAKE_API_KEY);
        assertEquals(svc instanceof ResendApiService, true);
    });

    // ── createTemplate ─────────────────────────────────────────────────────
    await t.step('createTemplate — sends POST to /templates with Authorization header and JSON body', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;
        await withFetch(
            (url, init) => {
                capturedUrl = typeof url === 'string' ? url : url.toString();
                capturedInit = init;
                return new Response(
                    JSON.stringify({ id: FAKE_TEMPLATE_ID, name: 'Welcome Email' }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                await svc.createTemplate({ name: 'Welcome Email', html: '<p>Hi</p>' });
                assertEquals(capturedUrl, 'https://api.resend.com/templates');
                assertEquals(capturedInit?.method, 'POST');
                assertEquals(
                    (capturedInit?.headers as Record<string, string>)['Authorization'],
                    `Bearer ${FAKE_API_KEY}`,
                );
                const body = JSON.parse(capturedInit?.body as string);
                assertEquals(body.name, 'Welcome Email');
                assertEquals(body.html, '<p>Hi</p>');
            },
        );
    });

    await t.step('createTemplate — rejects invalid input (empty name) before making any fetch call', async () => {
        let fetchCalled = false;
        await withFetch(
            () => {
                fetchCalled = true;
                return new Response(null, { status: 200 });
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                await assertRejects(
                    () => svc.createTemplate({ name: '', html: '<p>Hi</p>' }),
                    Error,
                    'Request validation failed',
                );
                assertEquals(fetchCalled, false, 'fetch must not be called for invalid input');
            },
        );
    });

    // ── getTemplate ────────────────────────────────────────────────────────
    await t.step('getTemplate — sends GET to /templates/{id} with correct auth', async () => {
        let capturedUrl = '';
        let capturedMethod = '';
        await withFetch(
            (url, init) => {
                capturedUrl = typeof url === 'string' ? url : url.toString();
                capturedMethod = init?.method ?? 'GET';
                return new Response(
                    JSON.stringify({ id: FAKE_TEMPLATE_ID, name: 'Welcome Email', createdAt: '2024-01-01T00:00:00.000Z' }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                const result = await svc.getTemplate(FAKE_TEMPLATE_ID);
                assertEquals(capturedUrl, `https://api.resend.com/templates/${encodeURIComponent(FAKE_TEMPLATE_ID)}`);
                assertEquals(capturedMethod, 'GET');
                assertEquals(result.id, FAKE_TEMPLATE_ID);
            },
        );
    });

    // ── listTemplates ──────────────────────────────────────────────────────
    await t.step('listTemplates — sends GET to /templates with correct auth', async () => {
        let capturedUrl = '';
        let capturedMethod = '';
        await withFetch(
            (url, init) => {
                capturedUrl = typeof url === 'string' ? url : url.toString();
                capturedMethod = init?.method ?? 'GET';
                return new Response(
                    JSON.stringify({ data: [{ id: FAKE_TEMPLATE_ID, name: 'Welcome Email', createdAt: '2024-01-01T00:00:00.000Z' }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                const result = await svc.listTemplates();
                assertEquals(capturedUrl, 'https://api.resend.com/templates');
                assertEquals(capturedMethod, 'GET');
                assertEquals(result.data.length, 1);
            },
        );
    });

    // ── deleteTemplate ─────────────────────────────────────────────────────
    await t.step('deleteTemplate — sends DELETE to /templates/{id} with correct auth', async () => {
        let capturedUrl = '';
        let capturedMethod = '';
        await withFetch(
            (url, init) => {
                capturedUrl = typeof url === 'string' ? url : url.toString();
                capturedMethod = init?.method ?? '';
                return new Response(null, { status: 204 });
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                await svc.deleteTemplate(FAKE_TEMPLATE_ID);
                assertEquals(capturedUrl, `https://api.resend.com/templates/${encodeURIComponent(FAKE_TEMPLATE_ID)}`);
                assertEquals(capturedMethod, 'DELETE');
            },
        );
    });

    await t.step('updateTemplate — rejects payload with only undefined values (cannot bypass refine with { field: undefined })', async () => {
        let fetchCalled = false;
        await withFetch(
            () => {
                fetchCalled = true;
                return new Response(null, { status: 200 });
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                // { alias: undefined } has one key but no defined values; JSON.stringify would
                // drop it and produce `{}`. The refine guard must catch this before fetch.
                await assertRejects(
                    () => svc.updateTemplate(FAKE_TEMPLATE_ID, { alias: undefined } as never),
                    Error,
                    'Request validation failed',
                );
                assertEquals(fetchCalled, false, 'fetch must not be called for all-undefined input');
            },
        );
    });

    // ── updateTemplate ─────────────────────────────────────────────────────
    await t.step('updateTemplate — sends PATCH to /templates/{id} with Authorization header and partial body', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;
        await withFetch(
            (url, init) => {
                capturedUrl = typeof url === 'string' ? url : url.toString();
                capturedInit = init;
                return new Response(
                    JSON.stringify({ id: FAKE_TEMPLATE_ID, name: 'Updated Name' }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
            async () => {
                const svc = createResendApiService(FAKE_API_KEY);
                const result = await svc.updateTemplate(FAKE_TEMPLATE_ID, { name: 'Updated Name' });
                assertEquals(capturedUrl, `https://api.resend.com/templates/${encodeURIComponent(FAKE_TEMPLATE_ID)}`);
                assertEquals(capturedInit?.method, 'PATCH');
                assertEquals(
                    (capturedInit?.headers as Record<string, string>)['Authorization'],
                    `Bearer ${FAKE_API_KEY}`,
                );
                const body = JSON.parse(capturedInit?.body as string);
                assertEquals(body.name, 'Updated Name');
                assertEquals(result.id, FAKE_TEMPLATE_ID);
            },
        );
    });
});

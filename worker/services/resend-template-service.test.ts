/**
 * ResendTemplateService — unit tests.
 *
 * Tests cover the real service (upsert, update, get, list, delete), the
 * NullResendTemplateService, and the createResendTemplateService factory.
 *
 * The ResendApiService dependency is replaced with a lightweight stub object
 * so no HTTP calls are made.
 */

import { assertEquals, assertRejects } from '@std/assert';
import { createResendTemplateService, NullResendTemplateService, ResendTemplateService } from './resend-template-service.ts';
import type { IResendTemplateService } from './resend-template-service.ts';
import type { ResendTemplate, ResendTemplateList, ResendTemplateResponse } from './resend-api-service.ts';

// ============================================================================
// Stub helpers
// ============================================================================

interface StubCall {
    method: string;
    args: unknown[];
}

const FAKE_TEMPLATE_ID = 'tmpl_11111111-2222-3333-4444-555555555555';
const FAKE_TEMPLATE_NAME = 'Welcome Email';
const FAKE_TEMPLATE_HTML = '<p>Hello {{{FIRST_NAME}}}</p>';

function makeTemplateApiStub(options: {
    templates?: ResendTemplate[];
    failList?: boolean;
    failCreate?: boolean;
    failUpdate?: boolean;
} = {}) {
    const calls: StubCall[] = [];
    const templates: ResendTemplate[] = options.templates ?? [];

    const stub = {
        calls,
        // deno-lint-ignore require-await
        async createTemplate(data: unknown): Promise<ResendTemplateResponse> {
            calls.push({ method: 'createTemplate', args: [data] });
            if (options.failCreate) throw new Error('Resend API error: 500 Internal Server Error');
            return { id: FAKE_TEMPLATE_ID, name: FAKE_TEMPLATE_NAME };
        },
        // deno-lint-ignore require-await
        async updateTemplate(templateId: string, data: unknown): Promise<ResendTemplateResponse> {
            calls.push({ method: 'updateTemplate', args: [templateId, data] });
            if (options.failUpdate) throw new Error('Resend API error: 404 Not Found');
            return { id: templateId, name: FAKE_TEMPLATE_NAME };
        },
        // deno-lint-ignore require-await
        async getTemplate(templateId: string): Promise<ResendTemplate> {
            calls.push({ method: 'getTemplate', args: [templateId] });
            return { id: templateId, name: FAKE_TEMPLATE_NAME, createdAt: '2024-01-01T00:00:00.000Z' };
        },
        async listTemplates(): Promise<ResendTemplateList> {
            calls.push({ method: 'listTemplates', args: [] });
            if (options.failList) throw new Error('Resend API error: 500 Internal Server Error');
            return { data: templates };
        },
        // deno-lint-ignore require-await
        async deleteTemplate(templateId: string): Promise<void> {
            calls.push({ method: 'deleteTemplate', args: [templateId] });
        },
    };
    return stub;
}

// ============================================================================
// Tests — ResendTemplateService
// ============================================================================

Deno.test('ResendTemplateService', async (t) => {
    // ── upsertTemplate ─────────────────────────────────────────────────────
    await t.step('upsertTemplate — when alias is new, calls createTemplate', async () => {
        const api = makeTemplateApiStub({ templates: [] });
        const svc = new ResendTemplateService(api as never);

        const result = await svc.upsertTemplate({ name: FAKE_TEMPLATE_NAME, html: FAKE_TEMPLATE_HTML, alias: 'welcome-email' });

        assertEquals(api.calls.filter((c) => c.method === 'listTemplates').length, 1);
        assertEquals(api.calls.filter((c) => c.method === 'createTemplate').length, 1);
        assertEquals(api.calls.filter((c) => c.method === 'updateTemplate').length, 0);
        assertEquals(result.id, FAKE_TEMPLATE_ID);
    });

    await t.step('upsertTemplate — when alias already exists, calls updateTemplate instead of createTemplate', async () => {
        const existing: ResendTemplate = {
            id: FAKE_TEMPLATE_ID,
            name: 'Old Name',
            alias: 'welcome-email',
            createdAt: '2024-01-01T00:00:00.000Z',
        };
        const api = makeTemplateApiStub({ templates: [existing] });
        const svc = new ResendTemplateService(api as never);

        await svc.upsertTemplate({ name: 'Updated Name', html: FAKE_TEMPLATE_HTML, alias: 'welcome-email' });

        assertEquals(api.calls.filter((c) => c.method === 'listTemplates').length, 1);
        assertEquals(api.calls.filter((c) => c.method === 'updateTemplate').length, 1);
        assertEquals(api.calls.filter((c) => c.method === 'createTemplate').length, 0);
        const [templateId] = api.calls.find((c) => c.method === 'updateTemplate')!.args as [string, unknown];
        assertEquals(templateId, FAKE_TEMPLATE_ID);
    });

    await t.step('upsertTemplate — when no alias provided, always calls createTemplate (no list check)', async () => {
        const api = makeTemplateApiStub();
        const svc = new ResendTemplateService(api as never);

        await svc.upsertTemplate({ name: FAKE_TEMPLATE_NAME, html: FAKE_TEMPLATE_HTML });

        assertEquals(api.calls.filter((c) => c.method === 'listTemplates').length, 0);
        assertEquals(api.calls.filter((c) => c.method === 'createTemplate').length, 1);
    });

    await t.step('upsertTemplate — rejects empty name with descriptive error', async () => {
        const api = makeTemplateApiStub();
        const svc = new ResendTemplateService(api as never);

        await assertRejects(
            () => svc.upsertTemplate({ name: '', html: FAKE_TEMPLATE_HTML }),
            Error,
            '[ResendTemplateService] upsertTemplate: invalid input',
        );
        assertEquals(api.calls.length, 0);
    });

    await t.step('upsertTemplate — when list fails, logs warning and falls back to createTemplate', async () => {
        const api = makeTemplateApiStub({ failList: true });
        const svc = new ResendTemplateService(api as never);

        // Should not throw — best-effort fallback to create.
        const result = await svc.upsertTemplate({ name: FAKE_TEMPLATE_NAME, html: FAKE_TEMPLATE_HTML, alias: 'welcome-email' });

        assertEquals(api.calls.filter((c) => c.method === 'listTemplates').length, 1);
        assertEquals(api.calls.filter((c) => c.method === 'createTemplate').length, 1);
        assertEquals(api.calls.filter((c) => c.method === 'updateTemplate').length, 0);
        assertEquals(result.id, FAKE_TEMPLATE_ID);
    });

    await t.step('upsertTemplate — rejects alias with invalid characters', async () => {
        const api = makeTemplateApiStub();
        const svc = new ResendTemplateService(api as never);

        await assertRejects(
            () => svc.upsertTemplate({ name: FAKE_TEMPLATE_NAME, html: FAKE_TEMPLATE_HTML, alias: 'UPPERCASE_ALIAS' }),
            Error,
            '[ResendTemplateService] upsertTemplate: invalid input',
        );
        assertEquals(api.calls.length, 0);
    });

    // ── updateTemplate ─────────────────────────────────────────────────────
    await t.step('updateTemplate — forwards to apiService.updateTemplate with correct args', async () => {
        const api = makeTemplateApiStub();
        const svc = new ResendTemplateService(api as never);

        const result = await svc.updateTemplate(FAKE_TEMPLATE_ID, { name: 'New Name' });

        assertEquals(api.calls.length, 1);
        assertEquals(api.calls[0].method, 'updateTemplate');
        const [id, data] = api.calls[0].args as [string, Record<string, unknown>];
        assertEquals(id, FAKE_TEMPLATE_ID);
        assertEquals(data.name, 'New Name');
        assertEquals(result.id, FAKE_TEMPLATE_ID);
    });

    await t.step('updateTemplate — rejects empty update payload (Zod .refine check)', async () => {
        const api = makeTemplateApiStub();
        const svc = new ResendTemplateService(api as never);

        await assertRejects(
            () => svc.updateTemplate(FAKE_TEMPLATE_ID, {}),
            Error,
            '[ResendTemplateService] updateTemplate: invalid input',
        );
        assertEquals(api.calls.length, 0);
    });

    // ── getTemplate ────────────────────────────────────────────────────────
    await t.step('getTemplate — forwards to apiService.getTemplate', async () => {
        const api = makeTemplateApiStub();
        const svc = new ResendTemplateService(api as never);

        const result = await svc.getTemplate(FAKE_TEMPLATE_ID);

        assertEquals(api.calls.length, 1);
        assertEquals(api.calls[0].method, 'getTemplate');
        assertEquals(api.calls[0].args[0], FAKE_TEMPLATE_ID);
        assertEquals(result.id, FAKE_TEMPLATE_ID);
    });

    // ── listTemplates ──────────────────────────────────────────────────────
    await t.step('listTemplates — forwards to apiService.listTemplates', async () => {
        const templates: ResendTemplate[] = [
            { id: FAKE_TEMPLATE_ID, name: FAKE_TEMPLATE_NAME, createdAt: '2024-01-01T00:00:00.000Z' },
        ];
        const api = makeTemplateApiStub({ templates });
        const svc = new ResendTemplateService(api as never);

        const result = await svc.listTemplates();

        assertEquals(api.calls.length, 1);
        assertEquals(api.calls[0].method, 'listTemplates');
        assertEquals(result.data.length, 1);
        assertEquals(result.data[0].id, FAKE_TEMPLATE_ID);
    });

    // ── deleteTemplate ─────────────────────────────────────────────────────
    await t.step('deleteTemplate — forwards to apiService.deleteTemplate', async () => {
        const api = makeTemplateApiStub();
        const svc = new ResendTemplateService(api as never);

        await svc.deleteTemplate(FAKE_TEMPLATE_ID);

        assertEquals(api.calls.length, 1);
        assertEquals(api.calls[0].method, 'deleteTemplate');
        assertEquals(api.calls[0].args[0], FAKE_TEMPLATE_ID);
    });
});

// ============================================================================
// Tests — NullResendTemplateService
// ============================================================================

Deno.test('NullResendTemplateService', async (t) => {
    await t.step('upsertTemplate — resolves without error', async () => {
        const svc: IResendTemplateService = new NullResendTemplateService();
        const result = await svc.upsertTemplate({ name: 'Test', html: '<p>Hi</p>' });
        assertEquals(result.id, 'null');
        assertEquals(result.name, 'Test');
    });

    await t.step('listTemplates — returns empty data array', async () => {
        const svc: IResendTemplateService = new NullResendTemplateService();
        const result = await svc.listTemplates();
        assertEquals(result.data, []);
    });

    await t.step('deleteTemplate — resolves without error', async () => {
        const svc: IResendTemplateService = new NullResendTemplateService();
        await svc.deleteTemplate('tmpl_any');
        // No assertion needed — completion without throw is the contract.
    });
});

// ============================================================================
// Tests — createResendTemplateService factory
// ============================================================================

Deno.test('createResendTemplateService', async (t) => {
    await t.step('returns NullResendTemplateService when RESEND_API_KEY is absent', () => {
        const svc = createResendTemplateService({ RESEND_API_KEY: undefined });
        assertEquals(svc instanceof NullResendTemplateService, true);
    });

    await t.step('returns NullResendTemplateService when RESEND_API_KEY is null', () => {
        const svc = createResendTemplateService({ RESEND_API_KEY: null });
        assertEquals(svc instanceof NullResendTemplateService, true);
    });

    await t.step('returns ResendTemplateService when RESEND_API_KEY is present', () => {
        const svc = createResendTemplateService({ RESEND_API_KEY: 're_test_XXXXXXXX' });
        assertEquals(svc instanceof ResendTemplateService, true);
    });
});

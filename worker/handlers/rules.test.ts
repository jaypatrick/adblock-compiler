/**
 * Tests for the Rule Set CRUD handlers.
 *
 * Covers:
 *   - POST /api/rules   — handleRulesCreate
 *   - GET  /api/rules   — handleRulesList
 *   - GET  /api/rules/:id — handleRulesGet
 *   - PUT  /api/rules/:id — handleRulesUpdate
 *   - DELETE /api/rules/:id — handleRulesDelete
 *
 * Uses an in-memory KV stub to avoid real Cloudflare bindings.
 *
 * @see worker/handlers/rules.ts
 */

import { assertEquals, assertExists, assertMatch } from '@std/assert';
import { handleRulesCreate, handleRulesDelete, handleRulesGet, handleRulesList, handleRulesUpdate } from './rules.ts';
import type { Env } from '../types.ts';
import type { RuleSet } from '../schemas.ts';

// ============================================================================
// In-memory KV stub
// ============================================================================

function makeInMemoryKv(): KVNamespace {
    const store = new Map<string, string>();

    return {
        async put(key: string, value: string) {
            store.set(key, value);
        },
        async get<T>(key: string, type?: string): Promise<T | null> {
            const raw = store.get(key);
            if (raw === undefined) return null;
            if (type === 'json') return JSON.parse(raw) as T;
            return raw as unknown as T;
        },
        async delete(key: string) {
            store.delete(key);
        },
        async list({ prefix, limit: _limit }: { prefix?: string; limit?: number; cursor?: string }) {
            const keys = [...store.keys()]
                .filter((k) => !prefix || k.startsWith(prefix))
                .map((name) => ({ name }));
            return { keys, list_complete: true, cursor: '' };
        },
        getWithMetadata: async <T>(key: string) => {
            const raw = store.get(key);
            if (raw === undefined) return { value: null as T, metadata: null };
            return { value: JSON.parse(raw) as T, metadata: null };
        },
    } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: makeInMemoryKv(),
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

function makeRequest(body: unknown, method = 'POST'): Request {
    return new Request('http://localhost/api/rules', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ============================================================================
// handleRulesCreate
// ============================================================================

Deno.test('handleRulesCreate - creates a rule set and returns 201', async () => {
    const env = makeEnv();
    const req = makeRequest({ name: 'Test List', rules: ['||ads.example.com^'] });
    const res = await handleRulesCreate(req, env);
    assertEquals(res.status, 201);
    const body = await res.json() as { success: boolean; data: RuleSet };
    assertEquals(body.success, true);
    assertExists(body.data.id);
    assertEquals(body.data.name, 'Test List');
    assertEquals(body.data.rules.length, 1);
    assertEquals(body.data.ruleCount, 1);
});

Deno.test('handleRulesCreate - assigns generated UUID id', async () => {
    const env = makeEnv();
    const req = makeRequest({ name: 'MyList', rules: ['##.banner'] });
    const res = await handleRulesCreate(req, env);
    const body = await res.json() as { data: RuleSet };
    assertMatch(body.data.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

Deno.test('handleRulesCreate - returns 400 on invalid JSON body', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/api/rules', {
        method: 'POST',
        body: 'not-json',
    });
    const res = await handleRulesCreate(req, env);
    assertEquals(res.status, 400);
});

Deno.test('handleRulesCreate - returns 422 when name is missing', async () => {
    const env = makeEnv();
    const req = makeRequest({ rules: ['||ads.example.com^'] }); // missing name
    const res = await handleRulesCreate(req, env);
    assertEquals(res.status, 422);
});

Deno.test('handleRulesCreate - stores in RULES_KV when available', async () => {
    const rulesKv = makeInMemoryKv();
    const env = makeEnv({ RULES_KV: rulesKv });
    const req = makeRequest({ name: 'RULES_KV test', rules: ['||example.com^'] });
    const res = await handleRulesCreate(req, env);
    assertEquals(res.status, 201);
});

// ============================================================================
// handleRulesList
// ============================================================================

Deno.test('handleRulesList - returns empty list when no rules exist', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/api/rules');
    const res = await handleRulesList(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { items: unknown[]; total: number; success: boolean };
    assertEquals(body.success, true);
    assertEquals(body.items.length, 0);
    assertEquals(body.total, 0);
});

Deno.test('handleRulesList - returns created rule sets', async () => {
    const env = makeEnv();

    // Create two rule sets
    await handleRulesCreate(makeRequest({ name: 'List A', rules: ['||a.com^'] }), env);
    await handleRulesCreate(makeRequest({ name: 'List B', rules: ['||b.com^'] }), env);

    const req = new Request('http://localhost/api/rules');
    const res = await handleRulesList(req, env);
    const body = await res.json() as { items: Array<{ name: string }>; total: number };
    assertEquals(body.total, 2);
    assertEquals(body.items.length, 2);
});

Deno.test('handleRulesList - does not include rules array in list response', async () => {
    const env = makeEnv();
    await handleRulesCreate(makeRequest({ name: 'List A', rules: ['||a.com^', '||b.com^'] }), env);

    const req = new Request('http://localhost/api/rules');
    const res = await handleRulesList(req, env);
    const body = await res.json() as { items: Array<Record<string, unknown>> };
    const item = body.items[0];
    assertEquals('rules' in item, false); // no full rules array
    assertExists(item.ruleCount); // but ruleCount should be there
});

// ============================================================================
// handleRulesGet
// ============================================================================

Deno.test('handleRulesGet - returns rule set by id', async () => {
    const env = makeEnv();
    const createRes = await handleRulesCreate(makeRequest({ name: 'Get Test', rules: ['||get.com^'] }), env);
    const { data: created } = await createRes.json() as { data: RuleSet };

    const res = await handleRulesGet(created.id, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; data: RuleSet };
    assertEquals(body.success, true);
    assertEquals(body.data.id, created.id);
    assertEquals(body.data.name, 'Get Test');
});

Deno.test('handleRulesGet - returns 404 for unknown id', async () => {
    const env = makeEnv();
    const res = await handleRulesGet('nonexistent-id', env);
    assertEquals(res.status, 404);
});

// ============================================================================
// handleRulesUpdate
// ============================================================================

Deno.test('handleRulesUpdate - updates name and rules', async () => {
    const env = makeEnv();
    const createRes = await handleRulesCreate(makeRequest({ name: 'Original', rules: ['||old.com^'] }), env);
    const { data: created } = await createRes.json() as { data: RuleSet };

    const updateReq = new Request(`http://localhost/api/rules/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated', rules: ['||new.com^', '||newer.com^'] }),
    });
    const res = await handleRulesUpdate(created.id, updateReq, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; data: RuleSet };
    assertEquals(body.data.name, 'Updated');
    assertEquals(body.data.rules.length, 2);
    assertEquals(body.data.ruleCount, 2);
});

Deno.test('handleRulesUpdate - returns 404 for unknown id', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/api/rules/missing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
    });
    const res = await handleRulesUpdate('missing', req, env);
    assertEquals(res.status, 404);
});

Deno.test('handleRulesUpdate - returns 400 on invalid JSON body', async () => {
    const env = makeEnv();
    const createRes = await handleRulesCreate(makeRequest({ name: 'ToUpdate', rules: ['||x.com^'] }), env);
    const { data: created } = await createRes.json() as { data: RuleSet };

    const req = new Request(`http://localhost/api/rules/${created.id}`, {
        method: 'PUT',
        body: 'not-json',
    });
    const res = await handleRulesUpdate(created.id, req, env);
    assertEquals(res.status, 400);
});

// ============================================================================
// handleRulesDelete
// ============================================================================

Deno.test('handleRulesDelete - deletes existing rule set', async () => {
    const env = makeEnv();
    const createRes = await handleRulesCreate(makeRequest({ name: 'To Delete', rules: ['||del.com^'] }), env);
    const { data: created } = await createRes.json() as { data: RuleSet };

    const res = await handleRulesDelete(created.id, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, true);

    // Verify it's gone
    const getRes = await handleRulesGet(created.id, env);
    assertEquals(getRes.status, 404);
});

Deno.test('handleRulesDelete - returns 404 for unknown id', async () => {
    const env = makeEnv();
    const res = await handleRulesDelete('nonexistent', env);
    assertEquals(res.status, 404);
});

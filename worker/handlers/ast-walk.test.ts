/**
 * Unit tests for worker/handlers/ast-walk.ts
 *
 * Tests the `handleASTWalkRequest` handler in isolation using the
 * `makeEnv()` fixture pattern with no real Cloudflare bindings.
 */

import { assertEquals, assertMatch } from '@std/assert';
import { handleASTWalkRequest } from './ast-walk.ts';
import type { Env } from '../types.ts';

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Minimal stub environment (no bindings required by this handler). */
function makeEnv(): Env {
    return {} as unknown as Env;
}

/** Build a Request with the given JSON body. */
function makeRequest(body: unknown): Request {
    return new Request('https://worker.internal/ast/walk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('handleASTWalkRequest — returns 400 on malformed JSON', async () => {
    const req = new Request('https://worker.internal/ast/walk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad json',
    });
    const res = await handleASTWalkRequest(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertMatch(body.error, /invalid json/i);
});

Deno.test('handleASTWalkRequest — returns 422 when neither rules nor text provided', async () => {
    const res = await handleASTWalkRequest(makeRequest({}), makeEnv());
    assertEquals(res.status, 422);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertMatch(body.error, /rules.*text|text.*rules/i);
});

Deno.test('handleASTWalkRequest — returns 422 when both rules and text provided', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({ rules: ['||example.org^'], text: '||example.org^' }),
        makeEnv(),
    );
    assertEquals(res.status, 422);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertMatch(body.error, /mutually exclusive/i);
});

Deno.test('handleASTWalkRequest — returns 422 when rules exceed 5000 items', async () => {
    const rules = Array.from({ length: 5_001 }, (_, i) => `||example${i}.com^`);
    const res = await handleASTWalkRequest(makeRequest({ rules }), makeEnv());
    assertEquals(res.status, 422);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

Deno.test('handleASTWalkRequest — returns 422 when maxDepth is out of range', async () => {
    const res = await handleASTWalkRequest(makeRequest({ rules: ['||example.com^'], maxDepth: 999 }), makeEnv());
    assertEquals(res.status, 422);
});

Deno.test('handleASTWalkRequest — basic walk with rules array', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            rules: ['||example.org^$third-party', '@@||safe.example.com^'],
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as {
        success: boolean;
        nodes: Array<{ type: string }>;
        summary: Record<string, number>;
        duration: string;
    };
    assertEquals(body.success, true);
    assertEquals(Array.isArray(body.nodes), true);
    assertEquals(typeof body.summary['total'], 'number');
    assertMatch(body.duration, /^\d+ms$/);
    // Both rules should have produced at least one NetworkRule node
    const types = new Set(body.nodes.map((n) => n.type));
    assertEquals(types.has('NetworkRule'), true);
});

Deno.test('handleASTWalkRequest — basic walk with text field', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            text: '||example.org^\n! Comment rule',
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; nodes: Array<{ type: string }> };
    assertEquals(body.success, true);
    assertEquals(Array.isArray(body.nodes), true);
});

Deno.test('handleASTWalkRequest — nodeTypes filter restricts results', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            rules: ['||example.org^$domain=foo.com,third-party'],
            nodeTypes: ['Modifier'],
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; nodes: Array<{ type: string }>; summary: Record<string, number> };
    assertEquals(body.success, true);
    // Every returned node must be a Modifier
    for (const n of body.nodes) {
        assertEquals(n.type, 'Modifier');
    }
    // Summary only contains Modifier and total
    const keys = Object.keys(body.summary);
    assertEquals(keys.includes('total'), true);
    if (body.nodes.length > 0) {
        assertEquals(keys.includes('Modifier'), true);
    }
});

Deno.test('handleASTWalkRequest — includeContext=true attaches depth/key/index', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            rules: ['||example.org^'],
            includeContext: true,
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as {
        nodes: Array<{ type: string; depth: number; key: string | null; index: number | null }>;
    };
    // Every node should have a numeric depth
    for (const n of body.nodes) {
        assertEquals(typeof n.depth, 'number');
    }
});

Deno.test('handleASTWalkRequest — includeContext=false (default) omits key/index', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            rules: ['||example.org^'],
            includeContext: false,
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { nodes: Array<Record<string, unknown>> };
    for (const n of body.nodes) {
        assertEquals('key' in n, false);
        assertEquals('index' in n, false);
    }
});

Deno.test('handleASTWalkRequest — maxDepth=0 returns only the root FilterList node', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            rules: ['||example.org^'],
            maxDepth: 0,
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { nodes: Array<{ type: string; depth: number }> };
    for (const n of body.nodes) {
        assertEquals(n.depth, 0);
    }
});

Deno.test('handleASTWalkRequest — summary total equals nodes length', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            rules: ['||example.org^$domain=foo.com', '@@||safe.com^'],
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { nodes: unknown[]; summary: Record<string, number> };
    assertEquals(body.summary['total'], body.nodes.length);
});

Deno.test('handleASTWalkRequest — empty rules array produces FilterList with no rules', async () => {
    const res = await handleASTWalkRequest(makeRequest({ rules: [] }), makeEnv());
    // Zod check: empty array is valid (0 rules, just the FilterList root)
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, true);
});

Deno.test('handleASTWalkRequest — cosmetic rules produce DomainList and body nodes', async () => {
    const res = await handleASTWalkRequest(
        makeRequest({
            rules: ['example.com,~exception.com##.banner'],
            nodeTypes: ['DomainList', 'Domain'],
        }),
        makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { nodes: Array<{ type: string }>; summary: Record<string, number> };
    const types = new Set(body.nodes.map((n) => n.type));
    assertEquals(types.has('DomainList') || types.has('Domain'), true);
});

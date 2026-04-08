/**
 * Unit tests for scripts/diag-full.ts
 *
 * Tests:
 *   1. buildMeta() returns the correct shape without making network calls.
 *   2. DiagBundleSchema validates a manually constructed valid bundle.
 *
 * Run:
 *   deno test --allow-read --allow-write --allow-net --allow-env scripts/diag-full.test.ts
 */

import { assertEquals, assertExists, assertObjectMatch } from '@std/assert';
import { buildMeta, DiagBundleSchema } from './diag-full.ts';

// ─── Test 1: buildMeta() shape ────────────────────────────────────────────────

Deno.test('buildMeta() returns correct shape without network', async () => {
    const baseUrl = 'https://example.com';
    const timeoutMs = 10_000;

    const meta = await buildMeta(baseUrl, timeoutMs);

    assertEquals(meta.tool, 'adblock-compiler-diag-full');
    assertExists(meta.version);
    assertExists(meta.timestamp);
    assertEquals(meta.baseUrl, baseUrl);
    assertEquals(meta.timeoutMs, timeoutMs);

    // deno version shape
    assertExists(meta.deno.deno);
    assertExists(meta.deno.v8);
    assertExists(meta.deno.typescript);

    // os shape
    assertExists(meta.os.os);
    assertExists(meta.os.arch);

    // cwd is a non-empty string
    assertExists(meta.cwd);
    assertEquals(typeof meta.cwd, 'string');

    // timestamp is ISO 8601
    const parsed = new Date(meta.timestamp);
    assertEquals(isNaN(parsed.getTime()), false);
});

Deno.test('buildMeta() uses provided baseUrl and timeoutMs', async () => {
    const meta1 = await buildMeta('https://staging.example.com', 5_000);
    const meta2 = await buildMeta('http://localhost:8787', 30_000);

    assertEquals(meta1.baseUrl, 'https://staging.example.com');
    assertEquals(meta1.timeoutMs, 5_000);
    assertEquals(meta2.baseUrl, 'http://localhost:8787');
    assertEquals(meta2.timeoutMs, 30_000);
});

// ─── Test 2: DiagBundleSchema validates a well-formed bundle ─────────────────

Deno.test('DiagBundleSchema accepts a valid minimal bundle', async () => {
    const meta = await buildMeta('https://example.com', 15_000);

    const bundle = {
        meta,
        summary: {
            total: 2,
            passed: 1,
            failed: 1,
            durationMs: 420,
        },
        probes: [
            {
                category: 'environment',
                label: 'environment',
                ok: true,
                detail: 'deno=2.0.0 os=linux arch=x86_64',
            },
            {
                category: 'dns',
                label: 'dns-resolution',
                ok: false,
                latency_ms: 100,
                detail: 'timeout (3s)',
            },
        ],
    };

    const result = DiagBundleSchema.safeParse(bundle);
    assertEquals(result.success, true);
});

Deno.test('DiagBundleSchema accepts probes with raw field', async () => {
    const meta = await buildMeta('https://example.com', 15_000);

    const bundle = {
        meta,
        summary: { total: 1, passed: 1, failed: 0, durationMs: 55 },
        probes: [
            {
                category: 'openapi',
                label: 'openapi-spec',
                ok: true,
                latency_ms: 55,
                detail: 'openapi=3.1.0 paths=24 schemas=12',
                raw: { version: '3.1.0', pathCount: 24, schemaCount: 12 },
            },
        ],
    };

    const result = DiagBundleSchema.safeParse(bundle);
    assertEquals(result.success, true);
});

Deno.test('DiagBundleSchema rejects a bundle with missing summary fields', async () => {
    const meta = await buildMeta('https://example.com', 15_000);

    const bundle = {
        meta,
        // summary intentionally missing 'failed'
        summary: { total: 1, passed: 1, durationMs: 10 },
        probes: [],
    };

    const result = DiagBundleSchema.safeParse(bundle);
    assertEquals(result.success, false);
});

Deno.test('DiagBundleSchema rejects wrong tool literal', async () => {
    const meta = {
        ...await buildMeta('https://example.com', 15_000),
        tool: 'some-other-tool', // wrong literal
    };

    const bundle = {
        meta,
        summary: { total: 0, passed: 0, failed: 0, durationMs: 0 },
        probes: [],
    };

    const result = DiagBundleSchema.safeParse(bundle);
    assertEquals(result.success, false);
});

Deno.test('DiagBundleSchema meta tool field matches buildMeta output', async () => {
    const meta = await buildMeta('https://example.com', 15_000);
    assertObjectMatch(meta, { tool: 'adblock-compiler-diag-full' });
});

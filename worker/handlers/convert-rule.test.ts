/**
 * Tests for the convert-rule handler.
 *
 * Covers:
 *   - Valid uBO rule → AdGuard conversion
 *   - Valid AdGuard rule → uBO conversion
 *   - Rule already in target syntax (isConverted: false)
 *   - Basic network rule (no conversion needed)
 *   - Invalid JSON body → 400
 *   - Missing required fields → 422
 *   - Invalid targetSyntax value → 422
 *   - Returns duration in response
 *
 * @see worker/handlers/convert-rule.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleConvertRule } from './convert-rule.ts';
import type { Env } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeEnv(): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
    } as unknown as Env;
}

function makeRequest(body: unknown): Request {
    return new Request('http://localhost/api/convert-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('handleConvertRule - uBO scriptlet rule converts to AdGuard syntax', async () => {
    const req = makeRequest({
        rule: 'example.com##+js(abort-on-property-read, ads)',
        targetSyntax: 'adg',
    });
    const res = await handleConvertRule(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as {
        success: boolean;
        convertedRules: string[];
        isConverted: boolean;
    };
    assertEquals(body.success, true);
    assertEquals(body.isConverted, true);
    assertEquals(body.convertedRules.length > 0, true);
    // The converted rule should use AdGuard scriptlet syntax
    assertEquals(body.convertedRules[0].includes('#%#//scriptlet'), true);
});

Deno.test('handleConvertRule - AdGuard scriptlet rule converts to uBO syntax', async () => {
    const req = makeRequest({
        rule: "example.com#%#//scriptlet('abort-on-property-read', 'ads')",
        targetSyntax: 'ubo',
    });
    const res = await handleConvertRule(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as {
        success: boolean;
        convertedRules: string[];
        isConverted: boolean;
    };
    assertEquals(body.success, true);
    assertEquals(body.isConverted, true);
    assertEquals(body.convertedRules.length > 0, true);
    // The converted rule should use uBO scriptlet syntax
    assertEquals(body.convertedRules[0].includes('##+js('), true);
});

Deno.test('handleConvertRule - common network rule returns isConverted: false for adg target', async () => {
    const req = makeRequest({
        rule: '||example.com^$third-party',
        targetSyntax: 'adg',
    });
    const res = await handleConvertRule(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as {
        success: boolean;
        convertedRules: string[];
        isConverted: boolean;
    };
    assertEquals(body.success, true);
    assertEquals(body.isConverted, false);
    assertEquals(body.convertedRules.length > 0, true);
});

Deno.test('handleConvertRule - returns the original rule in response', async () => {
    const rule = '||example.com^';
    const req = makeRequest({ rule, targetSyntax: 'adg' });
    const res = await handleConvertRule(req, makeEnv());
    const body = await res.json() as { rule: string };
    assertEquals(body.rule, rule);
});

Deno.test('handleConvertRule - returns duration in response', async () => {
    const req = makeRequest({ rule: '||example.com^', targetSyntax: 'adg' });
    const res = await handleConvertRule(req, makeEnv());
    const body = await res.json() as { duration: string };
    assertExists(body.duration);
    assertEquals(body.duration.endsWith('ms'), true);
});

Deno.test('handleConvertRule - returns 400 on invalid JSON body', async () => {
    const req = new Request('http://localhost/api/convert-rule', {
        method: 'POST',
        body: 'not-valid-json',
    });
    const res = await handleConvertRule(req, makeEnv());
    assertEquals(res.status, 400);
});

Deno.test('handleConvertRule - returns 422 when rule field is missing', async () => {
    const req = makeRequest({ targetSyntax: 'adg' });
    const res = await handleConvertRule(req, makeEnv());
    assertEquals(res.status, 422);
});

Deno.test('handleConvertRule - returns 422 when targetSyntax field is missing', async () => {
    const req = makeRequest({ rule: '||example.com^' });
    const res = await handleConvertRule(req, makeEnv());
    assertEquals(res.status, 422);
});

Deno.test('handleConvertRule - returns 422 when targetSyntax is invalid value', async () => {
    const req = makeRequest({ rule: '||example.com^', targetSyntax: 'abp' });
    const res = await handleConvertRule(req, makeEnv());
    assertEquals(res.status, 422);
});

Deno.test('handleConvertRule - echoes targetSyntax in response', async () => {
    const req = makeRequest({ rule: '||example.com^', targetSyntax: 'ubo' });
    const res = await handleConvertRule(req, makeEnv());
    const body = await res.json() as { targetSyntax: string };
    assertEquals(body.targetSyntax, 'ubo');
});

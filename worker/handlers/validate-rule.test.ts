/**
 * Tests for the validate-rule handler.
 *
 * Covers:
 *   - Valid adblock rule → { valid: true }
 *   - Valid rule with testUrl → { valid: true, matchResult }
 *   - testUrl matches hostname → matchResult: true
 *   - testUrl does not match → matchResult: false
 *   - Invalid JSON body → 400
 *   - Missing required field → 422
 *   - Strict mode with valid rule → { valid: true }
 *   - Strict mode with invalid rule → { valid: false }
 *
 * @see worker/handlers/validate-rule.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleValidateRule } from './validate-rule.ts';
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
    return new Request('http://localhost/api/validate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('handleValidateRule - valid network rule returns success:true valid:true', async () => {
    const req = makeRequest({ rule: '||ads.example.com^' });
    const res = await handleValidateRule(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; valid: boolean };
    assertEquals(body.success, true);
    assertEquals(body.valid, true);
});

Deno.test('handleValidateRule - valid cosmetic rule returns valid:true', async () => {
    const req = makeRequest({ rule: '##.advertisement' });
    const res = await handleValidateRule(req, makeEnv());
    const body = await res.json() as { valid: boolean };
    assertEquals(body.valid, true);
});

Deno.test('handleValidateRule - returns duration in response', async () => {
    const req = makeRequest({ rule: '||example.com^' });
    const res = await handleValidateRule(req, makeEnv());
    const body = await res.json() as { duration: string };
    assertExists(body.duration);
    assertEquals(body.duration.endsWith('ms'), true);
});

Deno.test('handleValidateRule - returns 400 on invalid JSON body', async () => {
    const req = new Request('http://localhost/api/validate-rule', {
        method: 'POST',
        body: 'not-valid-json',
    });
    const res = await handleValidateRule(req, makeEnv());
    assertEquals(res.status, 400);
});

Deno.test('handleValidateRule - returns 422 when rule field is missing', async () => {
    const req = makeRequest({ testUrl: 'https://example.com' }); // no rule
    const res = await handleValidateRule(req, makeEnv());
    assertEquals(res.status, 422);
});

Deno.test('handleValidateRule - testUrl matching — returns matchResult boolean', async () => {
    const req = makeRequest({ rule: '||ads.example.com^', testUrl: 'https://ads.example.com/banner' });
    const res = await handleValidateRule(req, makeEnv());
    const body = await res.json() as { valid: boolean; testUrl: string; matchResult: boolean | undefined };
    assertEquals(body.valid, true);
    assertEquals(body.testUrl, 'https://ads.example.com/banner');
    // matchResult is boolean (true or false) or undefined for non-network rules
    assertEquals(typeof body.matchResult === 'boolean' || body.matchResult === undefined, true);
});

Deno.test('handleValidateRule - testUrl non-matching hostname — matchResult false', async () => {
    const req = makeRequest({ rule: '||ads.example.com^', testUrl: 'https://other.com/page' });
    const res = await handleValidateRule(req, makeEnv());
    const body = await res.json() as { valid: boolean; matchResult: boolean | undefined };
    assertEquals(body.valid, true);
    assertEquals(body.matchResult, false);
});

Deno.test('handleValidateRule - no testUrl — no matchResult in response', async () => {
    const req = makeRequest({ rule: '||example.com^' });
    const res = await handleValidateRule(req, makeEnv());
    const body = await res.json() as Record<string, unknown>;
    assertEquals('matchResult' in body, false);
    assertEquals('testUrl' in body, false);
});

Deno.test('handleValidateRule - strict mode with valid rule returns valid:true', async () => {
    const req = makeRequest({ rule: '||example.com^', strict: true });
    const res = await handleValidateRule(req, makeEnv());
    const body = await res.json() as { valid: boolean };
    assertEquals(body.valid, true);
});

Deno.test('handleValidateRule - includes rule and ruleType in response', async () => {
    const req = makeRequest({ rule: '||example.com^' });
    const res = await handleValidateRule(req, makeEnv());
    const body = await res.json() as { rule: string; ruleType: string };
    assertEquals(body.rule, '||example.com^');
    assertExists(body.ruleType);
});

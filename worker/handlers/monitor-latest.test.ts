/**
 * Tests for the GET /api/browser/monitor/latest handler.
 *
 * Covers:
 *   - 503 when COMPILATION_CACHE KV binding is absent
 *   - 404 when KV has no stored summary
 *   - 200 with the parsed summary on valid JSON
 *   - 500 when the stored value is malformed JSON
 *
 * @see worker/handlers/monitor-latest.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleMonitorLatest } from './monitor-latest.ts';
import { makeEnv, makeKv } from '../test-helpers.ts';

const req = new Request('http://localhost/api/browser/monitor/latest');

// ============================================================================
// Tests
// ============================================================================

Deno.test('handleMonitorLatest - returns 503 when COMPILATION_CACHE binding is absent', async () => {
    const res = await handleMonitorLatest(req, makeEnv({ COMPILATION_CACHE: undefined as unknown as KVNamespace }));
    assertEquals(res.status, 503);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

Deno.test('handleMonitorLatest - returns 404 when KV entry is null', async () => {
    const env = makeEnv({ COMPILATION_CACHE: makeKv(null) });
    const res = await handleMonitorLatest(req, env);
    assertEquals(res.status, 404);
});

Deno.test('handleMonitorLatest - returns 200 with parsed summary on valid JSON', async () => {
    const summary = {
        sources: [{ url: 'https://example.com/filter.txt', status: 'ok', ruleCount: 100 }],
        totalSources: 1,
        totalRules: 100,
        timestamp: new Date().toISOString(),
    };
    const env = makeEnv({ COMPILATION_CACHE: makeKv(JSON.stringify(summary)) });
    const res = await handleMonitorLatest(req, env);
    assertEquals(res.status, 200);
    // JsonResponse.success() spreads data at the top level alongside success:true
    const body = await res.json() as { success: boolean; totalRules: number };
    assertEquals(body.success, true);
    assertExists(body.totalRules);
    assertEquals(body.totalRules, 100);
});

Deno.test('handleMonitorLatest - returns 500 when stored JSON is malformed', async () => {
    const env = makeEnv({ COMPILATION_CACHE: makeKv('{not-valid-json{{{') });
    const res = await handleMonitorLatest(req, env);
    assertEquals(res.status, 500);
});

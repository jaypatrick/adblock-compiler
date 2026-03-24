/**
 * Unit tests for the DO agent router utility module.
 *
 * No Node.js built-ins are imported, so these tests run directly under
 * `deno test` without any Cloudflare Workers runtime (no skip/ignore needed).
 *
 * The custom shim and SDK fallback probe (`isSdkRouteAvailable`) have been
 * retired — the router now delegates directly to the official `agents` SDK.
 * These tests currently cover only the preserved utility function
 * (`agentNameToBindingKey`).
 */

import { assertEquals } from '@std/assert';
import { agentNameToBindingKey } from './agent-routing.ts';

// ---------------------------------------------------------------------------
// agentNameToBindingKey
// ---------------------------------------------------------------------------

Deno.test('agentNameToBindingKey - converts single-segment name', () => {
    assertEquals(agentNameToBindingKey('mcp-agent'), 'MCP_AGENT');
});

Deno.test('agentNameToBindingKey - converts multi-segment name', () => {
    assertEquals(agentNameToBindingKey('my-cool-agent'), 'MY_COOL_AGENT');
});

Deno.test('agentNameToBindingKey - already uppercase is preserved', () => {
    assertEquals(agentNameToBindingKey('AGENT'), 'AGENT');
});

Deno.test('agentNameToBindingKey - single word (no hyphens)', () => {
    assertEquals(agentNameToBindingKey('agent'), 'AGENT');
});

Deno.test('agentNameToBindingKey - multiple hyphens', () => {
    assertEquals(agentNameToBindingKey('foo-bar-baz'), 'FOO_BAR_BAZ');
});

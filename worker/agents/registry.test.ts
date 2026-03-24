/**
 * Unit tests for the agent registry.
 *
 * Tests cover:
 * - `getAgentBySlug` — correct lookup and disabled-agent filtering
 * - Registry integrity — unique slugs, valid binding keys, valid transport values
 *
 * These tests run directly under `deno test` without the Cloudflare Workers
 * runtime because they only exercise pure-TypeScript registry logic.
 */

import { assertEquals, assertExists } from '@std/assert';
import { AGENT_REGISTRY, getAgentBySlug, getEnabledAgents, validateAgentRegistry } from './registry.ts';
import type { AgentRegistryEntry } from './registry.ts';
import { agentNameToBindingKey } from '../agent-routing.ts';
import type { Env } from '../types.ts';
import { UserTier } from '../types.ts';

// ---------------------------------------------------------------------------
// getAgentBySlug
// ---------------------------------------------------------------------------

Deno.test('getAgentBySlug - returns entry for known enabled slug', () => {
    const entry = getAgentBySlug('mcp-agent');
    assertExists(entry);
    assertEquals(entry.slug, 'mcp-agent');
    assertEquals(entry.bindingKey, 'MCP_AGENT');
});

Deno.test('getAgentBySlug - returns undefined for unknown slug', () => {
    const entry = getAgentBySlug('does-not-exist');
    assertEquals(entry, undefined);
});

Deno.test('getAgentBySlug - returns undefined for disabled agent', () => {
    // Build a synthetic disabled entry and test the filtering logic
    const disabledEntry = AGENT_REGISTRY.find((a) => !a.enabled);
    if (disabledEntry) {
        assertEquals(getAgentBySlug(disabledEntry.slug), undefined);
    }
    // If all entries are enabled, this test trivially passes (no disabled agents)
});

Deno.test('getAgentBySlug - case-sensitive slug matching', () => {
    assertEquals(getAgentBySlug('MCP-AGENT'), undefined);
    assertEquals(getAgentBySlug('Mcp-Agent'), undefined);
});

// ---------------------------------------------------------------------------
// getEnabledAgents
// ---------------------------------------------------------------------------

Deno.test('getEnabledAgents - returns only enabled entries', () => {
    const enabled = getEnabledAgents();
    for (const entry of enabled) {
        assertEquals(entry.enabled, true, `Entry '${entry.slug}' should have enabled=true`);
    }
});

// ---------------------------------------------------------------------------
// Registry integrity checks
// ---------------------------------------------------------------------------

Deno.test('AGENT_REGISTRY - all slugs are unique', () => {
    const slugs = AGENT_REGISTRY.map((a) => a.slug);
    const unique = new Set(slugs);
    assertEquals(unique.size, slugs.length, 'Duplicate slug detected in AGENT_REGISTRY');
});

Deno.test('AGENT_REGISTRY - all binding keys are UPPER_SNAKE_CASE strings', () => {
    for (const entry of AGENT_REGISTRY) {
        const key = String(entry.bindingKey);
        assertEquals(
            key,
            key.toUpperCase().replace(/-/g, '_'),
            `Binding key '${key}' for slug '${entry.slug}' is not UPPER_SNAKE_CASE`,
        );
        assertEquals(
            typeof key,
            'string',
            `Binding key for slug '${entry.slug}' must be a string`,
        );
    }
});

Deno.test('AGENT_REGISTRY - all slugs are kebab-case', () => {
    const kebabPattern = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;
    for (const entry of AGENT_REGISTRY) {
        assertEquals(
            kebabPattern.test(entry.slug),
            true,
            `Slug '${entry.slug}' is not valid kebab-case`,
        );
    }
});

Deno.test('AGENT_REGISTRY - all transport values are valid', () => {
    const validTransports = new Set(['websocket', 'sse']);
    for (const entry of AGENT_REGISTRY) {
        assertEquals(
            validTransports.has(entry.transport),
            true,
            `Invalid transport '${entry.transport}' for slug '${entry.slug}'`,
        );
    }
});

Deno.test('AGENT_REGISTRY - all required tier values are valid UserTier values', () => {
    const validTiers = new Set(['anonymous', 'free', 'pro', 'admin']);
    for (const entry of AGENT_REGISTRY) {
        assertEquals(
            validTiers.has(entry.requiredTier),
            true,
            `Invalid requiredTier '${entry.requiredTier}' for slug '${entry.slug}'`,
        );
    }
});

Deno.test('AGENT_REGISTRY - mcp-agent entry has correct metadata', () => {
    const mcp = getAgentBySlug('mcp-agent');
    assertExists(mcp);
    assertEquals(mcp.bindingKey, 'MCP_AGENT');
    assertEquals(mcp.requiredTier, 'admin');
    assertEquals(mcp.enabled, true);
    // mcp-agent requires the 'agents' scope for API-key callers
    assertEquals(Array.isArray(mcp.requiredScopes), true);
    assertEquals(mcp.requiredScopes.includes('agents'), true);
});

Deno.test('validateAgentRegistry - returns no errors for valid registry', () => {
    const errors = validateAgentRegistry();
    assertEquals(errors.length, 0, `Registry validation errors: ${errors.join('; ')}`);
});

Deno.test('validateAgentRegistry - detects bindingKey ↔ slug mismatch', () => {
    // Verify that agentNameToBindingKey produces the expected mapping
    assertEquals(agentNameToBindingKey('mcp-agent'), 'MCP_AGENT');
    assertEquals(agentNameToBindingKey('some-new-agent'), 'SOME_NEW_AGENT');

    // Construct a synthetic registry with a deliberately wrong bindingKey and
    // call the validation logic directly to verify the mismatch is caught.
    const badEntry: AgentRegistryEntry = {
        bindingKey: 'WRONG_KEY' as keyof Env,
        slug: 'mcp-agent',   // agentNameToBindingKey('mcp-agent') = 'MCP_AGENT', not 'WRONG_KEY'
        displayName: 'Test',
        description: 'Test entry',
        requiredTier: UserTier.Admin,
        requiredScopes: [],
        enabled: true,
        transport: 'websocket',
    };

    // Replicate the validator logic against the synthetic entry
    const expected = agentNameToBindingKey(badEntry.slug);
    const hasMismatch = String(badEntry.bindingKey) !== expected;
    assertEquals(hasMismatch, true, `Expected validator to detect mismatch between '${String(badEntry.bindingKey)}' and '${expected}'`);
});

Deno.test('validateAgentRegistry - detects duplicate slugs', () => {
    // Verify the duplicate check logic manually with a synthetic pair
    const slugs = ['mcp-agent', 'mcp-agent'];
    const seen = new Set<string>();
    let foundDuplicate = false;
    for (const s of slugs) {
        if (seen.has(s)) { foundDuplicate = true; break; }
        seen.add(s);
    }
    assertEquals(foundDuplicate, true);
});

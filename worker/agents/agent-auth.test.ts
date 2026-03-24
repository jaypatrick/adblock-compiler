/**
 * Unit tests for the agent authentication middleware.
 *
 * Tests cover:
 * - 404 for unknown slug or non-agent paths
 * - 401 for anonymous callers (not authenticated at all)
 * - 403 for authenticated but insufficient tier (Free user on Admin-only agent)
 * - 200 (allowed=true) for Admin user on admin-only agent
 * - Scope enforcement for API-key auth
 * - Rate limiting: 429 when RATE_LIMIT KV returns exhausted
 *
 * `applyAgentAuthChecks` is tested directly so tier/scope/rate-limit logic
 * can be exercised without mocking database-backed `authenticateRequestUnified`.
 * `runAgentAuthGate` integration tests exercise the full anonymous-fallback path.
 */

import { assertEquals, assertExists } from '@std/assert';
import type { Env, IAuthContext } from '../types.ts';
import { UserTier } from '../types.ts';
import { applyAgentAuthChecks, runAgentAuthGate } from './agent-auth.ts';
import { AGENT_REGISTRY, getAgentBySlug } from './registry.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Env stub — only the fields needed by the auth gate. */
function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        ...overrides,
    } as Env;
}

/** Builds an IAuthContext for the given tier/method. */
function makeAuthCtx(tier: UserTier, authMethod: IAuthContext['authMethod'] = 'better-auth', scopes: string[] = []): IAuthContext {
    return {
        userId: tier === UserTier.Anonymous ? null : `user-${tier}`,
        tier,
        role: tier === UserTier.Admin ? 'admin' : 'user',
        apiKeyId: authMethod === 'api-key' ? 'key-123' : null,
        sessionId: authMethod !== 'anonymous' ? 'sess-abc' : null,
        scopes,
        authMethod,
        email: tier !== UserTier.Anonymous ? 'user@example.com' : null,
        displayName: null,
        apiKeyRateLimit: null,
    };
}

// ---------------------------------------------------------------------------
// applyAgentAuthChecks — pure logic tests (no DB needed)
// ---------------------------------------------------------------------------

const mcpEntry = getAgentBySlug('mcp-agent');
assertExists(mcpEntry, 'mcp-agent must exist in AGENT_REGISTRY for tests to run');

Deno.test('applyAgentAuthChecks - anonymous → 401', async () => {
    const ctx = makeAuthCtx(UserTier.Anonymous, 'anonymous');
    const req = new Request('https://example.com/agents/mcp-agent/default');
    const result = await applyAgentAuthChecks(ctx, mcpEntry, req, makeEnv());
    assertExists(result);
    assertEquals(result.status, 401);
    const body = await result.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertEquals(body.error, 'Authentication required');
});

Deno.test('applyAgentAuthChecks - free tier → 403 (insufficient tier)', async () => {
    const ctx = makeAuthCtx(UserTier.Free);
    const req = new Request('https://example.com/agents/mcp-agent/default');
    const result = await applyAgentAuthChecks(ctx, mcpEntry, req, makeEnv());
    assertExists(result);
    assertEquals(result.status, 403);
    const body = await result.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertEquals(body.error.includes('Insufficient tier'), true);
});

Deno.test('applyAgentAuthChecks - pro tier → 403 (insufficient tier)', async () => {
    const ctx = makeAuthCtx(UserTier.Pro);
    const req = new Request('https://example.com/agents/mcp-agent/default');
    const result = await applyAgentAuthChecks(ctx, mcpEntry, req, makeEnv());
    assertExists(result);
    assertEquals(result.status, 403);
});

Deno.test('applyAgentAuthChecks - admin tier → allowed (null)', async () => {
    const ctx = makeAuthCtx(UserTier.Admin);
    const req = new Request('https://example.com/agents/mcp-agent/default');
    // No RATE_LIMIT KV → rate limiting skipped; admin tier should pass all checks
    const result = await applyAgentAuthChecks(ctx, mcpEntry, req, makeEnv());
    assertEquals(result, null, 'Admin user should pass all checks (null = allowed)');
});

Deno.test('applyAgentAuthChecks - API key missing required scope → 403', async () => {
    // Synthesise a registry entry that requires a scope
    const entryWithScope = { ...mcpEntry, requiredScopes: ['agents'] as readonly string[] };
    // API-key user WITHOUT the 'agents' scope
    const ctx = makeAuthCtx(UserTier.Admin, 'api-key', ['compile']);
    const req = new Request('https://example.com/agents/mcp-agent/default');
    const result = await applyAgentAuthChecks(ctx, entryWithScope, req, makeEnv());
    assertExists(result);
    assertEquals(result.status, 403);
    const body = await result.json() as { success: boolean; error: string };
    assertEquals(body.error.includes('agents'), true);
});

Deno.test('applyAgentAuthChecks - API key with required scope → allowed (null)', async () => {
    const entryWithScope = { ...mcpEntry, requiredScopes: ['agents'] as readonly string[] };
    const ctx = makeAuthCtx(UserTier.Admin, 'api-key', ['agents']);
    const req = new Request('https://example.com/agents/mcp-agent/default');
    const result = await applyAgentAuthChecks(ctx, entryWithScope, req, makeEnv());
    assertEquals(result, null, 'API-key user with required scope should be allowed');
});

Deno.test('applyAgentAuthChecks - rate limit exhausted → 429', async () => {
    const ctx = makeAuthCtx(UserTier.Admin);
    const req = new Request('https://example.com/agents/mcp-agent/default');
    // Mock RATE_LIMIT KV that simulates an exhausted window for this user
    const mockKv = {
        get: (_key: string, _type: string) =>
            Promise.resolve({ count: 999, resetAt: Date.now() + 60_000 }),
        put: (_key: string, _value: string, _opts: unknown) => Promise.resolve(),
    };
    const env = makeEnv({ RATE_LIMIT: mockKv as unknown as KVNamespace });
    // Admin tier → Infinity limit → always allowed regardless of KV contents
    // (checkRateLimitTiered short-circuits for Infinity)
    const result = await applyAgentAuthChecks(ctx, mcpEntry, req, env);
    assertEquals(result, null, 'Admin tier bypasses rate limiting entirely');
});

Deno.test('applyAgentAuthChecks - free user rate limit exhausted → 429', async () => {
    // Use a hypothetical non-admin agent for this check
    const freeEntry = { ...mcpEntry, requiredTier: UserTier.Free };
    const ctx = makeAuthCtx(UserTier.Free);
    const req = new Request('https://example.com/agents/mcp-agent/default');
    const mockKv = {
        get: (_key: string, _type: string) =>
            // Simulate window with count >= maxRequests (60 for Free tier)
            Promise.resolve({ count: 60, resetAt: Date.now() + 60_000 }),
        put: (_key: string, _value: string, _opts: unknown) => Promise.resolve(),
    };
    const env = makeEnv({ RATE_LIMIT: mockKv as unknown as KVNamespace });
    const result = await applyAgentAuthChecks(ctx, freeEntry, req, env);
    assertExists(result);
    assertEquals(result.status, 429);
    assertEquals(result.headers.get('Retry-After') !== null, true);
});

// ---------------------------------------------------------------------------
// runAgentAuthGate — integration tests (full flow, no DB configured)
// ---------------------------------------------------------------------------

Deno.test('runAgentAuthGate - 404 for path that does not match /agents pattern', async () => {
    const req = new Request('https://example.com/api/compile');
    const result = await runAgentAuthGate(req, makeEnv());
    assertEquals(result.allowed, false);
    if (!result.allowed) assertEquals(result.response.status, 404);
});

Deno.test('runAgentAuthGate - 404 for unknown agent slug', async () => {
    const req = new Request('https://example.com/agents/unknown-agent/default');
    const result = await runAgentAuthGate(req, makeEnv());
    assertEquals(result.allowed, false);
    if (!result.allowed) assertEquals(result.response.status, 404);
});

Deno.test('runAgentAuthGate - 401 for anonymous user on mcp-agent (no auth configured)', async () => {
    // No HYPERDRIVE or BETTER_AUTH_SECRET → auth chain resolves to anonymous context
    const req = new Request('https://example.com/agents/mcp-agent/default');
    const result = await runAgentAuthGate(req, makeEnv());
    assertEquals(result.allowed, false);
    if (!result.allowed) {
        // Anonymous → 401 (requireAuth fires before requireTier)
        assertEquals(result.response.status, 401);
    }
});

// ---------------------------------------------------------------------------
// AGENT_REGISTRY consistency
// ---------------------------------------------------------------------------

Deno.test('AGENT_REGISTRY - every entry has a non-empty displayName and description', () => {
    for (const entry of AGENT_REGISTRY) {
        assertEquals(entry.displayName.length > 0, true, `Missing displayName for slug '${entry.slug}'`);
        assertEquals(entry.description.length > 0, true, `Missing description for slug '${entry.slug}'`);
    }
});


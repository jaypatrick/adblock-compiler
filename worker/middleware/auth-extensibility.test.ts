/**
 * Tests for Auth Extensibility Improvements.
 *
 * Covers:
 *   - Scope registry (AuthScope enum, SCOPE_REGISTRY, isValidScope)
 *   - Tier registry (TIER_REGISTRY, isTierSufficient)
 *   - requireScope() guard
 *   - requireTier() with registry-based ordering
 *   - IAuthProvider interface structure
 *   - API key tier resolution from DB
 */

import { assertEquals } from '@std/assert';
import {
    type AuthScope,
    type Env,
    type IAuthContext,
    type IAuthProvider,
    isTierSufficient,
    isValidScope,
    SCOPE_REGISTRY,
    TIER_REGISTRY,
    UserTier,
    VALID_SCOPES,
} from '../types.ts';
import { authenticateRequestUnified, requireAuth, requireScope, requireTier } from './auth.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAuthContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user_123',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
        ...overrides,
    };
}

function makeApiKeyContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user_123',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: 'key_abc',
        sessionId: null,
        scopes: ['compile'],
        authMethod: 'api-key',
        ...overrides,
    };
}

function makeAnonContext(): IAuthContext {
    return {
        userId: null,
        tier: UserTier.Anonymous,
        role: 'anonymous',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'anonymous',
    };
}

// ============================================================================
// Scope Registry
// ============================================================================

Deno.test('VALID_SCOPES - contains expected scope strings', () => {
    assertEquals(VALID_SCOPES.includes('compile'), true);
    assertEquals(VALID_SCOPES.includes('rules'), true);
    assertEquals(VALID_SCOPES.includes('admin'), true);
});

Deno.test('SCOPE_REGISTRY - every scope has displayName and description', () => {
    for (const scope of VALID_SCOPES) {
        const config = SCOPE_REGISTRY[scope as AuthScope];
        assertEquals(typeof config.displayName, 'string');
        assertEquals(config.displayName.length > 0, true);
        assertEquals(typeof config.description, 'string');
        assertEquals(config.description.length > 0, true);
    }
});

Deno.test('isValidScope - returns true for known scopes', () => {
    assertEquals(isValidScope('compile'), true);
    assertEquals(isValidScope('rules'), true);
    assertEquals(isValidScope('admin'), true);
});

Deno.test('isValidScope - returns false for unknown scopes', () => {
    assertEquals(isValidScope('delete'), false);
    assertEquals(isValidScope(''), false);
    assertEquals(isValidScope('COMPILE'), false);
});

// ============================================================================
// Tier Registry
// ============================================================================

Deno.test('TIER_REGISTRY - every tier has order, rateLimit, displayName, description', () => {
    for (const tier of Object.values(UserTier)) {
        const config = TIER_REGISTRY[tier];
        assertEquals(typeof config.order, 'number');
        assertEquals(typeof config.rateLimit, 'number');
        assertEquals(config.rateLimit > 0, true);
        assertEquals(typeof config.displayName, 'string');
        assertEquals(typeof config.description, 'string');
    }
});

Deno.test('TIER_REGISTRY - tiers have correct ordering', () => {
    assertEquals(TIER_REGISTRY[UserTier.Anonymous].order < TIER_REGISTRY[UserTier.Free].order, true);
    assertEquals(TIER_REGISTRY[UserTier.Free].order < TIER_REGISTRY[UserTier.Pro].order, true);
    assertEquals(TIER_REGISTRY[UserTier.Pro].order < TIER_REGISTRY[UserTier.Admin].order, true);
});

Deno.test('isTierSufficient - returns true when actual >= required', () => {
    assertEquals(isTierSufficient(UserTier.Admin, UserTier.Free), true);
    assertEquals(isTierSufficient(UserTier.Pro, UserTier.Pro), true);
    assertEquals(isTierSufficient(UserTier.Free, UserTier.Free), true);
    assertEquals(isTierSufficient(UserTier.Free, UserTier.Anonymous), true);
});

Deno.test('isTierSufficient - returns false when actual < required', () => {
    assertEquals(isTierSufficient(UserTier.Anonymous, UserTier.Free), false);
    assertEquals(isTierSufficient(UserTier.Free, UserTier.Pro), false);
    assertEquals(isTierSufficient(UserTier.Pro, UserTier.Admin), false);
});

// ============================================================================
// requireTier (registry-based)
// ============================================================================

Deno.test('requireTier - returns null when tier is sufficient', () => {
    const ctx = makeAuthContext({ tier: UserTier.Pro });
    assertEquals(requireTier(ctx, UserTier.Free), null);
});

Deno.test('requireTier - returns null when tier equals required', () => {
    const ctx = makeAuthContext({ tier: UserTier.Pro });
    assertEquals(requireTier(ctx, UserTier.Pro), null);
});

Deno.test('requireTier - returns 403 when tier is insufficient', async () => {
    const ctx = makeAuthContext({ tier: UserTier.Free });
    const response = requireTier(ctx, UserTier.Pro);
    assertEquals(response instanceof Response, true);
    assertEquals(response!.status, 403);
    const body = await response!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(String(body.error).includes('Insufficient tier'), true);
    assertEquals(String(body.error).includes('Pro'), true);
});

// ============================================================================
// requireScope
// ============================================================================

Deno.test('requireScope - Better Auth users bypass scope checks', () => {
    const ctx = makeAuthContext({ authMethod: 'better-auth', scopes: [] });
    assertEquals(requireScope(ctx, 'compile'), null);
    assertEquals(requireScope(ctx, 'admin'), null);
});

Deno.test('requireScope - API key with matching scope passes', () => {
    const ctx = makeApiKeyContext({ scopes: ['compile', 'rules'] });
    assertEquals(requireScope(ctx, 'compile'), null);
    assertEquals(requireScope(ctx, 'rules'), null);
});

Deno.test('requireScope - API key with all required scopes passes', () => {
    const ctx = makeApiKeyContext({ scopes: ['compile', 'rules', 'admin'] });
    assertEquals(requireScope(ctx, 'compile', 'rules'), null);
});

Deno.test('requireScope - API key missing scope returns 403', async () => {
    const ctx = makeApiKeyContext({ scopes: ['compile'] });
    const response = requireScope(ctx, 'admin');
    assertEquals(response instanceof Response, true);
    assertEquals(response!.status, 403);
    const body = await response!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(String(body.error).includes('Missing required scope'), true);
    assertEquals(String(body.error).includes('admin'), true);
});

Deno.test('requireScope - API key missing multiple scopes lists all', async () => {
    const ctx = makeApiKeyContext({ scopes: [] });
    const response = requireScope(ctx, 'compile', 'admin');
    assertEquals(response instanceof Response, true);
    const body = await response!.json() as Record<string, unknown>;
    assertEquals(String(body.error).includes('compile'), true);
    assertEquals(String(body.error).includes('admin'), true);
    assertEquals(String(body.error).includes('scopes'), true);
});

Deno.test('requireScope - anonymous returns 401', async () => {
    const ctx = makeAnonContext();
    const response = requireScope(ctx, 'compile');
    assertEquals(response instanceof Response, true);
    assertEquals(response!.status, 401);
});

// ============================================================================
// Integration: requireAuth + requireScope chain
// ============================================================================

Deno.test('auth guard chain - anonymous is rejected by requireAuth before scope check', () => {
    const ctx = makeAnonContext();
    const authDenied = requireAuth(ctx);
    assertEquals(authDenied instanceof Response, true);
    assertEquals(authDenied!.status, 401);
    // requireScope never reached
});

Deno.test('auth guard chain - authenticated API key with scope passes both', () => {
    const ctx = makeApiKeyContext({ scopes: ['compile'] });
    assertEquals(requireAuth(ctx), null);
    assertEquals(requireScope(ctx, 'compile'), null);
});

Deno.test('auth guard chain - authenticated API key without scope fails at scope', () => {
    const ctx = makeApiKeyContext({ scopes: ['compile'] });
    assertEquals(requireAuth(ctx), null);
    const scopeDenied = requireScope(ctx, 'admin');
    assertEquals(scopeDenied instanceof Response, true);
    assertEquals(scopeDenied!.status, 403);
});

// ============================================================================
// Unified auth user resolution
// ============================================================================

Deno.test('authenticateRequestUnified - resolves userId from providerUserId for Better Auth', async () => {
    const env = {
        HYPERDRIVE: { connectionString: 'postgresql://test' },
    } as Env;

    const provider: IAuthProvider = {
        name: 'mock-better-auth',
        authMethod: 'better-auth',
        verifyToken: async (_request: Request) => ({
            valid: true,
            providerUserId: 'ba-user-123',
            tier: UserTier.Free,
            role: 'user',
            sessionId: 'sess_123',
        }),
    };

    const request = new Request('https://example.com/api/keys', {
        headers: { Cookie: 'adblock-session=abc123' },
    });

    const result = await authenticateRequestUnified(request, env, provider);
    assertEquals(result.response, undefined);
    assertEquals(result.context.userId, 'ba-user-123');
    assertEquals(result.context.authMethod, 'better-auth');
});

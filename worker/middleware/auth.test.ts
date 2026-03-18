/**
 * Tests for worker/middleware/auth.ts
 *
 * Covers:
 *   - requireAuth: returns null for authenticated users
 *   - requireAuth: returns 401 for anonymous users
 *   - requireTier: returns null when tier is sufficient
 *   - requireTier: returns 403 when tier is insufficient
 *   - requireScope: JWT/local-jwt users bypass scope checks
 *   - requireScope: anonymous users get 401
 *   - requireScope: API-key users are scope-checked
 *   - authenticateRequestUnified: no token → anonymous context
 *   - authenticateRequestUnified: unrecognised token format → 401
 *   - authenticateRequestUnified: abc_-prefix token without Hyperdrive → 503
 *   - hashToken/extractBearerToken: exercised via authenticateApiKey paths
 *   - isApiKeyToken / isJwtToken: exercised via authenticateRequestUnified
 */

import { assertEquals, assertExists } from '@std/assert';
import {
    ANONYMOUS_AUTH_CONTEXT,
    type Env,
    type HyperdriveBinding,
    type IAuthContext,
    UserTier,
} from '../types.ts';
import { authenticateRequestUnified, requireAuth, requireScope, requireTier } from './auth.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeEnv(overrides: Partial<Env> = {}): Env {
    return overrides as unknown as Env;
}

function makeAnonymousContext(): IAuthContext {
    return { ...ANONYMOUS_AUTH_CONTEXT };
}

function makeAuthenticatedContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'db_user_abc',
        clerkUserId: 'user_clerk123',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: 'sess_xyz',
        scopes: [],
        authMethod: 'clerk-jwt',
        ...overrides,
    };
}

function makeApiKeyContext(scopes: string[] = []): IAuthContext {
    return makeAuthenticatedContext({
        authMethod: 'api-key',
        apiKeyId: 'apikey_001',
        clerkUserId: null,
        scopes,
    });
}

function makeRequest(bearerToken?: string): Request {
    const headers: Record<string, string> = {};
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
    return new Request('https://api.example.com/compile', { headers });
}

// ============================================================================
// requireAuth
// ============================================================================

Deno.test('requireAuth - returns null when user is authenticated via clerk-jwt', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'clerk-jwt' });
    const result = requireAuth(ctx);
    assertEquals(result, null);
});

Deno.test('requireAuth - returns null when user is authenticated via api-key', () => {
    const ctx = makeApiKeyContext(['compile:read']);
    const result = requireAuth(ctx);
    assertEquals(result, null);
});

Deno.test('requireAuth - returns null when user is authenticated via local-jwt', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'local-jwt' });
    const result = requireAuth(ctx);
    assertEquals(result, null);
});

Deno.test('requireAuth - returns 401 Response when user is anonymous', async () => {
    const ctx = makeAnonymousContext();
    const result = requireAuth(ctx);
    assertExists(result);
    assertEquals(result!.status, 401);
    const body = await result!.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

// ============================================================================
// requireTier
// ============================================================================

Deno.test('requireTier - returns null when user tier equals required tier', () => {
    const ctx = makeAuthenticatedContext({ tier: UserTier.Free });
    assertEquals(requireTier(ctx, UserTier.Free), null);
});

Deno.test('requireTier - returns null when user tier exceeds required tier', () => {
    const ctx = makeAuthenticatedContext({ tier: UserTier.Pro });
    assertEquals(requireTier(ctx, UserTier.Free), null);
});

Deno.test('requireTier - returns null when admin user requires Pro tier', () => {
    const ctx = makeAuthenticatedContext({ tier: UserTier.Admin });
    assertEquals(requireTier(ctx, UserTier.Pro), null);
});

Deno.test('requireTier - returns 403 when free user requires Pro tier', async () => {
    const ctx = makeAuthenticatedContext({ tier: UserTier.Free });
    const result = requireTier(ctx, UserTier.Pro);
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('requireTier - returns 403 when anonymous user requires Free tier', async () => {
    const ctx = makeAnonymousContext();
    const result = requireTier(ctx, UserTier.Free);
    assertExists(result);
    assertEquals(result!.status, 403);
});

Deno.test('requireTier - error message includes tier names', async () => {
    const ctx = makeAuthenticatedContext({ tier: UserTier.Free });
    const result = requireTier(ctx, UserTier.Pro);
    assertExists(result);
    const body = await result!.json() as { error: string };
    assertEquals(body.error.toLowerCase().includes('pro') || body.error.includes('Pro'), true);
});

// ============================================================================
// requireScope
// ============================================================================

Deno.test('requireScope - returns null for clerk-jwt user (bypasses scope check)', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'clerk-jwt', scopes: [] });
    assertEquals(requireScope(ctx, 'compile:write'), null);
});

Deno.test('requireScope - returns null for local-jwt user (bypasses scope check)', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'local-jwt', scopes: [] });
    assertEquals(requireScope(ctx, 'compile:write'), null);
});

Deno.test('requireScope - returns 401 for anonymous user', async () => {
    const ctx = makeAnonymousContext();
    const result = requireScope(ctx, 'compile:write');
    assertExists(result);
    assertEquals(result!.status, 401);
});

Deno.test('requireScope - returns null when API key has required scope', () => {
    const ctx = makeApiKeyContext(['compile:read', 'compile:write']);
    assertEquals(requireScope(ctx, 'compile:write'), null);
});

Deno.test('requireScope - returns 403 when API key is missing required scope', async () => {
    const ctx = makeApiKeyContext(['compile:read']); // missing compile:write
    const result = requireScope(ctx, 'compile:write');
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('requireScope - returns 403 listing all missing scopes', async () => {
    const ctx = makeApiKeyContext(['compile:read']); // missing compile:write, admin:read
    const result = requireScope(ctx, 'compile:write', 'admin:read');
    assertExists(result);
    assertEquals(result!.status, 403);
    const body = await result!.json() as { error: string };
    assertEquals(body.error.includes('compile:write'), true);
    assertEquals(body.error.includes('admin:read'), true);
});

Deno.test('requireScope - returns null when API key has all of multiple required scopes', () => {
    const ctx = makeApiKeyContext(['compile:read', 'compile:write', 'admin:read']);
    assertEquals(requireScope(ctx, 'compile:read', 'compile:write'), null);
});

// ============================================================================
// authenticateRequestUnified — no token → anonymous
// ============================================================================

Deno.test('authenticateRequestUnified - returns anonymous context when no token present', async () => {
    const env = makeEnv({});
    const req = makeRequest(); // no Authorization header

    const result = await authenticateRequestUnified(req, env);
    assertEquals(result.context.authMethod, 'anonymous');
    assertEquals(result.context.tier, UserTier.Anonymous);
    assertEquals(result.response, undefined);
});

// ============================================================================
// authenticateRequestUnified — unrecognised token format → 401
// ============================================================================

Deno.test('authenticateRequestUnified - returns 401 when token format is unrecognised', async () => {
    const env = makeEnv({});
    // Not abc_ prefix, not dot-separated JWT
    const req = makeRequest('some-random-token-without-dots-or-prefix');

    const result = await authenticateRequestUnified(req, env);
    assertEquals(result.context.authMethod, 'anonymous');
    assertExists(result.response);
    assertEquals(result.response!.status, 401);
    const body = await result.response!.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

// ============================================================================
// authenticateRequestUnified — abc_ API key without Hyperdrive → 503
// ============================================================================

Deno.test('authenticateRequestUnified - returns 503 when abc_ token present but Hyperdrive not configured', async () => {
    const env = makeEnv({}); // no HYPERDRIVE
    const req = makeRequest('abc_someapikey12345');

    const result = await authenticateRequestUnified(req, env);
    assertEquals(result.context.authMethod, 'anonymous');
    assertExists(result.response);
    assertEquals(result.response!.status, 503);
});

// ============================================================================
// authenticateRequestUnified — JWT token path (no Clerk config → 401)
// ============================================================================

Deno.test('authenticateRequestUnified - returns 401 when JWT token fails Clerk verification', async () => {
    const env = makeEnv({}); // no CLERK_JWKS_URL or CLERK_PUBLISHABLE_KEY
    // A token with three dot-separated parts looks like a JWT
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyX3Rlc3QifQ.invalidsignature';
    const req = makeRequest(fakeJwt);

    const result = await authenticateRequestUnified(req, env);
    assertExists(result.response);
    assertEquals(result.response!.status, 401);
});

// ============================================================================
// authenticateRequestUnified — abc_ token with createPool not provided → 503
// ============================================================================

Deno.test('authenticateRequestUnified - returns 503 when abc_ token present but createPool not provided', async () => {
    const env = makeEnv({
        HYPERDRIVE: { connectionString: 'postgres://localhost/test' } as unknown as HyperdriveBinding,
    });
    const req = makeRequest('abc_validlookingtokenhere');

    // No createPool provided
    const result = await authenticateRequestUnified(req, env);
    assertExists(result.response);
    assertEquals(result.response!.status, 503);
});

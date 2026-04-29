/**
 * Tests for worker/middleware/auth.ts
 *
 * Covers:
 *   - requireAuth: returns null for authenticated users
 *   - requireAuth: returns 401 for anonymous users
 *   - requireTier: returns null when tier is sufficient
 *   - requireTier: returns 403 when tier is insufficient
 *   - requireScope: better-auth users bypass scope checks
 *   - requireScope: anonymous users get 401
 *   - requireScope: API-key users are scope-checked
 *   - authenticateRequestUnified: no token → anonymous context
 *   - authenticateRequestUnified: unrecognised token format → 401
 *   - authenticateRequestUnified: abc_-prefix token without Hyperdrive → 503
 *   - authenticateRequestUnified: custom authProvider (Better Auth) — no token → cookie auth
 *   - authenticateRequestUnified: custom authProvider — non-JWT session token → provider auth
 *   - authenticateRequestUnified: custom authProvider — provider returns invalid → anonymous
 *   - authenticateRequestUnified: custom authProvider — provider error + token → 401
 *   - hashToken/extractBearerToken: exercised via authenticateApiKey paths
 *   - isApiKeyToken: exercised via authenticateRequestUnified
 */

import { assertEquals, assertExists } from '@std/assert';
import { ANONYMOUS_AUTH_CONTEXT, type Env, type IAuthContext, type IAuthProvider, type IAuthProviderResult, UserTier } from '../types.ts';
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
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: 'sess_xyz',
        scopes: [],
        authMethod: 'better-auth',
        ...overrides,
    };
}

function makeApiKeyContext(scopes: string[] = []): IAuthContext {
    return makeAuthenticatedContext({
        authMethod: 'api-key',
        apiKeyId: 'apikey_001',
        scopes,
    });
}

function makeRequest(bearerToken?: string): Request {
    const headers: Record<string, string> = {};
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
    return new Request('https://api.example.com/compile', { headers });
}

/**
 * Minimal stub for IAuthProvider — returns a pre-configured result.
 */
function makeAuthProviderStub(result: IAuthProviderResult): IAuthProvider {
    return {
        name: 'stub-provider',
        authMethod: 'better-auth' as const,
        verifyToken: (_req: Request) => Promise.resolve(result),
    };
}
// ============================================================================
// requireAuth
// ============================================================================

Deno.test('requireAuth - returns null when user is authenticated via better-auth', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'better-auth' });
    const result = requireAuth(ctx);
    assertEquals(result, null);
});

Deno.test('requireAuth - returns null when user is authenticated via api-key', () => {
    const ctx = makeApiKeyContext(['compile:read']);
    const result = requireAuth(ctx);
    assertEquals(result, null);
});

Deno.test('requireAuth - returns null when user is authenticated via better-auth', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'better-auth' });
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

Deno.test('requireScope - returns null for better-auth user (bypasses scope check)', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'better-auth', scopes: [] });
    assertEquals(requireScope(ctx, 'compile:write'), null);
});

Deno.test('requireScope - returns null for better-auth user (bypasses scope check)', () => {
    const ctx = makeAuthenticatedContext({ authMethod: 'better-auth', scopes: [] });
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
// authenticateRequestUnified — JWT-like token without authProvider → 401
// ============================================================================

Deno.test('authenticateRequestUnified - returns 401 when JWT-like token is present but no authProvider handles it', async () => {
    const env = makeEnv({});
    // A token with three dot-separated parts looks like a JWT but no auth provider is set
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyX3Rlc3QifQ.invalidsignature';
    const req = makeRequest(fakeJwt);

    const result = await authenticateRequestUnified(req, env);
    assertExists(result.response);
    assertEquals(result.response!.status, 401);
});

// ============================================================================
// ============================================================================
// authenticateRequestUnified — custom authProvider (Better Auth) paths
// ============================================================================

Deno.test('authenticateRequestUnified - custom provider authenticates via cookie (no Bearer token)', async () => {
    const env = makeEnv({});
    // No Authorization header — simulates a browser request with only a session cookie.
    const req = new Request('https://api.example.com/compile', {
        headers: { Cookie: 'better-auth.session_token=sess_abc123' },
    });
    const provider = makeAuthProviderStub({
        valid: true,
        providerUserId: 'ba_user_001',
        tier: UserTier.Free,
        role: 'user',
        sessionId: 'sess_abc123',
    });

    const result = await authenticateRequestUnified(req, env, provider);
    assertEquals(result.context.authMethod, 'better-auth');
    assertEquals(result.context.userId, 'ba_user_001');
    assertEquals(result.context.tier, UserTier.Free);
    assertEquals(result.response, undefined);
});

Deno.test('authenticateRequestUnified - custom provider authenticates non-JWT session Bearer token', async () => {
    const env = makeEnv({});
    // A random session token (not a JWT, not an API key) sent as Bearer.
    const req = makeRequest('sess_randomsessionid12345');
    const provider = makeAuthProviderStub({
        valid: true,
        providerUserId: 'ba_user_002',
        tier: UserTier.Pro,
        role: 'user',
        sessionId: 'sess_randomsessionid12345',
    });

    const result = await authenticateRequestUnified(req, env, provider);
    assertEquals(result.context.authMethod, 'better-auth');
    assertEquals(result.context.userId, 'ba_user_002');
    assertEquals(result.context.tier, UserTier.Pro);
    assertEquals(result.response, undefined);
});

Deno.test('authenticateRequestUnified - custom provider returns invalid with no error → anonymous (no token)', async () => {
    const env = makeEnv({});
    const req = makeRequest(); // no token
    const provider = makeAuthProviderStub({ valid: false });

    const result = await authenticateRequestUnified(req, env, provider);
    assertEquals(result.context.authMethod, 'anonymous');
    assertEquals(result.response, undefined);
});

Deno.test('authenticateRequestUnified - custom provider rejects Bearer token → 401', async () => {
    const env = makeEnv({});
    const req = makeRequest('sess_expiredtoken');
    const provider = makeAuthProviderStub({ valid: false, error: 'Session expired' });

    const result = await authenticateRequestUnified(req, env, provider);
    assertEquals(result.context.authMethod, 'anonymous');
    assertExists(result.response);
    assertEquals(result.response!.status, 401);
    const body = await result.response!.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    // Error must not leak internal details — generic message only
    assertEquals(body.error, 'Authentication failed');
});

Deno.test('authenticateRequestUnified - API key is checked before custom provider', async () => {
    const env = makeEnv({});
    // An API key token is always routed to the API key path regardless of provider
    const req = makeRequest('abc_apikey_test');
    const provider = makeAuthProviderStub({ valid: true, providerUserId: 'should_not_be_used' });

    const result = await authenticateRequestUnified(req, env, provider);
    // No HYPERDRIVE configured → 503 from API key path (not reaching the provider)
    assertExists(result.response);
    assertEquals(result.response!.status, 503);
});

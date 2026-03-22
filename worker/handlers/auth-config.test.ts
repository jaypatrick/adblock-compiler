/**
 * Tests for the admin auth config handler.
 *
 * Covers:
 *   - 401 for anonymous/unauthenticated callers
 *   - 403 for non-admin tiers or non-admin roles
 *   - 200 with provider=better-auth (sole provider)
 *   - Response shape: tiers array sorted by order
 *   - Response shape: non-empty routes array
 *
 * @see worker/handlers/auth-config.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleAdminAuthConfig } from './auth-config.ts';
import { makeEnv } from '../test-helpers.ts';
import { ANONYMOUS_AUTH_CONTEXT, type IAuthContext, UserTier } from '../types.ts';

function makeAdminContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'u_admin',
        tier: UserTier.Admin,
        role: 'admin',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
        ...overrides,
    };
}

const req = new Request('http://localhost/admin/auth/config');

// ============================================================================
// Auth checks
// ============================================================================

Deno.test('handleAdminAuthConfig - returns 401 for anonymous auth context', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), ANONYMOUS_AUTH_CONTEXT);
    assertEquals(res.status, 401);
});

Deno.test('handleAdminAuthConfig - returns 403 for free-tier user', async () => {
    const ctx: IAuthContext = {
        userId: 'u_free',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
    };
    const res = await handleAdminAuthConfig(req, makeEnv(), ctx);
    assertEquals(res.status, 403);
});

Deno.test('handleAdminAuthConfig - returns 403 for admin-tier with non-admin role', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext({ role: 'user' }));
    assertEquals(res.status, 403);
});

// ============================================================================
// Happy-path: provider detection
// ============================================================================

Deno.test('handleAdminAuthConfig - returns 200 with provider=better-auth', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; provider: string };
    assertEquals(body.success, true);
    assertEquals(body.provider, 'better-auth');
});

// ============================================================================
// Response shape
// ============================================================================

Deno.test('handleAdminAuthConfig - tiers array is sorted by order ascending', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { tiers: { order: number }[] };
    assertExists(body.tiers);
    for (let i = 1; i < body.tiers.length; i++) {
        assertEquals(body.tiers[i].order >= body.tiers[i - 1].order, true);
    }
});

Deno.test('handleAdminAuthConfig - response includes non-empty routes array', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { routes: { pattern: string }[] };
    assertExists(body.routes);
    assertEquals(body.routes.length > 0, true);
});

// ============================================================================
// Expanded response shape: socialProviders, mfa, session, betterAuth
// ============================================================================

Deno.test('handleAdminAuthConfig - socialProviders field is present', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { socialProviders: { github: { configured: boolean }; google: { configured: boolean } } };
    assertExists(body.socialProviders);
    assertEquals(typeof body.socialProviders.github.configured, 'boolean');
    assertEquals(typeof body.socialProviders.google.configured, 'boolean');
});

Deno.test('handleAdminAuthConfig - github configured=false when env vars absent', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { socialProviders: { github: { configured: boolean } } };
    assertEquals(body.socialProviders.github.configured, false);
});

Deno.test('handleAdminAuthConfig - github configured=true when env vars present', async () => {
    const env = makeEnv({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' });
    const res = await handleAdminAuthConfig(req, env, makeAdminContext());
    const body = await res.json() as { socialProviders: { github: { configured: boolean } } };
    assertEquals(body.socialProviders.github.configured, true);
});

Deno.test('handleAdminAuthConfig - mfa field is present and enabled=true', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { mfa: { enabled: boolean } };
    assertExists(body.mfa);
    assertEquals(body.mfa.enabled, true);
});

Deno.test('handleAdminAuthConfig - session field has required duration fields', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { session: { expiresIn: number; updateAge: number; cookieCacheMaxAge: number } };
    assertExists(body.session);
    assertEquals(typeof body.session.expiresIn, 'number');
    assertEquals(typeof body.session.updateAge, 'number');
    assertEquals(typeof body.session.cookieCacheMaxAge, 'number');
    assertEquals(body.session.expiresIn > 0, true);
});

Deno.test('handleAdminAuthConfig - betterAuth field is present', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { betterAuth: { secretConfigured: boolean; baseUrl: string | null } };
    assertExists(body.betterAuth);
    assertEquals(typeof body.betterAuth.secretConfigured, 'boolean');
    // baseUrl is null when BETTER_AUTH_URL is not set
    assertEquals(body.betterAuth.baseUrl, null);
});

Deno.test('handleAdminAuthConfig - betterAuth.secretConfigured=true when BETTER_AUTH_SECRET set', async () => {
    const env = makeEnv({ BETTER_AUTH_SECRET: 'my-secret' });
    const res = await handleAdminAuthConfig(req, env, makeAdminContext());
    const body = await res.json() as { betterAuth: { secretConfigured: boolean } };
    assertEquals(body.betterAuth.secretConfigured, true);
});

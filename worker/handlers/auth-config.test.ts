/**
 * Tests for the admin auth config handler.
 *
 * Covers:
 *   - 401 for anonymous/unauthenticated callers
 *   - 403 for non-admin tiers or non-admin roles
 *   - 200 with provider=better-auth when CLERK_JWKS_URL is absent
 *   - 200 with provider=clerk when CLERK_JWKS_URL is set
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
        clerkUserId: null,
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
        clerkUserId: null,
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

Deno.test('handleAdminAuthConfig - returns 200 with provider=better-auth when no CLERK_JWKS_URL', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; provider: string };
    assertEquals(body.success, true);
    assertEquals(body.provider, 'better-auth');
});

Deno.test('handleAdminAuthConfig - returns 200 with provider=clerk when CLERK_JWKS_URL is set', async () => {
    const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
    const res = await handleAdminAuthConfig(req, env, makeAdminContext());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; provider: string };
    assertEquals(body.provider, 'clerk');
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
// New fields: social providers, MFA, session, betterAuth, clerk
// ============================================================================

Deno.test('handleAdminAuthConfig - response includes socialProviders with boolean flags', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv(), makeAdminContext());
    const body = await res.json() as { socialProviders: { github: { configured: boolean }; google: { configured: boolean } } };
    assertExists(body.socialProviders);
    assertEquals(typeof body.socialProviders.github.configured, 'boolean');
    assertEquals(typeof body.socialProviders.google.configured, 'boolean');
    // No env vars set → both false
    assertEquals(body.socialProviders.github.configured, false);
    assertEquals(body.socialProviders.google.configured, false);
});

Deno.test('handleAdminAuthConfig - github configured=true when both GITHUB env vars set', async () => {
    const env = makeEnv({ GITHUB_CLIENT_ID: 'gh_id', GITHUB_CLIENT_SECRET: 'gh_secret' });
    const res = await handleAdminAuthConfig(req, env, makeAdminContext());
    const body = await res.json() as { socialProviders: { github: { configured: boolean } } };
    assertEquals(body.socialProviders.github.configured, true);
});

Deno.test('handleAdminAuthConfig - response includes mfa, session, betterAuth, clerk', async () => {
    const res = await handleAdminAuthConfig(req, makeEnv({ BETTER_AUTH_SECRET: 'test-secret' }), makeAdminContext());
    const body = await res.json() as {
        mfa: { enabled: boolean };
        session: { expiresIn: number; updateAge: number; cookieCacheMaxAge: number };
        betterAuth: { secretConfigured: boolean; baseUrl: string | null };
        clerk: { enabled: boolean; publishableKeyConfigured: boolean };
    };
    assertEquals(body.mfa.enabled, true);
    assertEquals(body.session.expiresIn, 604800);
    assertEquals(body.session.updateAge, 86400);
    assertEquals(body.session.cookieCacheMaxAge, 300);
    assertEquals(body.betterAuth.secretConfigured, true);
    assertEquals(body.clerk.enabled, false);
});

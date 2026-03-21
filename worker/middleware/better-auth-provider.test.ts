/**
 * Tests for the Better Auth Provider.
 *
 * BetterAuthProvider.verifyToken() calls createAuth() which needs a real D1
 * database and Better Auth secret, so we cannot unit-test the full flow.
 * Instead, we test:
 *
 *   - resolveTier: correct tier mapping, fallback to Free
 *   - resolveRole: correct role mapping, fallback to 'user'
 *   - verifyToken guard: missing BETTER_AUTH_SECRET → structured error
 *   - verifyToken guard: missing DB → structured error
 *
 * @see worker/middleware/better-auth-provider.ts
 */

import { assertEquals } from '@std/assert';
import { BetterAuthProvider, resolveRole, resolveTier } from './better-auth-provider.ts';
import { UserTier } from '../types.ts';
import { makeEnv } from '../test-helpers.ts';

// ============================================================================
// resolveTier
// ============================================================================

Deno.test('resolveTier - returns Free when tier is null', () => {
    assertEquals(resolveTier(null), UserTier.Free);
});

Deno.test('resolveTier - returns Free when tier is undefined', () => {
    assertEquals(resolveTier(undefined), UserTier.Free);
});

Deno.test('resolveTier - returns Free when tier is empty string', () => {
    assertEquals(resolveTier(''), UserTier.Free);
});

Deno.test('resolveTier - returns Free for unknown tier string', () => {
    assertEquals(resolveTier('enterprise'), UserTier.Free);
});

Deno.test('resolveTier - returns Free tier', () => {
    assertEquals(resolveTier('free'), UserTier.Free);
});

Deno.test('resolveTier - returns Pro tier', () => {
    assertEquals(resolveTier('pro'), UserTier.Pro);
});

Deno.test('resolveTier - returns Admin tier', () => {
    assertEquals(resolveTier('admin'), UserTier.Admin);
});

Deno.test('resolveTier - returns correct tier for all valid UserTier values', () => {
    for (const tier of Object.values(UserTier)) {
        assertEquals(resolveTier(tier), tier);
    }
});

// ============================================================================
// resolveRole
// ============================================================================

Deno.test('resolveRole - returns "user" when role is null', () => {
    assertEquals(resolveRole(null), 'user');
});

Deno.test('resolveRole - returns "user" when role is undefined', () => {
    assertEquals(resolveRole(undefined), 'user');
});

Deno.test('resolveRole - returns provided role when set', () => {
    assertEquals(resolveRole('admin'), 'admin');
});

Deno.test('resolveRole - returns empty string when explicitly set', () => {
    assertEquals(resolveRole(''), '');
});

Deno.test('resolveRole - preserves custom role strings', () => {
    assertEquals(resolveRole('moderator'), 'moderator');
});

// ============================================================================
// BetterAuthProvider — guard conditions
// ============================================================================

Deno.test('BetterAuthProvider.verifyToken - returns error when BETTER_AUTH_SECRET is missing', async () => {
    const env = makeEnv(); // no BETTER_AUTH_SECRET
    const provider = new BetterAuthProvider(env);
    const req = new Request('http://localhost/test');

    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
    assertEquals(typeof result.error, 'string');
    assertEquals(result.error!.includes('BETTER_AUTH_SECRET'), true);
});

Deno.test('BetterAuthProvider.verifyToken - returns error when DB is missing', async () => {
    const env = makeEnv({ BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!' });
    // env.DB is not set by makeEnv
    const provider = new BetterAuthProvider(env);
    const req = new Request('http://localhost/test');

    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
    assertEquals(typeof result.error, 'string');
    assertEquals(result.error!.includes('D1'), true);
});

Deno.test('BetterAuthProvider - has correct name', () => {
    const env = makeEnv();
    const provider = new BetterAuthProvider(env);
    assertEquals(provider.name, 'better-auth');
});

Deno.test('BetterAuthProvider - has correct authMethod', () => {
    const env = makeEnv();
    const provider = new BetterAuthProvider(env);
    assertEquals(provider.authMethod, 'better-auth');
});

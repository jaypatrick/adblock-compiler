/**
 * Tests for the Route Permission Registry.
 *
 * Covers:
 *   - resolveRoutePermission: exact match, prefix match, longest-prefix wins,
 *     no match → null
 *   - checkRoutePermission: anonymous 401, insufficient tier 403, wrong role 403,
 *     allowed returns null, public routes always pass
 *
 * These tests document the extensibility contract: adding one entry to
 * ROUTE_PERMISSION_REGISTRY is all that's needed to protect a new endpoint.
 *
 * @see worker/utils/route-permissions.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import {
    checkRoutePermission,
    ROUTE_PERMISSION_REGISTRY,
    resolveRoutePermission,
} from './route-permissions.ts';
import { type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user-001',
        clerkUserId: 'user-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'local-jwt',
        ...overrides,
    };
}

const anonContext = makeContext({
    userId: null,
    clerkUserId: null,
    tier: UserTier.Anonymous,
    role: 'anonymous',
    authMethod: 'anonymous',
});

const adminContext = makeContext({
    tier: UserTier.Admin,
    role: 'admin',
});

const proContext = makeContext({ tier: UserTier.Pro, role: 'user' });

// ============================================================================
// resolveRoutePermission — exact matches
// ============================================================================

Deno.test('resolveRoutePermission - returns null for unknown path', () => {
    const result = resolveRoutePermission('/completely/unknown/path');
    assertEquals(result, null);
});

Deno.test('resolveRoutePermission - exact match: /auth/me', () => {
    const result = resolveRoutePermission('/auth/me');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Free);
});

Deno.test('resolveRoutePermission - exact match: /auth/change-password', () => {
    const result = resolveRoutePermission('/auth/change-password');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Free);
});

Deno.test('resolveRoutePermission - exact match: /admin/local-users', () => {
    const result = resolveRoutePermission('/admin/local-users');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Admin);
    assertEquals(result!.requiredRole, 'admin');
});

Deno.test('resolveRoutePermission - exact match: public /auth/signup → Anonymous', () => {
    const result = resolveRoutePermission('/auth/signup');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Anonymous);
});

// ============================================================================
// resolveRoutePermission — prefix matches
// ============================================================================

Deno.test('resolveRoutePermission - prefix match: /admin/anything → admin/*', () => {
    const result = resolveRoutePermission('/admin/some/deep/path');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Admin);
});

Deno.test('resolveRoutePermission - prefix match: /admin/local-users/uuid → local-users/* (longer prefix wins)', () => {
    const result = resolveRoutePermission('/admin/local-users/abc-def-123');
    assertExists(result);
    // /admin/local-users/* is more specific than /admin/* — longer prefix wins
    assertEquals(result!.requiredRole, 'admin');
    assertEquals(result!.minTier, UserTier.Admin);
    assertEquals(result!.description, 'Local user management (update tier/role)');
});

Deno.test('resolveRoutePermission - prefix match: /workflow/status/abc → workflow/*', () => {
    const result = resolveRoutePermission('/workflow/status/abc');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Pro);
});

Deno.test('resolveRoutePermission - prefix match: /keys/abc-uuid → keys/*', () => {
    const result = resolveRoutePermission('/keys/abc-uuid');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Free);
});

// ============================================================================
// checkRoutePermission — public endpoints always pass
// ============================================================================

Deno.test('checkRoutePermission - public endpoint /auth/login allows anonymous', () => {
    assertEquals(checkRoutePermission('/auth/login', anonContext), null);
});

Deno.test('checkRoutePermission - public endpoint /auth/signup allows anonymous', () => {
    assertEquals(checkRoutePermission('/auth/signup', anonContext), null);
});

Deno.test('checkRoutePermission - unknown path always passes (no restriction)', () => {
    assertEquals(checkRoutePermission('/unknown/path', anonContext), null);
});

Deno.test('checkRoutePermission - compile endpoint allows anonymous', () => {
    assertEquals(checkRoutePermission('/compile', anonContext), null);
});

// ============================================================================
// checkRoutePermission — anonymous gets 401 on protected routes
// ============================================================================

Deno.test('checkRoutePermission - /auth/me returns 401 for anonymous', () => {
    const response = checkRoutePermission('/auth/me', anonContext);
    assertExists(response);
    assertEquals(response!.status, 401);
});

Deno.test('checkRoutePermission - /admin/local-users returns 401 for anonymous', () => {
    const response = checkRoutePermission('/admin/local-users', anonContext);
    assertExists(response);
    assertEquals(response!.status, 401);
});

// ============================================================================
// checkRoutePermission — insufficient tier gets 403
// ============================================================================

Deno.test('checkRoutePermission - /compile/async returns 403 for Free tier', () => {
    const response = checkRoutePermission('/compile/async', makeContext({ tier: UserTier.Free }));
    assertExists(response);
    assertEquals(response!.status, 403);
});

Deno.test('checkRoutePermission - /workflow/compile returns 403 for Free tier', () => {
    const response = checkRoutePermission('/workflow/compile', makeContext({ tier: UserTier.Free }));
    assertExists(response);
    assertEquals(response!.status, 403);
});

Deno.test('checkRoutePermission - /admin/local-users returns 403 for Pro user (not admin)', () => {
    const response = checkRoutePermission('/admin/local-users', proContext);
    assertExists(response);
    assertEquals(response!.status, 403);
});

// ============================================================================
// checkRoutePermission — role guard
// ============================================================================

Deno.test('checkRoutePermission - /admin/local-users returns 403 if tier=Admin but role!=admin', () => {
    // Admin tier but wrong role — role guard fires after tier check passes
    const highTierWrongRole = makeContext({ tier: UserTier.Admin, role: 'user' });
    const response = checkRoutePermission('/admin/local-users', highTierWrongRole);
    assertExists(response);
    assertEquals(response!.status, 403);
});

Deno.test('checkRoutePermission - /admin/local-users/id returns 403 for wrong role', () => {
    const highTierWrongRole = makeContext({ tier: UserTier.Admin, role: 'user' });
    const response = checkRoutePermission('/admin/local-users/some-uuid', highTierWrongRole);
    assertExists(response);
    assertEquals(response!.status, 403);
});

// ============================================================================
// checkRoutePermission — allowed returns null
// ============================================================================

Deno.test('checkRoutePermission - /auth/me allows Free user', () => {
    assertEquals(checkRoutePermission('/auth/me', makeContext()), null);
});

Deno.test('checkRoutePermission - /keys allows Free user', () => {
    assertEquals(checkRoutePermission('/keys', makeContext()), null);
});

Deno.test('checkRoutePermission - /compile/async allows Pro user', () => {
    assertEquals(checkRoutePermission('/compile/async', proContext), null);
});

Deno.test('checkRoutePermission - /admin/local-users allows admin', () => {
    assertEquals(checkRoutePermission('/admin/local-users', adminContext), null);
});

Deno.test('checkRoutePermission - /admin/local-users/uuid allows admin', () => {
    assertEquals(checkRoutePermission('/admin/local-users/abc-123', adminContext), null);
});

Deno.test('checkRoutePermission - /admin/anything allows admin (prefix match)', () => {
    assertEquals(checkRoutePermission('/admin/other-section', adminContext), null);
});

// ============================================================================
// Error response bodies
// ============================================================================

Deno.test('checkRoutePermission - 401 body says "Authentication required"', async () => {
    const response = checkRoutePermission('/auth/me', anonContext);
    assertExists(response);
    const body = await response!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(body.error, 'Authentication required');
});

Deno.test('checkRoutePermission - 403 body says "Insufficient tier"', async () => {
    const response = checkRoutePermission('/compile/async', makeContext({ tier: UserTier.Free }));
    assertExists(response);
    const body = await response!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(typeof body.error, 'string');
    assertEquals((body.error as string).startsWith('Insufficient tier'), true);
});

Deno.test('checkRoutePermission - 403 body says "Insufficient role"', async () => {
    const response = checkRoutePermission('/admin/local-users', makeContext({ tier: UserTier.Admin, role: 'user' }));
    assertExists(response);
    const body = await response!.json() as Record<string, unknown>;
    assertEquals(body.success, false);
    assertEquals(body.error, 'Insufficient role');
});

// ============================================================================
// Registry extensibility contract
// ============================================================================

Deno.test('ROUTE_PERMISSION_REGISTRY - is a Map (add entries at runtime for testing)', () => {
    // Demonstrate the extensibility pattern: adding a new route protection
    // requires exactly one entry in the Map — no other changes needed.
    const originalSize = ROUTE_PERMISSION_REGISTRY.size;

    ROUTE_PERMISSION_REGISTRY.set('/test/new-endpoint', {
        minTier: UserTier.Pro,
        description: 'Test endpoint',
    });

    assertEquals(ROUTE_PERMISSION_REGISTRY.size, originalSize + 1);
    assertEquals(checkRoutePermission('/test/new-endpoint', makeContext({ tier: UserTier.Free }))?.status, 403);
    assertEquals(checkRoutePermission('/test/new-endpoint', proContext), null);

    // Clean up
    ROUTE_PERMISSION_REGISTRY.delete('/test/new-endpoint');
    assertEquals(ROUTE_PERMISSION_REGISTRY.size, originalSize);
});

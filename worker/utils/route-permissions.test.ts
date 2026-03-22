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
import { checkRoutePermission, resolveRoutePermission, ROUTE_PERMISSION_REGISTRY } from './route-permissions.ts';
import { type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'better-auth',
        ...overrides,
    };
}

const anonContext = makeContext({
    userId: null,
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

Deno.test('resolveRoutePermission - exact match: /compile', () => {
    const result = resolveRoutePermission('/compile');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Free);
});

Deno.test('resolveRoutePermission - exact match: /keys', () => {
    const result = resolveRoutePermission('/keys');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Free);
});

Deno.test('resolveRoutePermission - exact match: /admin/users', () => {
    const result = resolveRoutePermission('/admin/users');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Admin);
    assertEquals(result!.requiredRole, 'admin');
});

Deno.test('resolveRoutePermission - exact match: public /health → Anonymous', () => {
    const result = resolveRoutePermission('/health');
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

Deno.test('resolveRoutePermission - prefix match: /admin/users/uuid → users/* (longer prefix wins)', () => {
    const result = resolveRoutePermission('/admin/users/abc-def-123');
    assertExists(result);
    // /admin/users/* is more specific than /admin/* — longer prefix wins
    assertEquals(result!.requiredRole, 'admin');
    assertEquals(result!.minTier, UserTier.Admin);
    assertEquals(result!.description, 'User management (update tier/role, ban/unban)');
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

Deno.test('checkRoutePermission - public endpoint /health allows anonymous', () => {
    assertEquals(checkRoutePermission('/health', anonContext), null);
});

Deno.test('checkRoutePermission - public endpoint /docs allows anonymous', () => {
    assertEquals(checkRoutePermission('/docs', anonContext), null);
});

Deno.test('checkRoutePermission - unknown path returns 401 for anonymous (ZTA deny-by-default)', () => {
    // Unregistered routes now require Free tier by default (ZTA).
    // Authenticated users can still reach unregistered paths; anonymous users cannot.
    const response = checkRoutePermission('/unknown/path', anonContext);
    assertExists(response);
    assertEquals(response!.status, 401);
});

Deno.test('checkRoutePermission - unknown path allows authenticated Free user (ZTA deny-by-default)', () => {
    // Free-tier authenticated user can reach unregistered paths.
    assertEquals(checkRoutePermission('/unknown/path', makeContext()), null);
});

Deno.test('checkRoutePermission - compile endpoint returns 401 for anonymous (requires sign-in)', () => {
    // /compile is now Free-tier — anonymous users must sign in.
    const response = checkRoutePermission('/compile', anonContext);
    assertExists(response);
    assertEquals(response!.status, 401);
});

Deno.test('checkRoutePermission - compile endpoint allows Free user', () => {
    assertEquals(checkRoutePermission('/compile', makeContext()), null);
});

// ============================================================================
// checkRoutePermission — anonymous gets 401 on protected routes
// ============================================================================

Deno.test('checkRoutePermission - /keys returns 401 for anonymous', () => {
    const response = checkRoutePermission('/keys', anonContext);
    assertExists(response);
    assertEquals(response!.status, 401);
});

Deno.test('checkRoutePermission - /admin/users returns 401 for anonymous', () => {
    const response = checkRoutePermission('/admin/users', anonContext);
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

Deno.test('checkRoutePermission - /admin/users returns 403 for Pro user (not admin)', () => {
    const response = checkRoutePermission('/admin/users', proContext);
    assertExists(response);
    assertEquals(response!.status, 403);
});

// ============================================================================
// checkRoutePermission — role guard
// ============================================================================

Deno.test('checkRoutePermission - /admin/users returns 403 if tier=Admin but role!=admin', () => {
    // Admin tier but wrong role — role guard fires after tier check passes
    const highTierWrongRole = makeContext({ tier: UserTier.Admin, role: 'user' });
    const response = checkRoutePermission('/admin/users', highTierWrongRole);
    assertExists(response);
    assertEquals(response!.status, 403);
});

Deno.test('checkRoutePermission - /admin/users/id returns 403 for wrong role', () => {
    const highTierWrongRole = makeContext({ tier: UserTier.Admin, role: 'user' });
    const response = checkRoutePermission('/admin/users/some-uuid', highTierWrongRole);
    assertExists(response);
    assertEquals(response!.status, 403);
});

// ============================================================================
// checkRoutePermission — allowed returns null
// ============================================================================

Deno.test('checkRoutePermission - /compile allows Free user', () => {
    assertEquals(checkRoutePermission('/compile', makeContext()), null);
});

Deno.test('checkRoutePermission - /keys allows Free user', () => {
    assertEquals(checkRoutePermission('/keys', makeContext()), null);
});

Deno.test('checkRoutePermission - /compile/async allows Pro user', () => {
    assertEquals(checkRoutePermission('/compile/async', proContext), null);
});

Deno.test('checkRoutePermission - /admin/users allows admin', () => {
    assertEquals(checkRoutePermission('/admin/users', adminContext), null);
});

Deno.test('checkRoutePermission - /admin/users/uuid allows admin', () => {
    assertEquals(checkRoutePermission('/admin/users/abc-123', adminContext), null);
});

Deno.test('checkRoutePermission - /admin/anything allows admin (prefix match)', () => {
    assertEquals(checkRoutePermission('/admin/other-section', adminContext), null);
});

// ============================================================================
// Error response bodies
// ============================================================================

Deno.test('checkRoutePermission - 401 body says "Authentication required"', async () => {
    const response = checkRoutePermission('/keys', anonContext);
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
    const response = checkRoutePermission('/admin/users', makeContext({ tier: UserTier.Admin, role: 'user' }));
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

// ============================================================================
// Routes: /docs, /docs/*, /admin/storage, /admin/storage/*
// ============================================================================

// ── /docs ────────────────────────────────────────────────────────────────────

Deno.test('checkRoutePermission - /docs resolves as Anonymous (returns null for anonymous)', () => {
    assertEquals(checkRoutePermission('/docs', anonContext), null);
});

Deno.test('checkRoutePermission - /docs/some-page resolves as Anonymous via prefix match (returns null for anonymous)', () => {
    assertEquals(checkRoutePermission('/docs/some-page', anonContext), null);
});

// ── /admin/storage ───────────────────────────────────────────────────────────

Deno.test('resolveRoutePermission - /admin/storage resolves as Admin with admin role', () => {
    const result = resolveRoutePermission('/admin/storage');
    assertExists(result);
    assertEquals(result!.minTier, UserTier.Admin);
    assertEquals(result!.requiredRole, 'admin');
});

Deno.test('checkRoutePermission - /admin/storage returns 401 for anonymous', () => {
    const response = checkRoutePermission('/admin/storage', anonContext);
    assertExists(response);
    assertEquals(response!.status, 401);
});

Deno.test('checkRoutePermission - /admin/storage returns 403 for Free user', () => {
    const response = checkRoutePermission('/admin/storage', makeContext());
    assertExists(response);
    assertEquals(response!.status, 403);
});

Deno.test('checkRoutePermission - /admin/storage/r2-bucket returns 401 for anonymous', () => {
    const response = checkRoutePermission('/admin/storage/r2-bucket', anonContext);
    assertExists(response);
    assertEquals(response!.status, 401);
});

Deno.test('checkRoutePermission - /admin/storage/r2-bucket allows admin (returns null)', () => {
    assertEquals(checkRoutePermission('/admin/storage/r2-bucket', adminContext), null);
});

Deno.test('checkRoutePermission - /admin/storage returns 403 for wrong role (admin tier but user role)', () => {
    const adminTierWrongRole = makeContext({ tier: UserTier.Admin, role: 'user' });
    const response = checkRoutePermission('/admin/storage', adminTierWrongRole);
    assertExists(response);
    assertEquals(response!.status, 403);
});

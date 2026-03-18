/**
 * Tests for the Local Auth Role Registry.
 *
 * Covers:
 *   - LOCAL_ROLE_REGISTRY structure and required fields
 *   - DEFAULT_ROLE is 'user'
 *   - VALID_LOCAL_ROLES contains all registry keys
 *   - isValidLocalRole: returns true for known roles, false for unknown
 *   - tierForRole: returns correct tier for known roles, Free for unknown
 *
 * @see worker/utils/local-auth-roles.ts
 */

import { assertEquals } from '@std/assert';
import { DEFAULT_ROLE, isValidLocalRole, LOCAL_ROLE_REGISTRY, tierForRole, VALID_LOCAL_ROLES } from './local-auth-roles.ts';
import { UserTier } from '../types.ts';

// ============================================================================
// LOCAL_ROLE_REGISTRY
// ============================================================================

Deno.test('LOCAL_ROLE_REGISTRY - contains user and admin roles', () => {
    assertEquals('user' in LOCAL_ROLE_REGISTRY, true);
    assertEquals('admin' in LOCAL_ROLE_REGISTRY, true);
});

Deno.test('LOCAL_ROLE_REGISTRY - user role has correct properties', () => {
    const userRole = LOCAL_ROLE_REGISTRY.user;
    assertEquals(userRole.tier, UserTier.Free);
    assertEquals(userRole.canSelfRegister, true);
    assertEquals(typeof userRole.displayName, 'string');
    assertEquals(userRole.displayName.length > 0, true);
    assertEquals(typeof userRole.description, 'string');
    assertEquals(userRole.description.length > 0, true);
});

Deno.test('LOCAL_ROLE_REGISTRY - admin role has correct properties', () => {
    const adminRole = LOCAL_ROLE_REGISTRY.admin;
    assertEquals(adminRole.tier, UserTier.Admin);
    assertEquals(adminRole.canSelfRegister, false);
    assertEquals(typeof adminRole.displayName, 'string');
    assertEquals(adminRole.displayName.length > 0, true);
    assertEquals(typeof adminRole.description, 'string');
    assertEquals(adminRole.description.length > 0, true);
});

// ============================================================================
// DEFAULT_ROLE
// ============================================================================

Deno.test('DEFAULT_ROLE - is user', () => {
    assertEquals(DEFAULT_ROLE, 'user');
});

// ============================================================================
// VALID_LOCAL_ROLES
// ============================================================================

Deno.test('VALID_LOCAL_ROLES - contains user and admin', () => {
    assertEquals(VALID_LOCAL_ROLES.includes('user'), true);
    assertEquals(VALID_LOCAL_ROLES.includes('admin'), true);
});

Deno.test('VALID_LOCAL_ROLES - matches registry keys', () => {
    const registryKeys = Object.keys(LOCAL_ROLE_REGISTRY) as string[];
    assertEquals(VALID_LOCAL_ROLES.length, registryKeys.length);
    for (const key of registryKeys) {
        assertEquals(VALID_LOCAL_ROLES.includes(key as 'user' | 'admin'), true);
    }
});

// ============================================================================
// isValidLocalRole
// ============================================================================

Deno.test('isValidLocalRole - returns true for "user"', () => {
    assertEquals(isValidLocalRole('user'), true);
});

Deno.test('isValidLocalRole - returns true for "admin"', () => {
    assertEquals(isValidLocalRole('admin'), true);
});

Deno.test('isValidLocalRole - returns false for unknown role', () => {
    assertEquals(isValidLocalRole('superuser'), false);
});

Deno.test('isValidLocalRole - returns false for empty string', () => {
    assertEquals(isValidLocalRole(''), false);
});

Deno.test('isValidLocalRole - returns false for null-like string', () => {
    assertEquals(isValidLocalRole('null'), false);
});

Deno.test('isValidLocalRole - is case-sensitive', () => {
    assertEquals(isValidLocalRole('User'), false);
    assertEquals(isValidLocalRole('ADMIN'), false);
});

// ============================================================================
// tierForRole
// ============================================================================

Deno.test('tierForRole - returns Free for "user"', () => {
    assertEquals(tierForRole('user'), UserTier.Free);
});

Deno.test('tierForRole - returns Admin for "admin"', () => {
    assertEquals(tierForRole('admin'), UserTier.Admin);
});

Deno.test('tierForRole - returns Free for unknown role', () => {
    assertEquals(tierForRole('unknown-role'), UserTier.Free);
});

Deno.test('tierForRole - returns Free for empty string', () => {
    assertEquals(tierForRole(''), UserTier.Free);
});

Deno.test('tierForRole - returns Free for uppercase role (case-sensitive)', () => {
    assertEquals(tierForRole('ADMIN'), UserTier.Free);
});

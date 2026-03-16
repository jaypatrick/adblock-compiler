/**
 * Local Auth Role Registry
 *
 * Single source of truth for roles in the local JWT auth bridge.
 * Mirrors how Clerk stores roles in `publicMetadata.role`.
 *
 * ## Current roles
 * | Role    | Tier    | Self-register | Maps to Clerk        |
 * |---------|---------|---------------|----------------------|
 * | `user`  | Free    | ✅ Yes        | `org:member`         |
 * | `admin` | Admin   | ❌ No         | `org:admin`          |
 *
 * ## Adding a new role
 * Add one entry to LOCAL_ROLE_REGISTRY. Everything else (tier derivation,
 * JWT claims, DB inserts, auth provider) uses this registry automatically.
 *
 * @example Adding a "pro" role for upgraded users:
 * ```typescript
 * pro: {
 *     displayName: 'Pro',
 *     tier: UserTier.Pro,
 *     canSelfRegister: false,
 *     description: 'Upgraded user — higher rate limits and async endpoints',
 * },
 * ```
 *
 * ## Migration path to Clerk
 * Role strings here are intentionally identical to Clerk `publicMetadata.role`
 * values. When migrating, map `role` → Clerk `publicMetadata.role` and
 * `tier` → Clerk `publicMetadata.tier` for each user. No ClerkAuthProvider
 * changes needed — it already reads the same fields.
 */

import { UserTier } from '../types.ts';

// ============================================================================
// Role config shape
// ============================================================================

export interface ILocalAuthRoleConfig {
    /** Human-readable display name */
    readonly displayName: string;
    /** Rate-limit tier for this role (maps to TIER_REGISTRY) */
    readonly tier: UserTier;
    /**
     * Whether a user can self-register with this role via POST /auth/signup.
     * Privileged roles (admin) must be granted via the admin API or directly in D1.
     */
    readonly canSelfRegister: boolean;
    /** Short description */
    readonly description: string;
}

// ============================================================================
// Registry — add new roles here
// ============================================================================

export const LOCAL_ROLE_REGISTRY = {
    /**
     * Default role for all self-registered users.
     * Maps to Clerk's `org:member` / default user role.
     * Tier: Free (60 req/min).
     */
    user: {
        displayName: 'User',
        tier: UserTier.Free,
        canSelfRegister: true,
        description: 'Authenticated user — full API feature access',
    },
    /**
     * Administrator role — unrestricted access, user management.
     * Maps to Clerk's `org:admin` role.
     * Tier: Admin (unlimited req/min).
     * Must be granted via POST /admin/local-users or direct D1 update.
     */
    admin: {
        displayName: 'Admin',
        tier: UserTier.Admin,
        canSelfRegister: false,
        description: 'Administrator — unrestricted access and user management',
    },
} as const satisfies Record<string, ILocalAuthRoleConfig>;

// ============================================================================
// Derived types and helpers
// ============================================================================

export type LocalAuthRole = keyof typeof LOCAL_ROLE_REGISTRY;

/** Default role assigned to every self-registered user (mirrors Clerk's default). */
export const DEFAULT_ROLE: LocalAuthRole = 'user';

/** All valid role name strings (derived from the registry). */
export const VALID_LOCAL_ROLES = Object.keys(LOCAL_ROLE_REGISTRY) as LocalAuthRole[];

/** Type guard: checks whether a string is a valid {@link LocalAuthRole}. */
export function isValidLocalRole(value: string): value is LocalAuthRole {
    return Object.prototype.hasOwnProperty.call(LOCAL_ROLE_REGISTRY, value);
}

/**
 * Derive the {@link UserTier} for a given role.
 * Falls back to {@link UserTier.Free} for unrecognised role strings.
 *
 * Note: An admin can independently set a user's tier (e.g. tier='pro' for
 * role='user') — tier and role are separate fields, mirroring Clerk's model.
 */
export function tierForRole(role: string): UserTier {
    if (isValidLocalRole(role)) {
        return LOCAL_ROLE_REGISTRY[role].tier;
    }
    return UserTier.Free;
}

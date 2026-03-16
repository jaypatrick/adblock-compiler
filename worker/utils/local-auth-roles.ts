/**
 * Local Auth Role Registry
 *
 * Single source of truth for roles in the local JWT auth bridge.
 * Mirrors how Clerk stores roles in `publicMetadata.role`.
 *
 * ## Adding a new role
 * Add one entry to LOCAL_ROLE_REGISTRY. Everything else (tier derivation,
 * JWT claims, DB inserts, auth provider) uses this registry automatically.
 *
 * ## Migration path to Clerk
 * The role strings here are intentionally identical to Clerk publicMetadata.role
 * values. When migrating, map `role` → Clerk `publicMetadata.role` and
 * `tier` → Clerk `publicMetadata.tier` for each user. No code changes needed
 * in ClerkAuthProvider — it already reads the same fields.
 *
 * @example Adding a "moderator" role:
 * ```typescript
 * moderator: {
 *     displayName: 'Moderator',
 *     tier: UserTier.Pro,
 *     canSelfRegister: false,
 *     description: 'Content moderator — elevated feature access',
 * },
 * ```
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
     * Set false for privileged roles — those must be granted via the DB directly
     * (or a future admin endpoint).
     */
    readonly canSelfRegister: boolean;
    /** Short description of what this role allows */
    readonly description: string;
}

// ============================================================================
// Registry — add new roles here
// ============================================================================

/**
 * All valid local auth roles.
 *
 * Current roles:
 *   - **guest** — authenticated user, full feature access (read + write)
 *   - **admin** — unrestricted access + admin endpoints
 *
 * Unauthenticated requests (no JWT) are treated as anonymous / read-only
 * by the existing `requireAuth()` guards — no role entry is needed for that.
 */
export const LOCAL_ROLE_REGISTRY = {
    guest: {
        displayName: 'Guest',
        tier: UserTier.Free,
        canSelfRegister: true,
        description: 'Authenticated user — full feature access',
    },
    admin: {
        displayName: 'Admin',
        tier: UserTier.Admin,
        canSelfRegister: false,
        description: 'Administrator — unrestricted access and admin features',
    },
} as const satisfies Record<string, ILocalAuthRoleConfig>;

// ============================================================================
// Derived types and helpers
// ============================================================================

export type LocalAuthRole = keyof typeof LOCAL_ROLE_REGISTRY;

/** Default role assigned to every self-registered user. */
export const DEFAULT_ROLE: LocalAuthRole = 'guest';

/** All valid role name strings (derived from the registry). */
export const VALID_LOCAL_ROLES = Object.keys(LOCAL_ROLE_REGISTRY) as LocalAuthRole[];

/** Type guard: checks whether a string is a valid {@link LocalAuthRole}. */
export function isValidLocalRole(value: string): value is LocalAuthRole {
    return Object.prototype.hasOwnProperty.call(LOCAL_ROLE_REGISTRY, value);
}

/**
 * Derive the {@link UserTier} for a given role.
 * Falls back to {@link UserTier.Free} for unrecognised role strings
 * (defensive — the DB should only contain values from this registry).
 */
export function tierForRole(role: string): UserTier {
    if (isValidLocalRole(role)) {
        return LOCAL_ROLE_REGISTRY[role].tier;
    }
    return UserTier.Free;
}

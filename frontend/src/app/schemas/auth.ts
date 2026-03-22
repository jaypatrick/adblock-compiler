/**
 * Zod schemas for frontend authentication state.
 *
 * These schemas validate the shape of auth-related data at the trust boundary
 * (API responses) and provide TypeScript types via `z.infer<>`.
 * Used by BetterAuthService and AuthFacadeService.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Auth Provider
// ---------------------------------------------------------------------------

/** Active authentication provider identifier. */
export const AuthProviderSchema = z.enum(['better-auth']);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

// ---------------------------------------------------------------------------
// Better Auth User
// ---------------------------------------------------------------------------

/**
 * Better Auth user shape as returned by `/api/auth/get-session`.
 *
 * Mirrors the `BetterAuthUser` interface in `better-auth.service.ts`.
 * Kept in sync manually — the Zod schema is the source of truth for
 * runtime validation; the interface is the TypeScript-level contract.
 */
export const BetterAuthUserSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    tier: z.string(),
    role: z.string(),
});
export type BetterAuthUserZ = z.infer<typeof BetterAuthUserSchema>;

// ---------------------------------------------------------------------------
// Better Auth Session Response
// ---------------------------------------------------------------------------

/**
 * Response shape from `GET /api/auth/get-session`.
 *
 * The `session.token` field is populated when the Better Auth server has
 * the `bearer()` plugin enabled — used for `Authorization: Bearer <token>`
 * headers in authenticated API calls.
 */
export const BetterAuthSessionResponseSchema = z.object({
    user: BetterAuthUserSchema.optional(),
    session: z
        .object({
            token: z.string().optional(),
        })
        .optional(),
});
export type BetterAuthSessionResponse = z.infer<typeof BetterAuthSessionResponseSchema>;

// ---------------------------------------------------------------------------
// Better Auth Sign-In / Sign-Up Response
// ---------------------------------------------------------------------------

/**
 * Response shape from `POST /api/auth/sign-in/email` and
 * `POST /api/auth/sign-up/email`.
 */
export const BetterAuthSignInResponseSchema = z.object({
    user: BetterAuthUserSchema.optional(),
    token: z.string().optional(),
});
export type BetterAuthSignInResponse = z.infer<typeof BetterAuthSignInResponseSchema>;

// ---------------------------------------------------------------------------
// Aggregate Frontend Auth State
// ---------------------------------------------------------------------------

/**
 * Snapshot of the aggregate frontend auth state — useful for debugging,
 * logging, and test assertions.
 */
export const FrontendAuthStateSchema = z.object({
    provider: AuthProviderSchema.nullable(),
    isLoaded: z.boolean(),
    isSignedIn: z.boolean(),
    isAdmin: z.boolean(),
    userIdentifier: z.string().nullable(),
});
export type FrontendAuthState = z.infer<typeof FrontendAuthStateSchema>;

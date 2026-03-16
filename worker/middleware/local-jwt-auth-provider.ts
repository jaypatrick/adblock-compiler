/**
 * LocalJwtAuthProvider — temporary IAuthProvider implementation
 *
 * Drop-in replacement for ClerkAuthProvider while Clerk is not yet wired up.
 * Verifies HS256 JWTs issued by POST /auth/login and POST /auth/signup.
 *
 * ## Clerk mirror
 * `verifyToken()` returns the exact same {@link IAuthProviderResult} shape as
 * `ClerkAuthProvider.verifyToken()`, using the same tier/role resolution helpers.
 * JWT claims use the same `metadata.tier` / `metadata.role` structure as Clerk's
 * publicMetadata — no downstream code changes are needed when switching.
 *
 * ## Migration path (when Clerk is production-ready)
 * Set `CLERK_JWKS_URL` in wrangler.toml [vars] (or `.dev.vars` locally).
 * The provider selection in worker.ts auto-switches to ClerkAuthProvider.
 * This file can be deleted after migration is confirmed.
 *
 * @see worker/middleware/clerk-auth-provider.ts — the Clerk equivalent
 * @see worker/utils/local-jwt.ts               — sign/verify implementation
 * @see worker/worker.ts                         — provider selection logic
 */

import type { Env, IAuthProvider, IAuthProviderResult } from '../types.ts';
import { UserTier } from '../types.ts';
import { verifyLocalJWT } from '../utils/local-jwt.ts';

// ============================================================================
// Internal helpers (mirrors clerk-auth-provider.ts exactly)
// ============================================================================

/** Shape of the metadata object embedded in local JWTs (same as Clerk publicMetadata). */
interface LocalJWTMetadata {
    readonly tier?: UserTier;
    readonly role?: string;
}

/**
 * Resolve tier from JWT metadata.
 * Intentionally identical to `resolveTierFromMetadata` in clerk-auth-provider.ts —
 * both providers read from the same `metadata.tier` field.
 */
function resolveTier(metadata: LocalJWTMetadata | undefined): UserTier {
    if (!metadata?.tier) return UserTier.Free;
    const valid = Object.values(UserTier) as string[];
    if (!valid.includes(metadata.tier as string)) return UserTier.Free;
    return metadata.tier;
}

/**
 * Resolve role from JWT metadata.
 * Intentionally identical to `resolveRoleFromMetadata` in clerk-auth-provider.ts.
 */
function resolveRole(metadata: LocalJWTMetadata | undefined): string {
    return metadata?.role ?? 'guest';
}

/**
 * Extract a Bearer token from the Authorization header.
 * Mirrors `extractBearerToken` in clerk-jwt.ts.
 */
function extractBearerToken(request: Request): string | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
    const token = parts[1].trim();
    return token.length > 0 ? token : null;
}

// ============================================================================
// Provider
// ============================================================================

/**
 * Local HS256 JWT implementation of {@link IAuthProvider}.
 *
 * Thread-safe and stateless per request — no module-level mutable state.
 */
export class LocalJwtAuthProvider implements IAuthProvider {
    readonly name = 'local-jwt';
    readonly authMethod = 'local-jwt' as const;

    constructor(private readonly env: Env) {}

    async verifyToken(request: Request): Promise<IAuthProviderResult> {
        // 1. Guard: JWT_SECRET must be configured
        if (!this.env.JWT_SECRET) {
            return {
                valid: false,
                error: 'JWT_SECRET not configured. Add JWT_SECRET to .dev.vars (local) or run: wrangler secret put JWT_SECRET',
            };
        }

        // 2. Extract Bearer token (no cookie fallback — local auth is API-first)
        const token = extractBearerToken(request);
        if (!token) {
            // No token → signal anonymous flow (same convention as clerk-jwt.ts)
            return { valid: false };
        }

        // 3. Verify signature + expiry + issuer
        const result = await verifyLocalJWT(token, this.env.JWT_SECRET);
        if (!result.valid) {
            return { valid: false, error: result.error };
        }

        const { claims } = result;

        // 4. Resolve tier and role from metadata (same fields Clerk uses)
        const metadata = claims.metadata;
        return {
            valid: true,
            providerUserId: claims.sub, // UUID from local_auth_users.id
            tier: resolveTier(metadata),
            role: resolveRole(metadata),
            sessionId: claims.sid ?? null, // mirrors Clerk sid
        };
    }
}

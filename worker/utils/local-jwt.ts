/**
 * Local JWT Utilities — HS256 sign/verify for LocalJwtAuthProvider
 *
 * Uses `jose` (already a dependency via jsr:@panva/jose) to issue and verify
 * HS256 JWTs for the local auth bridge.
 *
 * ## Clerk mirror design
 * JWT claims intentionally mirror Clerk's structure so ClerkAuthProvider
 * can read the same fields without modification after the switch:
 *   - `sub`               → user UUID       (Clerk: user ID string)
 *   - `sid`               → session UUID    (Clerk: session ID)
 *   - `metadata.tier`     → UserTier enum   (Clerk: publicMetadata.tier)
 *   - `metadata.role`     → role string     (Clerk: publicMetadata.role)
 *
 * ## Migration path (when Clerk is production-ready)
 *   1. Set `CLERK_JWKS_URL` in wrangler.toml [vars] (or `.dev.vars` locally).
 *   2. Provider in worker.ts auto-switches to ClerkAuthProvider.
 *   3. This file is no longer called — safe to delete post-migration.
 *
 * @see worker/middleware/clerk-jwt.ts — the Clerk equivalent of this file
 */

import { SignJWT, jwtVerify } from 'jose';
import { ZodError } from 'zod';
import { LocalJWTClaimsSchema } from '../schemas.ts';
import type { LocalJWTClaims } from '../schemas.ts';
import { UserTier } from '../types.ts';

const ISSUER = 'adblock-compiler-local' as const;
const DEFAULT_EXPIRES_IN_SECONDS = 86_400; // 24 hours

// ============================================================================
// Internal helpers
// ============================================================================

/** Convert a raw secret string to the Uint8Array key form jose expects. */
function secretKey(secret: string): Uint8Array {
    return new TextEncoder().encode(secret);
}

/**
 * Returns true for JWT errors that are expected (expired, malformed, etc.)
 * Mirrors the same helper in clerk-jwt.ts.
 */
function isExpectedJwtError(message: string): boolean {
    const expected = ['exp', 'nbf', 'iat', 'JWS', 'JWK', 'alg', 'compact', 'decode', 'invalid', 'issuer', 'signature'];
    const lower = message.toLowerCase();
    return expected.some((p) => lower.includes(p.toLowerCase()));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Issue a signed HS256 JWT for a local user.
 *
 * Claims structure mirrors Clerk's JWT template:
 * ```json
 * { "sub": "<uuid>", "sid": "<uuid>", "metadata": { "tier": "free", "role": "guest" } }
 * ```
 *
 * @param sub              - User UUID (local_auth_users.id)
 * @param role             - User role string (e.g. 'user', 'admin')
 * @param tier             - User tier (derived from role registry)
 * @param secret           - Raw JWT_SECRET string from env
 * @param expiresInSeconds - Token lifetime (default 86400 / 24h)
 */
export async function signLocalJWT(
    sub: string,
    role: string,
    tier: UserTier,
    secret: string,
    expiresInSeconds: number = DEFAULT_EXPIRES_IN_SECONDS,
): Promise<string> {
    const sid = crypto.randomUUID(); // one UUID session per token — mirrors Clerk sid
    return await new SignJWT({
        sid,
        metadata: { tier, role },
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
        .sign(secretKey(secret));
}

/**
 * Verify a HS256 JWT and return Zod-parsed {@link LocalJWTClaims}.
 *
 * Never throws — returns `{ valid: false, error }` on every failure so callers
 * can safely branch without try/catch.
 *
 * @param token  - Compact JWT string
 * @param secret - Raw JWT_SECRET string from env
 */
export async function verifyLocalJWT(
    token: string,
    secret: string,
): Promise<{ valid: true; claims: LocalJWTClaims } | { valid: false; error: string }> {
    try {
        const { payload } = await jwtVerify(token, secretKey(secret), {
            algorithms: ['HS256'],
            issuer: ISSUER,
            clockTolerance: 5, // 5s clock skew — matches clerk-jwt.ts
        });

        let claims: LocalJWTClaims;
        try {
            claims = LocalJWTClaimsSchema.parse(payload);
        } catch (err) {
            if (err instanceof ZodError) {
                return { valid: false, error: 'Invalid JWT claims structure' };
            }
            throw err;
        }

        return { valid: true, claims };
    } catch (error) {
        if (error instanceof ZodError) {
            return { valid: false, error: 'Invalid JWT claims structure' };
        }
        const message = error instanceof Error ? error.message : String(error);
        if (isExpectedJwtError(message)) {
            return { valid: false, error: `JWT verification failed: ${message}` };
        }
        // deno-lint-ignore no-console
        console.error('[local-jwt] Unexpected verification error:', message);
        return { valid: false, error: 'JWT verification failed' };
    }
}

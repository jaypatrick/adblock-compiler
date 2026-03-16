/**
 * Local JWT Utilities — HS256 sign/verify for LocalJwtAuthProvider
 *
 * Uses `jose` (already a dependency via jsr:@panva/jose) to issue and verify
 * HS256 JWTs for the local auth bridge. The API mirrors the patterns used in
 * `clerk-jwt.ts` so that switching back to Clerk is a one-line change.
 *
 * MIGRATION PATH (when Clerk is production-ready):
 *   1. Set `CLERK_JWKS_URL` in wrangler.toml [vars] (or `.dev.vars` locally)
 *   2. The provider in worker.ts auto-switches — this file is no longer called
 *   3. Optionally remove LocalJwtAuthProvider and this file post-migration
 *
 * Security properties:
 *   - Algorithm: HS256 (HMAC-SHA256)
 *   - Issuer:    'adblock-compiler-local' (validated on verify)
 *   - Expiry:    24h default (configurable per call)
 *   - Clock tolerance: 5s (matching the Clerk verifier in clerk-jwt.ts)
 *   - Claims are Zod-parsed before returning to ensure shape integrity
 */

import { SignJWT, jwtVerify } from 'jose';
import { ZodError } from 'zod';
import { LocalJWTClaimsSchema } from '../schemas.ts';
import type { LocalJWTClaims } from '../schemas.ts';

const ISSUER = 'adblock-compiler-local' as const;
const DEFAULT_EXPIRES_IN_SECONDS = 86_400; // 24 hours

// ============================================================================
// Helpers
// ============================================================================

/** Convert a raw secret string to the Uint8Array key form jose expects. */
function secretKey(secret: string): Uint8Array {
    return new TextEncoder().encode(secret);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Issue a signed HS256 JWT for a local user.
 *
 * @param payload          - User claims (sub, email, tier, role)
 * @param secret           - Raw JWT_SECRET string from env
 * @param expiresInSeconds - Token lifetime in seconds (default: 86400 / 24h)
 * @returns Compact serialised JWT string
 */
export async function signLocalJWT(
    payload: Omit<LocalJWTClaims, 'iss' | 'iat' | 'exp'>,
    secret: string,
    expiresInSeconds: number = DEFAULT_EXPIRES_IN_SECONDS,
): Promise<string> {
    return await new SignJWT({
        sub: payload.sub,
        email: payload.email,
        tier: payload.tier,
        role: payload.role,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
        .sign(secretKey(secret));
}

/**
 * Verify a HS256 JWT and return Zod-parsed {@link LocalJWTClaims}.
 *
 * Never throws — returns `{ valid: false, error }` for every failure mode so
 * callers can safely branch without try/catch.
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
            // 5-second clock tolerance — matches clerk-jwt.ts
            clockTolerance: 5,
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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true for JWT errors that are expected (expired, malformed, etc.)
 * as opposed to unexpected infrastructure failures.
 * Mirrors the same helper in clerk-jwt.ts.
 */
function isExpectedJwtError(message: string): boolean {
    const expectedPatterns = [
        'exp',
        'nbf',
        'iat',
        'JWS',
        'JWK',
        'alg',
        'compact',
        'decode',
        'invalid',
        'issuer',
        'signature',
    ];
    const lower = message.toLowerCase();
    return expectedPatterns.some((p) => lower.includes(p.toLowerCase()));
}

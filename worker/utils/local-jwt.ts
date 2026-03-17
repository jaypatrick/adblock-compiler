/**
 * Local JWT Utilities — HS256 sign/verify using Deno native crypto.subtle
 *
 * Implements compact JWT (JWS) signing and verification with HMAC-SHA256
 * using only the Web Crypto API built into the Deno/Cloudflare Workers
 * runtime. No external dependencies required.
 *
 * ## Why native crypto instead of jose?
 * HS256 with a shared secret is straightforward Web Crypto — no JWKS
 * fetching, no RSA key handling, no remote I/O. Using crypto.subtle
 * keeps this bridge completely self-contained and dependency-free.
 * The `jose` library remains in the project only for the Clerk RS256 path
 * (`clerk-jwt.ts` uses JWKS + createRemoteJWKSet which genuinely needs it).
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
 * @see worker/middleware/clerk-jwt.ts — the Clerk equivalent (uses jose for JWKS)
 */

import { ZodError } from 'zod';
import { type LocalJWTClaims, LocalJWTClaimsSchema } from '../schemas.ts';
import { UserTier } from '../types.ts';

const ISSUER = 'adblock-compiler-local' as const;
const ALGORITHM = 'HS256' as const;
const DEFAULT_EXPIRES_IN_SECONDS = 3_600; // 1 hour
const CLOCK_TOLERANCE_SECONDS = 5; // matches clerk-jwt.ts

// ============================================================================
// Base64url helpers (no external deps — pure string manipulation)
// ============================================================================

/** Encode a Uint8Array to a base64url string (no padding). */
function base64urlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encode a plain string as base64url UTF-8 bytes. */
function base64urlEncodeString(str: string): string {
    return base64urlEncode(new TextEncoder().encode(str));
}

/** Decode a base64url string to a Uint8Array. */
function base64urlDecode(b64url: string): Uint8Array<ArrayBuffer> {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Decode a base64url segment to a plain UTF-8 string. */
function base64urlDecodeString(b64url: string): string {
    return new TextDecoder().decode(base64urlDecode(b64url));
}

// ============================================================================
// HMAC-SHA256 helpers
// ============================================================================

/** Import a raw secret as an HMAC-SHA256 CryptoKey. */
async function importHmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        [usage],
    );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Issue a signed HS256 JWT for a local user.
 *
 * Claims structure mirrors Clerk's JWT template so ClerkAuthProvider works
 * unchanged after the provider swap:
 * ```json
 * { "sub": "<uuid>", "sid": "<uuid>", "iss": "adblock-compiler-local",
 *   "iat": 1234567890, "exp": 1234654290,
 *   "metadata": { "tier": "free", "role": "user" } }
 * ```
 *
 * @param sub              - User UUID (local_auth_users.id)
 * @param role             - User role string (e.g. 'user', 'admin')
 * @param tier             - User tier (derived from role registry)
 * @param secret           - Raw JWT_SECRET string from env
 * @param expiresInSeconds - Token lifetime (default 3600 / 1h)
 */
export async function signLocalJWT(
    sub: string,
    role: string,
    tier: UserTier,
    secret: string,
    expiresInSeconds: number = DEFAULT_EXPIRES_IN_SECONDS,
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const sid = crypto.randomUUID(); // one session UUID per token — mirrors Clerk sid

    const header = { alg: ALGORITHM, typ: 'JWT' };
    const payload = {
        sub,
        sid,
        iss: ISSUER,
        iat: now,
        exp: now + expiresInSeconds,
        metadata: { tier, role },
    };

    const encodedHeader = base64urlEncodeString(JSON.stringify(header));
    const encodedPayload = base64urlEncodeString(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await importHmacKey(secret, 'sign');
    const signatureBytes = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(signingInput),
    );

    return `${signingInput}.${base64urlEncode(new Uint8Array(signatureBytes))}`;
}

/**
 * Verify a HS256 JWT and return Zod-parsed {@link LocalJWTClaims}.
 *
 * Validates: signature, algorithm, issuer, expiry (with clock tolerance).
 * Never throws — returns `{ valid: false, error }` on every failure so
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
        // 1. Split token into three parts
        const parts = token.split('.');
        if (parts.length !== 3) {
            return { valid: false, error: 'JWT verification failed: malformed token' };
        }
        const [encodedHeader, encodedPayload, encodedSignature] = parts;

        // 2. Decode + validate header
        let header: Record<string, unknown>;
        try {
            header = JSON.parse(base64urlDecodeString(encodedHeader));
        } catch {
            return { valid: false, error: 'JWT verification failed: invalid header' };
        }
        if (header.alg !== ALGORITHM) {
            return { valid: false, error: `JWT verification failed: unexpected algorithm ${String(header.alg)}` };
        }

        // 3. Verify HMAC-SHA256 signature
        const signingInput = `${encodedHeader}.${encodedPayload}`;
        const key = await importHmacKey(secret, 'verify');
        let signatureValid: boolean;
        try {
            signatureValid = await crypto.subtle.verify(
                'HMAC',
                key,
                base64urlDecode(encodedSignature),
                new TextEncoder().encode(signingInput),
            );
        } catch {
            return { valid: false, error: 'JWT verification failed: signature error' };
        }
        if (!signatureValid) {
            return { valid: false, error: 'JWT verification failed: invalid signature' };
        }

        // 4. Decode payload
        let rawPayload: Record<string, unknown>;
        try {
            rawPayload = JSON.parse(base64urlDecodeString(encodedPayload));
        } catch {
            return { valid: false, error: 'JWT verification failed: invalid payload' };
        }

        // 5. Validate standard claims
        const now = Math.floor(Date.now() / 1000);
        const exp = rawPayload.exp;
        const iat = rawPayload.iat;
        if (typeof exp === 'number' && now > exp + CLOCK_TOLERANCE_SECONDS) {
            return { valid: false, error: 'JWT verification failed: token expired' };
        }
        if (typeof iat === 'number' && iat > now + CLOCK_TOLERANCE_SECONDS) {
            return { valid: false, error: 'JWT verification failed: token not yet valid' };
        }
        if (rawPayload.iss !== ISSUER) {
            return { valid: false, error: 'JWT verification failed: invalid issuer' };
        }

        // 6. Zod-parse claims
        let claims: LocalJWTClaims;
        try {
            claims = LocalJWTClaimsSchema.parse(rawPayload);
        } catch (err) {
            if (err instanceof ZodError) {
                return { valid: false, error: 'Invalid JWT claims structure' };
            }
            throw err;
        }

        return { valid: true, claims };
    } catch (error) {
        // deno-lint-ignore no-console
        console.error('[local-jwt] Unexpected verification error:', error instanceof Error ? error.message : String(error));
        return { valid: false, error: 'JWT verification failed' };
    }
}

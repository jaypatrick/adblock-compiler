/**
 * PBKDF2 Password Hashing Utilities
 *
 * Uses `SubtleCrypto` (available in the Cloudflare Workers runtime) to derive
 * password hashes. Argon2id is not available in Workers; PBKDF2 with 100,000
 * iterations and SHA-256 is the recommended alternative.
 *
 * Storage format: `<base64url-salt>:<base64url-derived-bits>`
 *   - Salt: 16 random bytes (128 bits)
 *   - Derived key: 32 bytes (256 bits)
 *   - Iterations: 100,000 (NIST SP 800-132 minimum)
 *   - Hash: SHA-256
 *
 * Comparison: constant-time byte-by-byte XOR (no short-circuit) to prevent
 * timing-based user enumeration.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const KEY_BYTES = KEY_BITS / 8;

// ============================================================================
// Encoding helpers
// ============================================================================

/** Encode a Uint8Array to a base64url string (no padding). */
function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url string to a Uint8Array. */
function fromBase64Url(b64url: string): Uint8Array<ArrayBuffer> {
    // Restore standard base64 padding
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ============================================================================
// Core derivation
// ============================================================================

/**
 * Derive PBKDF2 key material from a password and salt.
 * Returns raw bytes (KEY_BYTES length).
 */
async function pbkdf2Derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
    const subtle = crypto.subtle;
    const enc = new TextEncoder();

    const baseKey = await subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits'],
    );

    const derivedBits = await subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        baseKey,
        KEY_BITS,
    );

    return new Uint8Array(derivedBits);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Hash a plaintext password using PBKDF2-SHA256.
 *
 * @param password - Plaintext password (UTF-8)
 * @returns Encoded hash string `<base64url-salt>:<base64url-hash>`
 *
 * @example
 * ```typescript
 * const hash = await hashPassword('correct-horse-battery-staple');
 * // "abc123...:xyz789..."
 * ```
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const derived = await pbkdf2Derive(password, salt);
    return `${toBase64Url(salt)}:${toBase64Url(derived)}`;
}

/**
 * Verify a plaintext password against a stored PBKDF2 hash.
 *
 * Uses a constant-time byte-by-byte comparison (XOR accumulator) to prevent
 * timing-based user enumeration attacks — comparison always runs to completion.
 *
 * Returns `false` (never throws) on any format or derivation error, so callers
 * can safely use the result in a branch without leaking timing information.
 *
 * @param password - Plaintext password candidate
 * @param stored   - Stored hash string in `<salt>:<hash>` format
 * @returns `true` if the password matches, `false` otherwise
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    try {
        const colonIdx = stored.indexOf(':');
        if (colonIdx < 1) return false;

        const salt = fromBase64Url(stored.slice(0, colonIdx));
        const expected = fromBase64Url(stored.slice(colonIdx + 1));

        if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) {
            return false;
        }

        const derived = await pbkdf2Derive(password, salt);

        if (derived.length !== expected.length) return false;

        // Constant-time comparison: XOR all bytes and accumulate differences.
        // Never short-circuits — every byte is always compared.
        let diff = 0;
        for (let i = 0; i < derived.length; i++) {
            diff |= derived[i] ^ expected[i];
        }

        return diff === 0;
    } catch {
        return false;
    }
}

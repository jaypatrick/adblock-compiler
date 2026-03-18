/**
 * Tests for clerk-jwt.ts — Clerk JWT verification middleware.
 *
 * Covers:
 *   - No CLERK_JWKS_URL configured → valid: false (no error, anonymous OK)
 *   - No Authorization header and no __session cookie → valid: false
 *   - Bearer token present but malformed (invalid JWT) → valid: false, error set
 *   - __session cookie present but malformed → valid: false, error set
 *   - Bearer token is well-formed JWT but verification fails → valid: false, error set
 *   - Bearer overrides __session cookie when both present
 *
 * All tests that configure CLERK_JWKS_URL are serialised inside a single
 * Deno.test with t.step() and stub globalThis.fetch to return an empty JWKS.
 * This prevents the jose JWKS resolver from making real network requests for
 * tokens with structurally valid headers (e.g. base64-decodable alg/kid fields)
 * and eliminates fetch-patch races when tests run concurrently.
 */

import { assertEquals, assertExists } from '@std/assert';
import type { Env } from '../types.ts';
import { verifyClerkJWT } from './clerk-jwt.ts';

// ============================================================================
// Helpers
// ============================================================================

function makeEnv(overrides: Partial<Env> = {}): Env {
    return overrides as unknown as Env;
}

function makeRequest(options: {
    bearerToken?: string;
    sessionCookie?: string;
    origin?: string;
} = {}): Request {
    const headers: Record<string, string> = {};
    if (options.bearerToken) {
        headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.sessionCookie) {
        headers['Cookie'] = `__session=${options.sessionCookie}`;
    }
    if (options.origin) {
        headers['Origin'] = options.origin;
    }
    return new Request('https://api.example.com/compile', { headers });
}

// ============================================================================
// No CLERK_JWKS_URL configured
// ============================================================================

Deno.test('verifyClerkJWT - returns valid:false when CLERK_JWKS_URL is not configured', async () => {
    const env = makeEnv({}); // no CLERK_JWKS_URL
    const req = makeRequest({ bearerToken: 'some.token.here' });

    const result = await verifyClerkJWT(req, env);
    assertEquals(result.valid, false);
    // No error message — this is the normal "Clerk not configured" path
    assertEquals('error' in result ? result.error : undefined, undefined);
});

// ============================================================================
// Tests with CLERK_JWKS_URL configured
//
// Grouped into a single Deno.test with t.step() so steps run serially.
// globalThis.fetch is stubbed for the entire group to return an empty JWKS
// (`{ keys: [] }`).  This ensures:
//   1. Tests that hit the jose JWKS resolution path (structurally valid tokens)
//      never make real network calls.
//   2. The fetch stub cannot race with other parallel Deno.test blocks.
//   3. jose throws "No applicable keys found" (matches 'JWK' error pattern) for
//      any token that gets past the format validation stage, so all assertions
//      about `valid: false` and `error` remain correct.
// ============================================================================

Deno.test('verifyClerkJWT with CLERK_JWKS_URL configured (fetch-serialized)', async (t) => {
    const originalFetch = globalThis.fetch;
    // Stub fetch to return an empty JWKS — prevents any real network call from jose
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async () =>
        new Response(JSON.stringify({ keys: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    try {
        // No token in request
        await t.step('returns valid:false when no Authorization header and no cookie', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            const req = makeRequest(); // no bearer, no cookie

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
            assertEquals('error' in result ? result.error : undefined, undefined);
        });

        await t.step('returns valid:false when Authorization header is malformed (no Bearer prefix)', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            const req = new Request('https://api.example.com/', {
                headers: { Authorization: 'Token some.token.value' },
            });

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
        });

        await t.step('returns valid:false when Authorization header has empty token', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            const req = new Request('https://api.example.com/', {
                headers: { Authorization: 'Bearer ' },
            });

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
        });

        // Malformed/invalid JWT with JWKS URL configured
        await t.step('returns valid:false with error when Bearer token is not a valid JWT', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            const req = makeRequest({ bearerToken: 'not-a-jwt-at-all' });

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
            // Jose will throw a parsing/decoding error that maps to an error message
            assertExists('error' in result ? result.error : undefined);
        });

        await t.step('returns valid:false with error when JWT has wrong number of parts', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            // Two parts (header.payload) — missing signature
            const req = makeRequest({ bearerToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9' });

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
            assertExists('error' in result ? result.error : undefined);
        });

        await t.step('returns valid:false with error when __session cookie has invalid JWT', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            const req = makeRequest({ sessionCookie: 'invalid.cookie.value' });

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
            assertExists('error' in result ? result.error : undefined);
        });

        // Cookie extraction edge cases
        await t.step('prefers Bearer token over __session cookie', async () => {
            // Both are provided; the Bearer token path should be tried first.
            // With a configured JWKS URL and invalid tokens, both will fail but the
            // error message from Bearer processing applies.
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            const req = new Request('https://api.example.com/', {
                headers: {
                    Authorization: 'Bearer bearer.token.value',
                    Cookie: '__session=cookie.token.value; other=something',
                },
            });

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
            // Both are invalid JWTs; the important thing is verification ran (no exception)
            assertExists('error' in result ? result.error : undefined);
        });

        await t.step('returns valid:false when Cookie header has no __session cookie', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            const req = new Request('https://api.example.com/', {
                headers: { Cookie: 'session_id=abc; other=value' }, // no __session
            });

            const result = await verifyClerkJWT(req, env);
            assertEquals(result.valid, false);
            assertEquals('error' in result ? result.error : undefined, undefined);
        });

        await t.step('handles __session cookie with equals sign in value', async () => {
            const env = makeEnv({ CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json' });
            // JWT tokens often end with base64 padding (=); this has a valid RS256 header
            // and will reach the JWKS resolution stage — the empty-JWKS stub causes jose to
            // throw "No applicable keys found", which maps to valid:false + error.
            const req = new Request('https://api.example.com/', {
                headers: { Cookie: '__session=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig==' },
            });

            const result = await verifyClerkJWT(req, env);
            // Should attempt verification (not return empty-token path)
            assertEquals(result.valid, false);
            // An error is set because jose tried to verify the (invalid/no-key) token
            assertExists('error' in result ? result.error : undefined);
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

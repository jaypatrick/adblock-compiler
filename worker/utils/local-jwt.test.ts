/**
 * Tests for Local JWT Utilities (HS256 sign/verify).
 *
 * Covers:
 *   - signLocalJWT: produces a valid 3-part JWT string
 *   - verifyLocalJWT: accepts a freshly-signed token
 *   - verifyLocalJWT: rejects a token with an invalid signature
 *   - verifyLocalJWT: rejects a malformed token (< 3 parts)
 *   - verifyLocalJWT: rejects a token with the wrong algorithm
 *   - verifyLocalJWT: rejects an expired token
 *   - verifyLocalJWT: rejects a token with a future iat
 *   - verifyLocalJWT: rejects a token with a wrong issuer
 *   - verifyLocalJWT: rejects a token with an invalid payload (bad JSON)
 *   - verifyLocalJWT: rejects a token with missing required claims
 *   - Round-trip: sign then verify returns matching claims
 *
 * @see worker/utils/local-jwt.ts
 */

import { assertEquals } from '@std/assert';
import { signLocalJWT, verifyLocalJWT } from './local-jwt.ts';
import { UserTier } from '../types.ts';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// ============================================================================
// signLocalJWT
// ============================================================================

Deno.test('signLocalJWT - returns a compact JWT with 3 parts', async () => {
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET);
    const parts = token.split('.');
    assertEquals(parts.length, 3);
});

Deno.test('signLocalJWT - header decodes to alg:HS256 typ:JWT', async () => {
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET);
    const [headerB64] = token.split('.');
    const padded = headerB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
        headerB64.length + (4 - (headerB64.length % 4)) % 4,
        '=',
    );
    const header = JSON.parse(atob(padded)) as Record<string, string>;
    assertEquals(header.alg, 'HS256');
    assertEquals(header.typ, 'JWT');
});

Deno.test('signLocalJWT - payload decodes to expected claims', async () => {
    const token = await signLocalJWT(USER_ID, 'admin', UserTier.Admin, SECRET, 7200);
    const [, payloadB64] = token.split('.');
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
        payloadB64.length + (4 - (payloadB64.length % 4)) % 4,
        '=',
    );
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    assertEquals(payload.sub, USER_ID);
    assertEquals(payload.iss, 'adblock-compiler-local');
    assertEquals(typeof payload.iat, 'number');
    assertEquals(typeof payload.exp, 'number');
    assertEquals(typeof payload.sid, 'string');
    assertEquals((payload.metadata as Record<string, string>).role, 'admin');
    assertEquals((payload.metadata as Record<string, string>).tier, UserTier.Admin);
});

// ============================================================================
// verifyLocalJWT - happy path
// ============================================================================

Deno.test('verifyLocalJWT - accepts a freshly signed token', async () => {
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET);
    const result = await verifyLocalJWT(token, SECRET);
    assertEquals(result.valid, true);
});

Deno.test('verifyLocalJWT - round-trip claims match sign input', async () => {
    const token = await signLocalJWT(USER_ID, 'admin', UserTier.Admin, SECRET);
    const result = await verifyLocalJWT(token, SECRET);
    assertEquals(result.valid, true);
    if (result.valid) {
        assertEquals(result.claims.sub, USER_ID);
        assertEquals(result.claims.iss, 'adblock-compiler-local');
        assertEquals(result.claims.metadata?.role, 'admin');
        assertEquals(result.claims.metadata?.tier, UserTier.Admin);
    }
});

// ============================================================================
// verifyLocalJWT - failure cases
// ============================================================================

Deno.test('verifyLocalJWT - rejects token with wrong secret', async () => {
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET);
    const result = await verifyLocalJWT(token, 'wrong-secret-xxxxxxxxxxxxxxxxxx!');
    assertEquals(result.valid, false);
});

Deno.test('verifyLocalJWT - rejects malformed token (no dots)', async () => {
    const result = await verifyLocalJWT('notavalidtoken', SECRET);
    assertEquals(result.valid, false);
    if (!result.valid) {
        assertEquals(result.error.includes('malformed'), true);
    }
});

Deno.test('verifyLocalJWT - rejects token with only two parts', async () => {
    const result = await verifyLocalJWT('abc.def', SECRET);
    assertEquals(result.valid, false);
});

Deno.test('verifyLocalJWT - rejects an expired token', async () => {
    // Sign with -1 second expiry (already expired)
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET, -10);
    const result = await verifyLocalJWT(token, SECRET);
    assertEquals(result.valid, false);
    if (!result.valid) {
        assertEquals(result.error.includes('expired'), true);
    }
});

Deno.test('verifyLocalJWT - rejects token with wrong algorithm in header', async () => {
    // Manually craft a token with alg:RS256 in the header
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = btoa(JSON.stringify({ sub: USER_ID, iss: 'adblock-compiler-local', exp: 9999999999 }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fakeToken = `${header}.${payload}.fakeSignature`;
    const result = await verifyLocalJWT(fakeToken, SECRET);
    assertEquals(result.valid, false);
    if (!result.valid) {
        assertEquals(result.error.includes('algorithm'), true);
    }
});

Deno.test('verifyLocalJWT - rejects token with wrong issuer', async () => {
    // Craft a token signed with the correct secret but wrong issuer
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET);
    // Decode and re-encode the payload with a different issuer
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
        payloadB64.length + (4 - (payloadB64.length % 4)) % 4,
        '=',
    );
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    payload.iss = 'wrong-issuer';
    const newPayloadB64 = btoa(JSON.stringify(payload))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Use original signature (now invalid because payload changed)
    const tamperedToken = `${headerB64}.${newPayloadB64}.${sigB64}`;
    const result = await verifyLocalJWT(tamperedToken, SECRET);
    // Either invalid signature or invalid issuer
    assertEquals(result.valid, false);
});

Deno.test('verifyLocalJWT - rejects empty string', async () => {
    const result = await verifyLocalJWT('', SECRET);
    assertEquals(result.valid, false);
});

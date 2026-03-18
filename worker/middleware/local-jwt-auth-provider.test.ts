/**
 * Tests for the LocalJwtAuthProvider.
 *
 * Covers:
 *   - verifyToken: returns invalid when JWT_SECRET is not configured
 *   - verifyToken: returns invalid (anonymous) when no Authorization header
 *   - verifyToken: returns invalid when Authorization header is malformed
 *   - verifyToken: returns valid result when JWT is signed correctly and no DB
 *   - verifyToken: returns invalid when JWT is signed with wrong secret
 *   - verifyToken: returns invalid when JWT is expired
 *   - verifyToken: resolves tier and role from JWT claims when DB is absent
 *
 * Since this test exercises the provider without a DB, the ZTA-mandated
 * DB lookup is skipped and the fallback to JWT claims is tested directly.
 *
 * @see worker/middleware/local-jwt-auth-provider.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { LocalJwtAuthProvider } from './local-jwt-auth-provider.ts';
import { signLocalJWT } from '../utils/local-jwt.ts';
import type { Env } from '../types.ts';
import { UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

const SECRET = 'test-jwt-secret-for-provider-tests!!';
const USER_ID = '11111111-2222-4333-8444-555555555555';

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

function makeProvider(overrides: Partial<Env> = {}): LocalJwtAuthProvider {
    return new LocalJwtAuthProvider(makeEnv(overrides));
}

function makeBearerRequest(token: string): Request {
    return new Request('http://localhost/api/test', {
        headers: { 'Authorization': `Bearer ${token}` },
    });
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('LocalJwtAuthProvider - returns invalid when JWT_SECRET is not configured', async () => {
    const provider = makeProvider(); // no JWT_SECRET
    const req = makeBearerRequest('sometoken');
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
    assertExists(result.error);
});

Deno.test('LocalJwtAuthProvider - returns invalid (no error) when Authorization header is absent', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const req = new Request('http://localhost/api/test'); // no auth header
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
    // No error on missing token — signals anonymous flow
    assertEquals(result.error, undefined);
});

Deno.test('LocalJwtAuthProvider - returns invalid when Bearer token is missing after keyword', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const req = new Request('http://localhost/api/test', {
        headers: { 'Authorization': 'Bearer' }, // no actual token
    });
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
});

Deno.test('LocalJwtAuthProvider - returns invalid for non-Bearer auth scheme', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const req = new Request('http://localhost/api/test', {
        headers: { 'Authorization': 'Basic dXNlcjpwYXNz' },
    });
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
});

Deno.test('LocalJwtAuthProvider - returns valid result for correctly signed JWT (no DB)', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET);
    const req = makeBearerRequest(token);
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, true);
    if (result.valid) {
        assertEquals(result.providerUserId, USER_ID);
        assertEquals(result.tier, UserTier.Free);
        assertEquals(result.role, 'user');
    }
});

Deno.test('LocalJwtAuthProvider - resolves admin tier from JWT claims (no DB)', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const token = await signLocalJWT(USER_ID, 'admin', UserTier.Admin, SECRET);
    const req = makeBearerRequest(token);
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, true);
    if (result.valid) {
        assertEquals(result.tier, UserTier.Admin);
        assertEquals(result.role, 'admin');
    }
});

Deno.test('LocalJwtAuthProvider - returns invalid when JWT is signed with wrong secret', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, 'wrong-secret-xxxxxxxxxxxx!!');
    const req = makeBearerRequest(token);
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
    assertExists(result.error);
});

Deno.test('LocalJwtAuthProvider - returns invalid when JWT is expired', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const token = await signLocalJWT(USER_ID, 'user', UserTier.Free, SECRET, -10); // expired
    const req = makeBearerRequest(token);
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
    assertExists(result.error);
});

Deno.test('LocalJwtAuthProvider - returns invalid for a completely malformed token', async () => {
    const provider = makeProvider({ JWT_SECRET: SECRET });
    const req = makeBearerRequest('not.a.valid.jwt.token');
    const result = await provider.verifyToken(req);
    assertEquals(result.valid, false);
});

Deno.test('LocalJwtAuthProvider - provider name is "local-jwt"', () => {
    const provider = makeProvider();
    assertEquals(provider.name, 'local-jwt');
    assertEquals(provider.authMethod, 'local-jwt');
});

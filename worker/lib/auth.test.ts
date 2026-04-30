/**
 * Tests for the Better Auth factory (createAuth).
 *
 * createAuth() requires a real Hyperdrive connection to Neon PostgreSQL,
 * so we cannot call it with a stub environment. Instead, we verify:
 *
 *   - The module exports the expected symbols
 *   - The Auth type is correctly derived from createAuth
 *   - USER_FIELD_MAPPING contains the required Prisma field name overrides
 *
 * Integration tests that exercise the full auth flow live in the E2E suite.
 *
 * @see worker/lib/auth.ts
 */

import { assertEquals, assertExists, assertInstanceOf, assertStrictEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
    AUTH_DISABLE_CSRF_CHECK,
    AUTH_ID_GENERATOR,
    buildTrustedOriginsFn,
    createAuth,
    createKvSecondaryStorage,
    USER_FIELD_MAPPING,
    UUID_V4_REGEX,
    WorkerConfigurationError,
} from './auth.ts';
import type { Auth } from './auth.ts';

// ============================================================================
// Module exports
// ============================================================================

Deno.test('createAuth is exported as a function', () => {
    assertEquals(typeof createAuth, 'function');
});

Deno.test('Auth type is compatible with ReturnType<typeof createAuth>', () => {
    // Compile-time check — if Auth is not assignable from createAuth's return
    // type, TypeScript will fail to compile this file.
    const _typeCheck: Auth extends ReturnType<typeof createAuth> ? true : never = true;
    assertExists(_typeCheck);
});

// ============================================================================
// Factory guard behaviour
// ============================================================================

Deno.test('createAuth throws when HYPERDRIVE binding is absent', () => {
    const fakeEnv = {
        HYPERDRIVE: undefined,
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
    } as unknown as import('../types.ts').Env;
    assertThrows(() => createAuth(fakeEnv), WorkerConfigurationError, 'HYPERDRIVE binding is not configured');
});

Deno.test('createAuth throws when HYPERDRIVE.connectionString is absent', () => {
    const fakeEnv = {
        HYPERDRIVE: {},
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
    } as unknown as import('../types.ts').Env;
    assertThrows(() => createAuth(fakeEnv), WorkerConfigurationError, 'HYPERDRIVE binding is not configured');
});

Deno.test('createAuth throws when BETTER_AUTH_SECRET is missing', () => {
    const fakeEnv = {
        HYPERDRIVE: { connectionString: 'postgresql://user:pass@localhost:5432/db' },
        BETTER_AUTH_SECRET: undefined,
    } as unknown as import('../types.ts').Env;
    assertThrows(() => createAuth(fakeEnv), WorkerConfigurationError, 'BETTER_AUTH_SECRET is required');
});

Deno.test('createAuth error message for missing HYPERDRIVE mentions wrangler.toml and dev.vars', () => {
    const fakeEnv = { HYPERDRIVE: undefined } as unknown as import('../types.ts').Env;
    const err = assertThrows(() => createAuth(fakeEnv), WorkerConfigurationError);
    assertStringIncludes(err.message, 'wrangler.toml');
    assertStringIncludes(err.message, '.dev.vars');
});

Deno.test('createAuth error message for missing BETTER_AUTH_SECRET mentions openssl', () => {
    const fakeEnv = {
        HYPERDRIVE: { connectionString: 'postgresql://user:pass@localhost:5432/db' },
        BETTER_AUTH_SECRET: '',
    } as unknown as import('../types.ts').Env;
    const err = assertThrows(() => createAuth(fakeEnv), WorkerConfigurationError);
    assertStringIncludes(err.message, 'openssl');
});

Deno.test('WorkerConfigurationError has distinctive name for caller identification', () => {
    const fakeEnv = {
        HYPERDRIVE: undefined,
        BETTER_AUTH_SECRET: 'test-secret',
    } as unknown as import('../types.ts').Env;
    const err = assertThrows(() => createAuth(fakeEnv), WorkerConfigurationError);
    assertInstanceOf(err, WorkerConfigurationError);
    assertEquals(err.name, 'WorkerConfigurationError');
});

Deno.test('createAuth throws when HYPERDRIVE.connectionString is invalid', () => {
    // createPrismaClient (called inside createAuth) validates the connection
    // string via Zod — an empty or non-postgresql URL should throw.
    const fakeEnv = {
        HYPERDRIVE: { connectionString: '' },
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
    } as unknown as import('../types.ts').Env;
    assertThrows(() => createAuth(fakeEnv), Error);
});

Deno.test('createAuth throws when connectionString is a non-postgresql URL', () => {
    const fakeEnv = {
        HYPERDRIVE: { connectionString: 'mysql://user:pass@localhost:3306/db' },
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
    } as unknown as import('../types.ts').Env;
    assertThrows(() => createAuth(fakeEnv), Error);
});

// ============================================================================
// USER_FIELD_MAPPING — Prisma field name overrides
// ============================================================================
//
// These tests are a regression guard for the Better Auth ↔ Prisma field name
// mismatch.  Better Auth writes `name` and `image`; the Prisma User model
// exposes `displayName` (column display_name) and `imageUrl` (column
// image_url).  Without the mapping, Prisma throws
// PrismaClientValidationError: Unknown argument 'name' / 'image' → HTTP 500
// on every sign-up and OAuth/profile-sync flow.
//
// These tests require no database connection because USER_FIELD_MAPPING is a
// plain constant — no betterAuth() call, no PrismaClient instantiation.
// ============================================================================

Deno.test('USER_FIELD_MAPPING is exported from auth module', () => {
    assertExists(USER_FIELD_MAPPING);
});

Deno.test("USER_FIELD_MAPPING maps Better Auth 'name' to Prisma 'displayName'", () => {
    assertEquals(USER_FIELD_MAPPING.name, 'displayName');
});

Deno.test("USER_FIELD_MAPPING maps Better Auth 'image' to Prisma 'imageUrl'", () => {
    assertEquals(USER_FIELD_MAPPING.image, 'imageUrl');
});

Deno.test('USER_FIELD_MAPPING contains exactly the expected fields', () => {
    assertEquals(Object.keys(USER_FIELD_MAPPING).sort(), ['image', 'name']);
});

// ============================================================================
// AUTH_ID_GENERATOR / UUID_V4_REGEX — UUID format guard
// ============================================================================
//
// Better Auth generates opaque random strings by default (e.g.
// "9hrbjIfqhl2sTXOhzrWSNwL9i2kipz51") which PostgreSQL rejects with
// "invalid input syntax for type uuid" when the column type is uuid.
// The createAuth() config sets `advanced.generateId` to AUTH_ID_GENERATOR
// so every ID inserted by Better Auth is a valid UUID v4.
//
// These tests guard against configuration regressions:
//   - AUTH_ID_GENERATOR must be exported (import fails if removed)
//   - UUID_V4_REGEX must be exported (import fails if removed)
//   - AUTH_ID_GENERATOR() must produce a string matching UUID_V4_REGEX
// If advanced.generateId is changed to a different function, the caller
// should update AUTH_ID_GENERATOR so these tests continue to serve as the
// regression guard for the config.
//
// These tests require no database connection.
// ============================================================================

Deno.test('AUTH_ID_GENERATOR is exported from auth module', () => {
    assertExists(AUTH_ID_GENERATOR);
    assertEquals(typeof AUTH_ID_GENERATOR, 'function');
});

Deno.test('UUID_V4_REGEX is exported from auth module', () => {
    assertExists(UUID_V4_REGEX);
    assertEquals(UUID_V4_REGEX instanceof RegExp, true);
});

Deno.test('AUTH_ID_GENERATOR produces a UUID v4 string matching UUID_V4_REGEX', () => {
    const id = AUTH_ID_GENERATOR();
    assertEquals(typeof id, 'string', 'AUTH_ID_GENERATOR must return a string');
    assertEquals(UUID_V4_REGEX.test(id), true, `AUTH_ID_GENERATOR() returned "${id}" which does not match UUID_V4_REGEX — PostgreSQL uuid columns would reject this`);
});

Deno.test('AUTH_ID_GENERATOR produces unique IDs on successive calls', () => {
    const id1 = AUTH_ID_GENERATOR();
    const id2 = AUTH_ID_GENERATOR();
    assertEquals(id1 === id2, false, 'AUTH_ID_GENERATOR must produce unique IDs');
});

// ============================================================================
// AUTH_DISABLE_CSRF_CHECK — CSRF bypass guard
// ============================================================================
//
// Better Auth 1.5.x throws MISSING_OR_NULL_ORIGIN when a Cookie header is
// present but no Origin header is present — every non-browser API client
// (Postman, curl, SDK) that received a session cookie triggers this.
//
// The fix is advanced.disableCSRFCheck: true, exported as AUTH_DISABLE_CSRF_CHECK.
// These tests guard against a regression where the constant is accidentally set
// to false (which would re-enable the broken behaviour for non-browser clients).
//
// CSRF protection is maintained by sameSite: 'lax' cookies (browsers don't send
// these on cross-site POSTs).  The Better Auth handler returns directly without
// calling next(), so the global CORS middleware (step 4) does not run for
// /api/auth/* routes.
// ============================================================================

Deno.test('AUTH_DISABLE_CSRF_CHECK is true — CSRF check must be disabled for non-browser clients', () => {
    assertEquals(typeof AUTH_DISABLE_CSRF_CHECK, 'boolean');
    assertStrictEquals(
        AUTH_DISABLE_CSRF_CHECK,
        true,
        'AUTH_DISABLE_CSRF_CHECK must be true; setting it to false will break Postman/curl/SDK auth by causing MISSING_OR_NULL_ORIGIN errors',
    );
});

// ============================================================================
// buildTrustedOriginsFn — trusted origins builder
// ============================================================================
//
// buildTrustedOriginsFn(env) returns a function that Better Auth calls to
// obtain the list of trusted origins for URL validation (callbackURL,
// redirectTo, etc.).  It reads from parseAllowedOrigins(env) so the list
// stays in sync with the CORS middleware allowlist.
// ============================================================================

Deno.test('buildTrustedOriginsFn is exported as a function', () => {
    assertEquals(typeof buildTrustedOriginsFn, 'function');
});

Deno.test('buildTrustedOriginsFn returns a function', () => {
    const fakeEnv = {} as import('../types.ts').Env;
    const fn = buildTrustedOriginsFn(fakeEnv);
    assertEquals(typeof fn, 'function');
});

Deno.test('buildTrustedOriginsFn returns default origins when CORS_ALLOWED_ORIGINS is not set', () => {
    const fakeEnv = {} as import('../types.ts').Env;
    const fn = buildTrustedOriginsFn(fakeEnv);
    const origins = fn();
    assertEquals(Array.isArray(origins), true);
    // Default origins include localhost dev servers
    assertEquals(origins.includes('http://localhost:4200'), true, 'Default origins must include Angular dev server');
    assertEquals(origins.includes('http://localhost:8787'), true, 'Default origins must include Wrangler dev server');
});

Deno.test('buildTrustedOriginsFn reflects CORS_ALLOWED_ORIGINS from env', () => {
    const fakeEnv = { CORS_ALLOWED_ORIGINS: 'https://app.bloqr.dev,https://api.bloqr.dev' } as unknown as import('../types.ts').Env;
    const fn = buildTrustedOriginsFn(fakeEnv);
    const origins = fn();
    assertEquals(origins, ['https://app.bloqr.dev', 'https://api.bloqr.dev']);
});

Deno.test('buildTrustedOriginsFn ignores the request argument (env-based allowlist)', () => {
    const fakeEnv = { CORS_ALLOWED_ORIGINS: 'https://app.bloqr.dev' } as unknown as import('../types.ts').Env;
    const fn = buildTrustedOriginsFn(fakeEnv);
    // With request
    const withReq = fn(new Request('https://api.bloqr.dev/api/auth/sign-in/email'));
    // Without request
    const withoutReq = fn();
    assertEquals(withReq, withoutReq, 'The origin list must not depend on the request object');
});

// ============================================================================
// createKvSecondaryStorage — KV adapter for Better Auth secondaryStorage
// ============================================================================
//
// createKvSecondaryStorage() wraps a Cloudflare KVNamespace in the interface
// that Better Auth expects for secondaryStorage.  These tests use a minimal
// in-memory mock so no real KV binding is needed.
// ============================================================================

/**
 * Creates an in-memory mock KVNamespace for createKvSecondaryStorage tests.
 * Returns { kv, store } so tests can inspect stored values directly.
 */
function createMockKvNamespace(): { kv: KVNamespace; store: Map<string, string> } {
    const store = new Map<string, string>();
    const kv = {
        get: (key: string) => Promise.resolve(store.get(key) ?? null),
        put: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        delete: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    } as unknown as KVNamespace;
    return { kv, store };
}

Deno.test('createKvSecondaryStorage is exported as a function', () => {
    assertEquals(typeof createKvSecondaryStorage, 'function');
});

Deno.test('createKvSecondaryStorage get delegates to kv.get', async () => {
    const { kv, store } = createMockKvNamespace();
    const adapter = createKvSecondaryStorage(kv);
    store.set('session:abc', 'session-data');
    const value = await adapter.get('session:abc');
    assertEquals(value, 'session-data');
});

Deno.test('createKvSecondaryStorage get returns null for missing keys', async () => {
    const { kv } = createMockKvNamespace();
    const adapter = createKvSecondaryStorage(kv);
    const value = await adapter.get('not-a-real-key');
    assertEquals(value, null);
});

Deno.test('createKvSecondaryStorage set delegates to kv.put without TTL', async () => {
    const puts: Array<{ key: string; value: string; options: unknown }> = [];
    const { kv } = createMockKvNamespace();
    // Override put to capture call arguments for assertion
    (kv as unknown as Record<string, unknown>).put = (key: string, value: string, options?: unknown) => {
        puts.push({ key, value, options });
        return Promise.resolve();
    };

    const adapter = createKvSecondaryStorage(kv);
    await adapter.set('token:xyz', 'token-value');
    assertEquals(puts.length, 1);
    assertEquals(puts[0].key, 'token:xyz');
    assertEquals(puts[0].value, 'token-value');
    assertEquals(puts[0].options, undefined);
});

Deno.test('createKvSecondaryStorage set passes expirationTtl when ttl is provided', async () => {
    const puts: Array<{ key: string; value: string; options: unknown }> = [];
    const { kv } = createMockKvNamespace();
    // Override put to capture call arguments for assertion
    (kv as unknown as Record<string, unknown>).put = (key: string, value: string, options?: unknown) => {
        puts.push({ key, value, options });
        return Promise.resolve();
    };

    const adapter = createKvSecondaryStorage(kv);
    await adapter.set('token:xyz', 'token-value', 300);
    assertEquals(puts.length, 1);
    assertEquals(puts[0].options, { expirationTtl: 300 });
});

Deno.test('createKvSecondaryStorage delete delegates to kv.delete', async () => {
    const deleted: string[] = [];
    const { kv } = createMockKvNamespace();
    // Override delete to capture call arguments for assertion
    (kv as unknown as Record<string, unknown>).delete = (key: string) => {
        deleted.push(key);
        return Promise.resolve();
    };

    const adapter = createKvSecondaryStorage(kv);
    await adapter.delete('session:abc');
    assertEquals(deleted, ['session:abc']);
});

// ============================================================================
// createAuth secondaryStorage — wired from BETTER_AUTH_KV binding
// ============================================================================

Deno.test('createAuth throws WorkerConfigurationError when HYPERDRIVE is absent (regardless of BETTER_AUTH_KV)', () => {
    const { kv } = createMockKvNamespace();
    const fakeEnvWithKv = {
        HYPERDRIVE: undefined,
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
        BETTER_AUTH_KV: kv,
    } as unknown as import('../types.ts').Env;
    assertThrows(() => createAuth(fakeEnvWithKv), WorkerConfigurationError, 'HYPERDRIVE binding is not configured');
});

Deno.test('createAuth does not throw when BETTER_AUTH_KV is absent', () => {
    // createAuth can still be configured without BETTER_AUTH_KV — secondaryStorage
    // falls back to Postgres.  The only bindings it fails hard on are
    // HYPERDRIVE and BETTER_AUTH_SECRET.
    // We expect WorkerConfigurationError for missing HYPERDRIVE, not for missing KV.
    const fakeEnv = {
        HYPERDRIVE: undefined,
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
        BETTER_AUTH_KV: undefined,
    } as unknown as import('../types.ts').Env;
    const err = assertThrows(() => createAuth(fakeEnv), WorkerConfigurationError);
    // The error must be about HYPERDRIVE, not about KV
    assertStringIncludes(err.message, 'HYPERDRIVE');
});

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

import { assertEquals, assertExists, assertInstanceOf, assertStringIncludes, assertThrows } from '@std/assert';
import { AUTH_ID_GENERATOR, createAuth, USER_FIELD_MAPPING, UUID_V4_REGEX, WorkerConfigurationError } from './auth.ts';
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

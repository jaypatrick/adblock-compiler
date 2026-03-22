/**
 * Tests for the Better Auth factory (createAuth).
 *
 * createAuth() requires a real Hyperdrive connection to Neon PostgreSQL,
 * so we cannot call it with a stub environment. Instead, we verify:
 *
 *   - The module exports the expected symbols
 *   - The Auth type is correctly derived from createAuth
 *
 * Integration tests that exercise the full auth flow live in the E2E suite.
 *
 * @see worker/lib/auth.ts
 */

import { assertEquals, assertExists, assertInstanceOf, assertStringIncludes, assertThrows } from '@std/assert';
import { createAuth, WorkerConfigurationError } from './auth.ts';
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

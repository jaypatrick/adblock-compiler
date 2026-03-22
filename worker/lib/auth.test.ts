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

import { assertEquals, assertExists } from '@std/assert';
import { createAuth } from './auth.ts';
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

Deno.test('createAuth throws when HYPERDRIVE.connectionString is invalid', () => {
    // createPrismaClient (called inside createAuth) validates the connection
    // string via Zod — an empty or non-postgresql URL should throw.
    let threw = false;
    try {
        // Minimal stub with an invalid connection string
        const fakeEnv = {
            HYPERDRIVE: { connectionString: '' },
            BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
        } as unknown as import('../types.ts').Env;
        createAuth(fakeEnv);
    } catch {
        threw = true;
    }
    assertEquals(threw, true);
});

Deno.test('createAuth throws when connectionString is a non-postgresql URL', () => {
    let threw = false;
    try {
        const fakeEnv = {
            HYPERDRIVE: { connectionString: 'mysql://user:pass@localhost:3306/db' },
            BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
        } as unknown as import('../types.ts').Env;
        createAuth(fakeEnv);
    } catch {
        threw = true;
    }
    assertEquals(threw, true);
});

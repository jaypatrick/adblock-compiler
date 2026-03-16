/**
 * Tests for PBKDF2 password hashing utilities.
 *
 * @see worker/utils/password.ts
 */

import { assertEquals, assertMatch, assertNotEquals } from '@std/assert';
import { hashPassword, verifyPassword } from './password.ts';

// ============================================================================
// hashPassword
// ============================================================================

Deno.test('hashPassword - returns salt:hash format', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    assertMatch(hash, /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/, 'expected base64url-salt:base64url-hash');
});

Deno.test('hashPassword - two calls produce different salts', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    assertNotEquals(h1, h2, 'different salts should produce different stored hashes');
});

Deno.test('hashPassword - salt and hash are non-empty', async () => {
    const hash = await hashPassword('p@ssw0rd!');
    const [salt, derived] = hash.split(':');
    assertNotEquals(salt, '', 'salt should not be empty');
    assertNotEquals(derived, '', 'derived bits should not be empty');
});

// ============================================================================
// verifyPassword
// ============================================================================

Deno.test('verifyPassword - returns true for correct password', async () => {
    const password = 'correct-horse-battery-staple';
    const stored = await hashPassword(password);
    const result = await verifyPassword(password, stored);
    assertEquals(result, true);
});

Deno.test('verifyPassword - returns false for wrong password', async () => {
    const stored = await hashPassword('the-real-password');
    const result = await verifyPassword('wrong-password', stored);
    assertEquals(result, false);
});

Deno.test('verifyPassword - returns false for empty string against real hash', async () => {
    const stored = await hashPassword('real-password');
    const result = await verifyPassword('', stored);
    assertEquals(result, false);
});

Deno.test('verifyPassword - returns false for malformed stored hash (no colon)', async () => {
    const result = await verifyPassword('any', 'notavalidhash');
    assertEquals(result, false);
});

Deno.test('verifyPassword - returns false for empty stored hash', async () => {
    const result = await verifyPassword('any', '');
    assertEquals(result, false);
});

Deno.test('verifyPassword - returns false for dummy hash (constant-time guard)', async () => {
    const dummy = 'AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const result = await verifyPassword('anything', dummy);
    assertEquals(result, false);
});

// ============================================================================
// Round-trip
// ============================================================================

Deno.test('hashPassword + verifyPassword - round-trip with various passwords', async () => {
    const passwords = [
        'simple',
        'With spaces and CAPS!',
        'unicode-🔑-password',
        'a'.repeat(128), // max length
        '12345678',      // min length
    ];

    for (const pw of passwords) {
        const stored = await hashPassword(pw);
        assertEquals(await verifyPassword(pw, stored), true, `round-trip failed for: ${pw}`);
        assertEquals(await verifyPassword(pw + 'x', stored), false, `collision for: ${pw}`);
    }
});

// ============================================================================
// Constant-time comparison (smoke test)
// ============================================================================

Deno.test('verifyPassword - constant-time: different wrong passwords take similar time', async () => {
    const stored = await hashPassword('secret');

    // Both wrong passwords should complete PBKDF2 regardless of how different they are
    const t0 = performance.now();
    await verifyPassword('a', stored);
    const t1 = performance.now();
    await verifyPassword('z'.repeat(128), stored);
    const t2 = performance.now();

    const short = t1 - t0;
    const long = t2 - t1;

    // Soft assertion: neither should be more than 5x faster than the other.
    // Both involve the same number of PBKDF2 iterations, so timing should
    // be within the same order of magnitude.
    const ratio = Math.max(short, long) / Math.max(Math.min(short, long), 1);
    assertEquals(ratio < 5, true, `Timing ratio ${ratio.toFixed(2)} suggests short-circuit comparison`);
});

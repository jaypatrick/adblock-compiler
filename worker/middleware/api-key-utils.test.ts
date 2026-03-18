/**
 * Tests for the API Key Utilities.
 *
 * Covers:
 *   - generateApiKey: key format, entropy, prefix, uniqueness
 *   - hashKey: deterministic SHA-256 output, hex format, length
 *
 * @see worker/middleware/api-key-utils.ts
 */

import { assertEquals, assertMatch, assertNotEquals } from '@std/assert';
import { generateApiKey, hashKey } from './api-key-utils.ts';

// ============================================================================
// generateApiKey
// ============================================================================

Deno.test('generateApiKey - returns object with rawKey, keyHash, keyPrefix', async () => {
    const key = await generateApiKey();
    assertEquals(typeof key.rawKey, 'string');
    assertEquals(typeof key.keyHash, 'string');
    assertEquals(typeof key.keyPrefix, 'string');
});

Deno.test('generateApiKey - rawKey starts with "abc_" prefix', async () => {
    const key = await generateApiKey();
    assertEquals(key.rawKey.startsWith('abc_'), true);
});

Deno.test('generateApiKey - rawKey has correct total length (abc_ + 48 hex chars = 52)', async () => {
    const key = await generateApiKey();
    assertEquals(key.rawKey.length, 52);
});

Deno.test('generateApiKey - rawKey hex part contains only hex characters', async () => {
    const key = await generateApiKey();
    const hexPart = key.rawKey.slice(4); // remove 'abc_'
    assertMatch(hexPart, /^[0-9a-f]+$/);
});

Deno.test('generateApiKey - keyPrefix is first 8 characters of rawKey', async () => {
    const key = await generateApiKey();
    assertEquals(key.keyPrefix, key.rawKey.substring(0, 8));
});

Deno.test('generateApiKey - keyPrefix starts with "abc_"', async () => {
    const key = await generateApiKey();
    assertEquals(key.keyPrefix.startsWith('abc_'), true);
});

Deno.test('generateApiKey - keyHash is a 64-character hex string (SHA-256)', async () => {
    const key = await generateApiKey();
    assertEquals(key.keyHash.length, 64);
    assertMatch(key.keyHash, /^[0-9a-f]{64}$/);
});

Deno.test('generateApiKey - keyHash matches SHA-256 hash of rawKey', async () => {
    const key = await generateApiKey();
    const expectedHash = await hashKey(key.rawKey);
    assertEquals(key.keyHash, expectedHash);
});

Deno.test('generateApiKey - each call produces a unique rawKey', async () => {
    const key1 = await generateApiKey();
    const key2 = await generateApiKey();
    assertNotEquals(key1.rawKey, key2.rawKey);
});

Deno.test('generateApiKey - each call produces a unique keyHash', async () => {
    const key1 = await generateApiKey();
    const key2 = await generateApiKey();
    assertNotEquals(key1.keyHash, key2.keyHash);
});

// ============================================================================
// hashKey
// ============================================================================

Deno.test('hashKey - returns a 64-character hex string', async () => {
    const hash = await hashKey('test-key');
    assertEquals(hash.length, 64);
    assertMatch(hash, /^[0-9a-f]{64}$/);
});

Deno.test('hashKey - is deterministic (same input = same output)', async () => {
    const hash1 = await hashKey('abc_0123456789abcdef');
    const hash2 = await hashKey('abc_0123456789abcdef');
    assertEquals(hash1, hash2);
});

Deno.test('hashKey - different inputs produce different hashes', async () => {
    const hash1 = await hashKey('key-a');
    const hash2 = await hashKey('key-b');
    assertNotEquals(hash1, hash2);
});

Deno.test('hashKey - handles empty string input', async () => {
    const hash = await hashKey('');
    assertEquals(hash.length, 64);
    assertMatch(hash, /^[0-9a-f]{64}$/);
});

Deno.test('hashKey - handles long string input', async () => {
    const longKey = 'x'.repeat(1000);
    const hash = await hashKey(longKey);
    assertEquals(hash.length, 64);
    assertMatch(hash, /^[0-9a-f]{64}$/);
});

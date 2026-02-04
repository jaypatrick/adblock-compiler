/**
 * Tests for WASM module loader and functionality
 */

import { assertEquals, assertExists } from '@std/assert';
import {
    initWasm,
    isWasmAvailable,
    wasmHashString,
    wasmHasWildcard,
    wasmIsRegexPattern,
    wasmPlainMatch,
    wasmStringEquals,
    wasmStringEqualsIgnoreCase,
    wasmWildcardMatch,
} from './loader.ts';

Deno.test('WASM loader - initialization', async () => {
    const result = await initWasm();
    // May be true or false depending on environment, but should not throw
    assertEquals(typeof result, 'boolean');
});

Deno.test('WASM loader - isWasmAvailable', () => {
    const available = isWasmAvailable();
    assertEquals(typeof available, 'boolean');
});

Deno.test('WASM loader - plainMatch', () => {
    // Should work with or without WASM
    assertEquals(wasmPlainMatch('hello world', 'world'), true);
    assertEquals(wasmPlainMatch('hello world', 'WORLD'), true); // Case insensitive
    assertEquals(wasmPlainMatch('hello world', 'foo'), false);
    assertEquals(wasmPlainMatch('example.com', 'example'), true);
});

Deno.test('WASM loader - wildcardMatch', () => {
    // Test basic wildcard matching
    assertEquals(wasmWildcardMatch('example.com', '*.com'), true);
    assertEquals(wasmWildcardMatch('sub.example.com', '*.example.com'), true);
    assertEquals(wasmWildcardMatch('example.com', '*.org'), false);
    assertEquals(wasmWildcardMatch('test', '*'), true);
    assertEquals(wasmWildcardMatch('anything', '*thing'), true);
    assertEquals(wasmWildcardMatch('anything', 'any*'), true);
    assertEquals(wasmWildcardMatch('anything', 'any*thing'), true);
});

Deno.test('WASM loader - isRegexPattern', () => {
    assertEquals(wasmIsRegexPattern('/pattern/'), true);
    assertEquals(wasmIsRegexPattern('pattern'), false);
    assertEquals(wasmIsRegexPattern('/'), false);
    assertEquals(wasmIsRegexPattern('//'), false);
});

Deno.test('WASM loader - hasWildcard', () => {
    assertEquals(wasmHasWildcard('*.example.com'), true);
    assertEquals(wasmHasWildcard('example.com'), false);
    assertEquals(wasmHasWildcard('*'), true);
});

Deno.test('WASM loader - hashString', () => {
    const hash1 = wasmHashString('test');
    const hash2 = wasmHashString('test');
    const hash3 = wasmHashString('different');

    // Same string should produce same hash
    assertEquals(hash1, hash2);
    // Different strings should (likely) produce different hashes
    assertEquals(hash1 === hash3, false);
    // Hash should be a number
    assertEquals(typeof hash1, 'number');
});

Deno.test('WASM loader - stringEquals', () => {
    assertEquals(wasmStringEquals('test', 'test'), true);
    assertEquals(wasmStringEquals('test', 'Test'), false); // Case sensitive
    assertEquals(wasmStringEquals('test', 'different'), false);
});

Deno.test('WASM loader - stringEqualsIgnoreCase', () => {
    assertEquals(wasmStringEqualsIgnoreCase('test', 'test'), true);
    assertEquals(wasmStringEqualsIgnoreCase('test', 'Test'), true); // Case insensitive
    assertEquals(wasmStringEqualsIgnoreCase('test', 'TEST'), true);
    assertEquals(wasmStringEqualsIgnoreCase('test', 'different'), false);
});

Deno.test('WASM loader - performance baseline', () => {
    // This test just ensures the functions can be called repeatedly without issues
    const testStr = 'this is a test string for performance testing';
    const pattern = '*test*';

    for (let i = 0; i < 100; i++) {
        wasmWildcardMatch(testStr, pattern);
        wasmPlainMatch(testStr, 'test');
        wasmHashString(testStr);
    }

    // If we got here, everything worked
    assertEquals(true, true);
});

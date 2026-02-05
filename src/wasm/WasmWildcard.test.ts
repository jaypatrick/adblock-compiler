/**
 * Tests for WASM-accelerated Wildcard class
 */

import { assertEquals, assertThrows } from '@std/assert';
import { initWasm } from './loader.ts';
import { WasmWildcard } from './WasmWildcard.ts';

// Initialize WASM before tests
await initWasm();

Deno.test('WasmWildcard - constructor validation', () => {
    assertThrows(
        () => new WasmWildcard(''),
        TypeError,
        'Wildcard cannot be empty',
    );
});

Deno.test('WasmWildcard - plain string matching', () => {
    const wildcard = new WasmWildcard('example');

    assertEquals(wildcard.test('example.com'), true);
    assertEquals(wildcard.test('test example test'), true);
    assertEquals(wildcard.test('EXAMPLE'), true); // Case insensitive via includes
    assertEquals(wildcard.test('different'), false);
    assertEquals(wildcard.isPlain, true);
    assertEquals(wildcard.isWildcard, false);
    assertEquals(wildcard.isRegex, false);
});

Deno.test('WasmWildcard - wildcard pattern matching', () => {
    const wildcard = new WasmWildcard('*.example.com');

    assertEquals(wildcard.test('sub.example.com'), true);
    assertEquals(wildcard.test('deep.sub.example.com'), true);
    assertEquals(wildcard.test('example.com'), true); // Empty wildcard match
    assertEquals(wildcard.test('example.org'), false);
    assertEquals(wildcard.isPlain, false);
    assertEquals(wildcard.isWildcard, true);
    assertEquals(wildcard.isRegex, false);
});

Deno.test('WasmWildcard - regex pattern matching', () => {
    const wildcard = new WasmWildcard('/^test.*$/');

    assertEquals(wildcard.test('test'), true);
    assertEquals(wildcard.test('testing'), true);
    assertEquals(wildcard.test('not match'), false);
    assertEquals(wildcard.isPlain, false);
    assertEquals(wildcard.isWildcard, false);
    assertEquals(wildcard.isRegex, true);
});

Deno.test('WasmWildcard - pattern property', () => {
    const pattern = '*.example.com';
    const wildcard = new WasmWildcard(pattern);

    assertEquals(wildcard.pattern, pattern);
    assertEquals(wildcard.toString(), pattern);
});

Deno.test('WasmWildcard - test argument validation', () => {
    const wildcard = new WasmWildcard('test');

    assertThrows(
        // @ts-ignore - Testing invalid argument
        () => wildcard.test(123),
        TypeError,
        'Invalid argument passed to WasmWildcard.test',
    );
});

Deno.test('WasmWildcard - multiple wildcards', () => {
    const wildcard = new WasmWildcard('*test*example*');

    assertEquals(wildcard.test('this is a test with example data'), true);
    assertEquals(wildcard.test('test example'), true);
    assertEquals(wildcard.test('example test'), true);
    assertEquals(wildcard.test('no match here'), false);
});

Deno.test('WasmWildcard - edge cases', () => {
    // Single wildcard matches everything
    const matchAll = new WasmWildcard('*');
    assertEquals(matchAll.test('anything'), true);
    assertEquals(matchAll.test(''), true);

    // Wildcard at start
    const startWildcard = new WasmWildcard('*test');
    assertEquals(startWildcard.test('test'), true);
    assertEquals(startWildcard.test('prefix test'), true);
    assertEquals(startWildcard.test('test suffix'), false);

    // Wildcard at end
    const endWildcard = new WasmWildcard('test*');
    assertEquals(endWildcard.test('test'), true);
    assertEquals(endWildcard.test('test suffix'), true);
    assertEquals(endWildcard.test('prefix test'), false);
});

Deno.test('WasmWildcard - compatibility with standard Wildcard', async () => {
    // Import standard Wildcard for comparison
    const { Wildcard } = await import('../utils/Wildcard.ts');

    const testCases = [
        { pattern: 'test', input: 'test string' },
        { pattern: '*.com', input: 'example.com' },
        { pattern: 'pre*fix', input: 'prefix' },
        { pattern: '/^test/', input: 'testing' },
    ];

    for (const { pattern, input } of testCases) {
        const standard = new Wildcard(pattern);
        const wasm = new WasmWildcard(pattern);

        assertEquals(
            wasm.test(input),
            standard.test(input),
            `Pattern "${pattern}" on input "${input}" should match`,
        );
    }
});

/**
 * Example: Using WebAssembly-accelerated pattern matching
 * 
 * This example demonstrates how to use WASM-accelerated functions
 * for high-performance filter list processing.
 */

import { initWasm, isWasmAvailable, wasmWildcardMatch, WasmWildcard } from '../src/index.ts';

// Initialize WASM module
console.log('Initializing WASM module...');
const wasmInitialized = await initWasm();

if (wasmInitialized) {
    console.log('✅ WASM module initialized successfully');
    console.log(`   WASM available: ${isWasmAvailable()}`);
} else {
    console.log('⚠️  WASM initialization failed - using JavaScript fallback');
}

console.log('\n--- Example 1: Direct WASM Function Usage ---');

// Test wildcard matching
const testDomains = [
    'example.com',
    'sub.example.com',
    'deep.sub.example.com',
    'example.org',
    'test.com',
];

const pattern = '*.example.com';
console.log(`\nTesting pattern: "${pattern}"`);

for (const domain of testDomains) {
    const matches = wasmWildcardMatch(domain, pattern);
    console.log(`  ${domain.padEnd(25)} -> ${matches ? '✓ Match' : '✗ No match'}`);
}

console.log('\n--- Example 2: WasmWildcard Class ---');

// Create reusable pattern matchers
const wildcards = [
    new WasmWildcard('*.google.com'),
    new WasmWildcard('ad*'),
    new WasmWildcard('/^tracking/'),
];

const testRules = [
    'sub.google.com',
    'google.com',
    'facebook.com',
    'ads.example.com',
    'tracker.net',
    'tracking-pixel.com',
];

console.log('\nPattern Matching Results:');
for (const rule of testRules) {
    console.log(`\n  Rule: ${rule}`);
    for (const wildcard of wildcards) {
        const matches = wildcard.test(rule);
        const status = matches ? '✓' : '✗';
        const type = wildcard.isRegex ? 'regex' : wildcard.isWildcard ? 'wildcard' : 'plain';
        console.log(`    ${status} ${wildcard.pattern.padEnd(20)} (${type})`);
    }
}

console.log('\n--- Example 3: Performance Comparison ---');

// Benchmark WASM vs JavaScript
const iterations = 10000;
const testPattern = '*.example.com';
const testString = 'sub.deep.example.com';

console.log(`\nRunning ${iterations} iterations...`);

// WASM version
const wasmStart = performance.now();
for (let i = 0; i < iterations; i++) {
    wasmWildcardMatch(testString, testPattern);
}
const wasmTime = performance.now() - wasmStart;

console.log(`  WASM time: ${wasmTime.toFixed(2)}ms`);
console.log(`  Using WASM: ${isWasmAvailable() ? 'Yes' : 'No (fallback to JS)'}`);

// Calculate throughput
const throughput = Math.floor(iterations / (wasmTime / 1000));
console.log(`  Throughput: ${throughput.toLocaleString()} matches/sec`);

console.log('\n--- Example 4: Pattern Detection ---');

const patterns = [
    'plain-string',
    '*.wildcard.com',
    '/^regex$/',
    'multi*wild*card',
];

console.log('\nPattern Analysis:');
for (const pat of patterns) {
    const wc = new WasmWildcard(pat);
    console.log(`  ${pat.padEnd(20)} -> ${wc.isPlain ? 'Plain' : wc.isWildcard ? 'Wildcard' : 'Regex'}`);
}

console.log('\n✨ Example completed!');

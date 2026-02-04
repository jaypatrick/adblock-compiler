/**
 * Benchmark: WASM vs JavaScript pattern matching
 * 
 * Run with: deno bench --allow-read src/wasm/wasm.bench.ts
 */

import { initWasm, wasmWildcardMatch } from './loader.ts';
import { Wildcard } from '../utils/Wildcard.ts';

// Initialize WASM before benchmarks
await initWasm();

const testDomains = [
    'example.com',
    'sub.example.com',
    'deep.sub.example.com',
    'another.example.com',
    'test.example.org',
    'random.site.net',
    'ads.tracker.com',
    'content.delivery.network.com',
    'api.service.example.com',
    'cdn.static.assets.com',
];

const wildcardPatterns = [
    '*.example.com',
    'ads.*',
    '*.tracker.*',
    '*.cdn.*',
    '*.api.*',
];

Deno.bench('WASM - wildcard pattern matching (single)', () => {
    for (const domain of testDomains) {
        wasmWildcardMatch(domain, '*.example.com');
    }
});

Deno.bench('JavaScript - wildcard pattern matching (single)', () => {
    const wildcard = new Wildcard('*.example.com');
    for (const domain of testDomains) {
        wildcard.test(domain);
    }
});

Deno.bench('WASM - wildcard pattern matching (multiple patterns)', () => {
    for (const domain of testDomains) {
        for (const pattern of wildcardPatterns) {
            wasmWildcardMatch(domain, pattern);
        }
    }
});

Deno.bench('JavaScript - wildcard pattern matching (multiple patterns)', () => {
    const wildcards = wildcardPatterns.map((p) => new Wildcard(p));
    for (const domain of testDomains) {
        for (const wildcard of wildcards) {
            wildcard.test(domain);
        }
    }
});

Deno.bench('WASM - plain string matching', () => {
    for (const domain of testDomains) {
        for (const pattern of ['example', 'tracker', 'ads', 'cdn', 'api']) {
            wasmWildcardMatch(domain, pattern);
        }
    }
});

Deno.bench('JavaScript - plain string matching', () => {
    for (const domain of testDomains) {
        for (const pattern of ['example', 'tracker', 'ads', 'cdn', 'api']) {
            domain.toLowerCase().includes(pattern.toLowerCase());
        }
    }
});

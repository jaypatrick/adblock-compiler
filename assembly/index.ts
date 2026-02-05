/**
 * WebAssembly entry point for adblock-compiler
 *
 * This module provides high-performance utilities for filter list processing:
 * - Pattern matching (wildcards, plain strings)
 * - String hashing for deduplication
 * - String utilities
 */

// Re-export wildcard pattern matching functions
export { hashString, hasWildcard, isRegexPattern, plainMatch, stringEquals, stringEqualsIgnoreCase, wildcardMatch } from './wildcard';

/**
 * Example function: Add two numbers
 * This can be removed once WASM integration is complete
 */
export function add(a: i32, b: i32): i32 {
    return a + b;
}

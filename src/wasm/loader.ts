/**
 * WebAssembly module loader for adblock-compiler
 * 
 * This module provides a high-level interface to WASM-accelerated functions.
 * Falls back to JavaScript implementations if WASM is not available.
 */

import { logger } from '../utils/logger.ts';

// Type definitions for WASM exports
interface WasmExports {
    add(a: number, b: number): number;
    plainMatch(haystack: string, needle: string): number;
    wildcardMatch(str: string, pattern: string): number;
    isRegexPattern(pattern: string): number;
    hasWildcard(pattern: string): number;
    hashString(str: string): number;
    stringEquals(a: string, b: string): number;
    stringEqualsIgnoreCase(a: string, b: string): number;
}

let wasmModule: WasmExports | null = null;
let wasmInitialized = false;

/**
 * Initialize the WASM module
 * This should be called once at startup
 */
export async function initWasm(wasmPath?: string): Promise<boolean> {
    if (wasmInitialized) {
        return wasmModule !== null;
    }

    try {
        // Default to release build
        const path = wasmPath ?? new URL('../../build/wasm/adblock.wasm', import.meta.url).pathname;
        
        // Load WASM module
        const wasmBytes = await Deno.readFile(path);
        const wasmInstance = await WebAssembly.instantiate(wasmBytes, {});
        
        wasmModule = wasmInstance.instance.exports as unknown as WasmExports;
        wasmInitialized = true;
        
        logger.info('WASM module initialized successfully');
        return true;
    } catch (error) {
        logger.warn(`Failed to initialize WASM module: ${error instanceof Error ? error.message : String(error)}`);
        wasmInitialized = true;
        return false;
    }
}

/**
 * Check if WASM is available
 */
export function isWasmAvailable(): boolean {
    return wasmModule !== null;
}

/**
 * Plain string matching (case-insensitive substring search)
 * @param haystack - String to search in
 * @param needle - String to search for
 * @returns true if needle is found in haystack
 */
export function wasmPlainMatch(haystack: string, needle: string): boolean {
    if (wasmModule) {
        return wasmModule.plainMatch(haystack, needle) === 1;
    }
    // Fallback to JavaScript
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Wildcard pattern matching with * support
 * @param str - String to test
 * @param pattern - Pattern with wildcards (e.g., "*.example.com")
 * @returns true if pattern matches
 */
export function wasmWildcardMatch(str: string, pattern: string): boolean {
    if (wasmModule) {
        return wasmModule.wildcardMatch(str, pattern) === 1;
    }
    // Fallback to JavaScript (simplified)
    const regex = new RegExp(
        '^' + pattern.split('*').map(escapeRegExp).join('.*') + '$',
        'i'
    );
    return regex.test(str);
}

/**
 * Check if a pattern is a regex pattern
 * @param pattern - Pattern to check
 * @returns true if pattern starts and ends with /
 */
export function wasmIsRegexPattern(pattern: string): boolean {
    if (wasmModule) {
        return wasmModule.isRegexPattern(pattern) === 1;
    }
    // Fallback to JavaScript
    return pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/');
}

/**
 * Check if a pattern contains wildcards
 * @param pattern - Pattern to check
 * @returns true if pattern contains *
 */
export function wasmHasWildcard(pattern: string): boolean {
    if (wasmModule) {
        return wasmModule.hasWildcard(pattern) === 1;
    }
    // Fallback to JavaScript
    return pattern.includes('*');
}

/**
 * Hash a string using DJB2 algorithm
 * @param str - String to hash
 * @returns Hash value as unsigned 32-bit integer
 */
export function wasmHashString(str: string): number {
    if (wasmModule) {
        return wasmModule.hashString(str);
    }
    // Fallback to JavaScript
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        hash = ((hash << 5) + hash) + c;
    }
    return hash >>> 0; // Convert to unsigned
}

/**
 * Compare two strings for equality (case-sensitive)
 */
export function wasmStringEquals(a: string, b: string): boolean {
    if (wasmModule) {
        return wasmModule.stringEquals(a, b) === 1;
    }
    return a === b;
}

/**
 * Compare two strings for equality (case-insensitive)
 */
export function wasmStringEqualsIgnoreCase(a: string, b: string): boolean {
    if (wasmModule) {
        return wasmModule.stringEqualsIgnoreCase(a, b) === 1;
    }
    return a.toLowerCase() === b.toLowerCase();
}

// Helper function for escaping regex
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * WebAssembly module exports for adblock-compiler
 *
 * This module provides WASM-accelerated implementations of performance-critical operations.
 */

// Re-export loader functions
export {
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

// Export WASM-accelerated Wildcard class
export { WasmWildcard } from './WasmWildcard.ts';

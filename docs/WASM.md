# WebAssembly Support

This document describes the WebAssembly (WASM) support in adblock-compiler via AssemblyScript.

## Overview

The adblock-compiler now includes WebAssembly-accelerated implementations of performance-critical operations, providing significant speed improvements for filter list processing.

## Features

### WASM-Accelerated Operations

- **Pattern Matching**: High-performance wildcard and plain string matching
- **String Hashing**: Fast DJB2 hash function for deduplication
- **String Utilities**: Optimized string comparison functions

### Automatic Fallback

All WASM functions automatically fall back to JavaScript implementations if WASM is not available or fails to initialize, ensuring compatibility across all environments.

## Building WASM Modules

### Prerequisites

```bash
npm install
```

This installs AssemblyScript as a dev dependency.

### Build Commands

```bash
# Build both debug and release versions
npm run asbuild

# Build debug version (with source maps)
npm run asbuild:debug

# Build release version (optimized)
npm run asbuild:release
```

### Build Outputs

WASM modules are generated in `build/wasm/`:

- `adblock.wasm` - Optimized release build (~17KB)
- `adblock.debug.wasm` - Debug build with source maps (~28KB)
- `*.wat` - WebAssembly text format (human-readable)
- `*.js` - JavaScript bindings (ESM format)
- `*.d.ts` - TypeScript definitions

## Usage

### Initialization

Initialize WASM support at application startup:

```typescript
import { initWasm, isWasmAvailable } from '@jk-com/adblock-compiler';

// Initialize WASM module
const success = await initWasm();

if (success) {
    console.log('WASM initialized successfully');
} else {
    console.log('WASM not available, using JavaScript fallback');
}

// Check if WASM is available
if (isWasmAvailable()) {
    console.log('WASM is ready to use');
}
```

### Using WASM Functions

#### Plain String Matching

```typescript
import { wasmPlainMatch } from '@jk-com/adblock-compiler';

// Case-insensitive substring search
const matches = wasmPlainMatch('example.com', 'example'); // true
```

#### Wildcard Pattern Matching

```typescript
import { wasmWildcardMatch } from '@jk-com/adblock-compiler';

// Test wildcard patterns
const matches1 = wasmWildcardMatch('sub.example.com', '*.example.com'); // true
const matches2 = wasmWildcardMatch('example.com', '*.org'); // false
```

#### String Hashing

```typescript
import { wasmHashString } from '@jk-com/adblock-compiler';

// Fast hash function for deduplication
const hash1 = wasmHashString('rule1');
const hash2 = wasmHashString('rule1'); // Same as hash1
```

#### Pattern Detection

```typescript
import { wasmHasWildcard, wasmIsRegexPattern } from '@jk-com/adblock-compiler';

// Check if pattern contains wildcards
const hasWild = wasmHasWildcard('*.example.com'); // true

// Check if pattern is a regex
const isRegex = wasmIsRegexPattern('/pattern/'); // true
```

### WASM-Accelerated Wildcard Class

Use `WasmWildcard` as a drop-in replacement for the standard `Wildcard` class:

```typescript
import { WasmWildcard } from '@jk-com/adblock-compiler';

// Create pattern matcher
const wildcard = new WasmWildcard('*.example.com');

// Test patterns
console.log(wildcard.test('sub.example.com')); // true
console.log(wildcard.test('example.org')); // false

// Check pattern type
console.log(wildcard.isWildcard); // true
console.log(wildcard.isPlain); // false
console.log(wildcard.usingWasm); // true (if WASM is available)
```

## Performance

### Expected Improvements

Based on the architecture analysis, WASM provides:

- **Wildcard Pattern Matching**: 3-5x speedup
- **Duplicate Detection**: 2-3x speedup (via hash functions)
- **String Operations**: 2-4x speedup for bulk operations

### Benchmarking

Run benchmarks to compare WASM vs JavaScript performance:

```bash
# Run all benchmarks
deno task bench

# Run specific utility benchmarks
deno task bench:utils
```

## AssemblyScript Source

The AssemblyScript source code is located in the `assembly/` directory:

- `assembly/index.ts` - Main WASM entry point
- `assembly/wildcard.ts` - Pattern matching implementations
- `asconfig.json` - AssemblyScript compiler configuration

### Adding New WASM Functions

1. Add your AssemblyScript function to `assembly/wildcard.ts` or create a new `.ts` file
2. Export the function from `assembly/index.ts`
3. Add TypeScript wrapper in `src/wasm/loader.ts`
4. Export from `src/wasm/index.ts`
5. Rebuild: `npm run asbuild`

Example:

```typescript
// assembly/wildcard.ts
export function myNewFunction(input: string): i32 {
    // Your WASM code here
    return 1;
}

// src/wasm/loader.ts
export function wasmMyNewFunction(input: string): boolean {
    if (wasmModule) {
        return wasmModule.myNewFunction(input) === 1;
    }
    // JavaScript fallback
    return false;
}
```

## Compatibility

### Supported Runtimes

- ✅ Deno (2.0+)
- ✅ Node.js (18+)
- ✅ Cloudflare Workers
- ✅ Deno Deploy
- ✅ Web Browsers

### Automatic Fallback

If WASM initialization fails (e.g., in restricted environments), all functions automatically fall back to JavaScript implementations, ensuring the library works everywhere.

## Testing

Run WASM-specific tests:

```bash
deno test --allow-read src/wasm/
```

Test files:
- `src/wasm/loader.test.ts` - Tests for WASM loader and functions
- `src/wasm/WasmWildcard.test.ts` - Tests for WASM-accelerated Wildcard class

## Troubleshooting

### WASM Fails to Initialize

If WASM initialization fails, check:

1. **File Permissions**: Ensure `build/wasm/adblock.wasm` is readable
2. **Path Resolution**: Verify the WASM file path is correct
3. **Runtime Support**: Confirm your runtime supports WebAssembly

### Performance Not Improved

If you don't see performance improvements:

1. **Check Initialization**: Ensure `initWasm()` was called and succeeded
2. **Verify Usage**: Confirm you're using the `wasm*` functions or `WasmWildcard`
3. **Data Size**: WASM overhead may outweigh benefits for very small datasets

## Resources

- [AssemblyScript Documentation](https://www.assemblyscript.org/)
- [WebAssembly by Example](https://wasmbyexample.dev/)
- [MDN WebAssembly Guide](https://developer.mozilla.org/en-US/docs/WebAssembly)

## License

WebAssembly support is part of adblock-compiler and follows the same GPL-3.0 license.

# AssemblyScript Source

This directory contains the AssemblyScript source code that is compiled to WebAssembly.

## Files

- **index.ts** - Main WASM entry point that exports all functions
- **wildcard.ts** - Pattern matching implementations (wildcards, plain strings, hashing)
- **tsconfig.json** - AssemblyScript TypeScript configuration

## Building

```bash
# Build both debug and release versions
npm run asbuild

# Build debug version (with source maps)
npm run asbuild:debug

# Build release version (optimized)
npm run asbuild:release
```

## Build Output

Compiled WASM modules are output to `build/wasm/`:

- `adblock.wasm` - Optimized release build (~17KB)
- `adblock.debug.wasm` - Debug build with source maps (~28KB)
- `*.wat` - WebAssembly text format (human-readable)
- `*.js` - JavaScript bindings (ESM format)
- `*.d.ts` - TypeScript type definitions

## Configuration

Build configuration is defined in `asconfig.json` at the project root:

```json
{
  "targets": {
    "debug": {
      "outFile": "build/wasm/adblock.debug.wasm",
      "sourceMap": true,
      "debug": true
    },
    "release": {
      "outFile": "build/wasm/adblock.wasm",
      "optimizeLevel": 3,
      "shrinkLevel": 0
    }
  },
  "options": {
    "bindings": "esm"
  }
}
```

## Adding New Functions

To add a new WASM function:

1. **Add function to AssemblyScript source**:
   ```typescript
   // assembly/wildcard.ts or new file
   export function myFunction(input: string): i32 {
       // Your WASM implementation
       return 1;
   }
   ```

2. **Export from index.ts**:
   ```typescript
   // assembly/index.ts
   export { myFunction } from './wildcard';
   ```

3. **Add TypeScript wrapper**:
   ```typescript
   // src/wasm/loader.ts
   export function wasmMyFunction(input: string): boolean {
       if (wasmModule) {
           return wasmModule.myFunction(input) === 1;
       }
       // JavaScript fallback
       return false;
   }
   ```

4. **Rebuild WASM**:
   ```bash
   npm run asbuild
   ```

## AssemblyScript Types

AssemblyScript uses different numeric types than JavaScript:

- `i32` - 32-bit signed integer
- `i64` - 64-bit signed integer
- `u32` - 32-bit unsigned integer
- `u64` - 64-bit unsigned integer
- `f32` - 32-bit float
- `f64` - 64-bit float
- `string` - UTF-16 string (compatible with JavaScript)

Return `1` or `0` for boolean values (converted to `true`/`false` in the TypeScript wrapper).

## Performance Tips

1. **Minimize String Operations**: String operations can be expensive; prefer numeric operations when possible
2. **Use Integer Types**: `i32` is faster than `i64` for most operations
3. **Avoid Memory Allocations**: Reuse objects and arrays when possible
4. **Inline Small Functions**: Small functions may be automatically inlined
5. **Profile First**: Always benchmark before and after WASM conversion

## Resources

- [AssemblyScript Documentation](https://www.assemblyscript.org/)
- [AssemblyScript Standard Library](https://www.assemblyscript.org/stdlib/globals.html)
- [WebAssembly Specification](https://webassembly.github.io/spec/)
- [WASM by Example](https://wasmbyexample.dev/)

## License

Same as the parent project (GPL-3.0).

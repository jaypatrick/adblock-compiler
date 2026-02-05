async function instantiate(module, imports = {}) {
  const adaptedImports = {
    env: Object.assign(Object.create(globalThis), imports.env || {}, {
      abort(message, fileName, lineNumber, columnNumber) {
        // ~lib/builtins/abort(~lib/string/String | null?, ~lib/string/String | null?, u32?, u32?) => void
        message = __liftString(message >>> 0);
        fileName = __liftString(fileName >>> 0);
        lineNumber = lineNumber >>> 0;
        columnNumber = columnNumber >>> 0;
        (() => {
          // @external.js
          throw Error(`${message} in ${fileName}:${lineNumber}:${columnNumber}`);
        })();
      },
    }),
  };
  const { exports } = await WebAssembly.instantiate(module, adaptedImports);
  const memory = exports.memory || imports.env.memory;
  const adaptedExports = Object.setPrototypeOf({
    hashString(str) {
      // assembly/wildcard/hashString(~lib/string/String) => u32
      str = __lowerString(str) || __notnull();
      return exports.hashString(str) >>> 0;
    },
    hasWildcard(pattern) {
      // assembly/wildcard/hasWildcard(~lib/string/String) => i32
      pattern = __lowerString(pattern) || __notnull();
      return exports.hasWildcard(pattern);
    },
    isRegexPattern(pattern) {
      // assembly/wildcard/isRegexPattern(~lib/string/String) => i32
      pattern = __lowerString(pattern) || __notnull();
      return exports.isRegexPattern(pattern);
    },
    plainMatch(haystack, needle) {
      // assembly/wildcard/plainMatch(~lib/string/String, ~lib/string/String) => i32
      haystack = __retain(__lowerString(haystack) || __notnull());
      needle = __lowerString(needle) || __notnull();
      try {
        return exports.plainMatch(haystack, needle);
      } finally {
        __release(haystack);
      }
    },
    stringEquals(a, b) {
      // assembly/wildcard/stringEquals(~lib/string/String, ~lib/string/String) => i32
      a = __retain(__lowerString(a) || __notnull());
      b = __lowerString(b) || __notnull();
      try {
        return exports.stringEquals(a, b);
      } finally {
        __release(a);
      }
    },
    stringEqualsIgnoreCase(a, b) {
      // assembly/wildcard/stringEqualsIgnoreCase(~lib/string/String, ~lib/string/String) => i32
      a = __retain(__lowerString(a) || __notnull());
      b = __lowerString(b) || __notnull();
      try {
        return exports.stringEqualsIgnoreCase(a, b);
      } finally {
        __release(a);
      }
    },
    wildcardMatch(str, pattern) {
      // assembly/wildcard/wildcardMatch(~lib/string/String, ~lib/string/String) => i32
      str = __retain(__lowerString(str) || __notnull());
      pattern = __lowerString(pattern) || __notnull();
      try {
        return exports.wildcardMatch(str, pattern);
      } finally {
        __release(str);
      }
    },
  }, exports);
  function __liftString(pointer) {
    if (!pointer) return null;
    const
      end = pointer + new Uint32Array(memory.buffer)[pointer - 4 >>> 2] >>> 1,
      memoryU16 = new Uint16Array(memory.buffer);
    let
      start = pointer >>> 1,
      string = "";
    while (end - start > 1024) string += String.fromCharCode(...memoryU16.subarray(start, start += 1024));
    return string + String.fromCharCode(...memoryU16.subarray(start, end));
  }
  function __lowerString(value) {
    if (value == null) return 0;
    const
      length = value.length,
      pointer = exports.__new(length << 1, 2) >>> 0,
      memoryU16 = new Uint16Array(memory.buffer);
    for (let i = 0; i < length; ++i) memoryU16[(pointer >>> 1) + i] = value.charCodeAt(i);
    return pointer;
  }
  const refcounts = new Map();
  function __retain(pointer) {
    if (pointer) {
      const refcount = refcounts.get(pointer);
      if (refcount) refcounts.set(pointer, refcount + 1);
      else refcounts.set(exports.__pin(pointer), 1);
    }
    return pointer;
  }
  function __release(pointer) {
    if (pointer) {
      const refcount = refcounts.get(pointer);
      if (refcount === 1) exports.__unpin(pointer), refcounts.delete(pointer);
      else if (refcount) refcounts.set(pointer, refcount - 1);
      else throw Error(`invalid refcount '${refcount}' for reference '${pointer}'`);
    }
  }
  function __notnull() {
    throw TypeError("value must not be null");
  }
  return adaptedExports;
}
export const {
  memory,
  add,
  hashString,
  hasWildcard,
  isRegexPattern,
  plainMatch,
  stringEquals,
  stringEqualsIgnoreCase,
  wildcardMatch,
} = await (async url => instantiate(
  await (async () => {
    const isNodeOrBun = typeof process != "undefined" && process.versions != null && (process.versions.node != null || process.versions.bun != null);
    if (isNodeOrBun) { return globalThis.WebAssembly.compile(await (await import("node:fs/promises")).readFile(url)); }
    else { return await globalThis.WebAssembly.compileStreaming(globalThis.fetch(url)); }
  })(), {
  }
))(new URL("adblock.wasm", import.meta.url));

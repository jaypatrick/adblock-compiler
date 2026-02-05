/** Exported memory */
export declare const memory: WebAssembly.Memory;
/**
 * assembly/index/add
 * @param a `i32`
 * @param b `i32`
 * @returns `i32`
 */
export declare function add(a: number, b: number): number;
/**
 * assembly/wildcard/hashString
 * @param str `~lib/string/String`
 * @returns `u32`
 */
export declare function hashString(str: string): number;
/**
 * assembly/wildcard/hasWildcard
 * @param pattern `~lib/string/String`
 * @returns `i32`
 */
export declare function hasWildcard(pattern: string): number;
/**
 * assembly/wildcard/isRegexPattern
 * @param pattern `~lib/string/String`
 * @returns `i32`
 */
export declare function isRegexPattern(pattern: string): number;
/**
 * assembly/wildcard/plainMatch
 * @param haystack `~lib/string/String`
 * @param needle `~lib/string/String`
 * @returns `i32`
 */
export declare function plainMatch(haystack: string, needle: string): number;
/**
 * assembly/wildcard/stringEquals
 * @param a `~lib/string/String`
 * @param b `~lib/string/String`
 * @returns `i32`
 */
export declare function stringEquals(a: string, b: string): number;
/**
 * assembly/wildcard/stringEqualsIgnoreCase
 * @param a `~lib/string/String`
 * @param b `~lib/string/String`
 * @returns `i32`
 */
export declare function stringEqualsIgnoreCase(a: string, b: string): number;
/**
 * assembly/wildcard/wildcardMatch
 * @param str `~lib/string/String`
 * @param pattern `~lib/string/String`
 * @returns `i32`
 */
export declare function wildcardMatch(str: string, pattern: string): number;

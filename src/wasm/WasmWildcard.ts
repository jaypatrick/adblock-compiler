/**
 * WASM-accelerated Wildcard pattern matcher
 *
 * This class is a drop-in replacement for the standard Wildcard class
 * that uses WebAssembly for improved performance.
 */

import { StringUtils } from '../utils/StringUtils.ts';
import { isWasmAvailable, wasmHasWildcard, wasmIsRegexPattern, wasmPlainMatch, wasmWildcardMatch } from './loader.ts';

/**
 * WASM-accelerated pattern matching class that supports:
 * 1. Plain string matching (substring search)
 * 2. Wildcard patterns with * (glob-style)
 * 3. Full regular expressions when wrapped in /regex/
 *
 * Falls back to JavaScript implementations if WASM is not available.
 */
export class WasmWildcard {
    private readonly regex: RegExp | null = null;
    private readonly plainStr: string;
    private readonly useWasm: boolean;
    private readonly _isWildcard: boolean;
    private readonly _isRegex: boolean;

    /**
     * Creates a new WASM-accelerated Wildcard pattern matcher.
     * @param pattern - Pattern string (plain, wildcard with *, or /regex/)
     * @throws TypeError if pattern is empty
     */
    constructor(pattern: string) {
        if (!pattern) {
            throw new TypeError('Wildcard cannot be empty');
        }

        this.plainStr = pattern;
        this.useWasm = isWasmAvailable();

        // Check if it's a regex pattern
        const isRegex = this.useWasm ? wasmIsRegexPattern(pattern) : (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2);
        this._isRegex = isRegex;

        if (isRegex) {
            const regexStr = pattern.substring(1, pattern.length - 1);
            this.regex = new RegExp(regexStr, 'mi');
            this._isWildcard = false;
        } else {
            const hasWildcard = this.useWasm ? wasmHasWildcard(pattern) : pattern.includes('*');
            this._isWildcard = hasWildcard;

            // Only compile to regex if NOT using WASM or if no wildcard
            if (hasWildcard && !this.useWasm) {
                // Convert wildcard pattern to regex (JavaScript fallback only)
                const regexStr = pattern
                    .split(/\*+/)
                    .map(StringUtils.escapeRegExp)
                    .join('[\\s\\S]*');
                this.regex = new RegExp(`^${regexStr}$`, 'i');
            }
        }
    }

    /**
     * Tests if the pattern matches the given string.
     * Uses WASM for plain and wildcard matching when available.
     *
     * @param str - String to test against the pattern
     * @returns true if the string matches the pattern
     * @throws TypeError if argument is not a string
     */
    public test(str: string): boolean {
        if (typeof str !== 'string') {
            throw new TypeError('Invalid argument passed to WasmWildcard.test');
        }

        // For regex patterns, always use JavaScript regex
        if (this.regex !== null && this.isRegex) {
            return this.regex.test(str);
        }

        // For wildcard patterns with WASM available, use WASM
        if (this.useWasm && this.isWildcard) {
            return wasmWildcardMatch(str, this.plainStr);
        }

        // For wildcard patterns without WASM, use JavaScript regex (already compiled in constructor)
        if (this.regex !== null) {
            return this.regex.test(str);
        }

        // Plain string matching
        if (this.useWasm) {
            return wasmPlainMatch(str, this.plainStr);
        }

        return str.includes(this.plainStr);
    }

    /**
     * Returns the original pattern string.
     */
    public toString(): string {
        return this.plainStr;
    }

    /**
     * Gets the pattern string.
     */
    public get pattern(): string {
        return this.plainStr;
    }

    /**
     * Checks if this is a regex pattern.
     */
    public get isRegex(): boolean {
        return this._isRegex;
    }

    /**
     * Checks if this is a wildcard pattern.
     */
    public get isWildcard(): boolean {
        return this._isWildcard;
    }

    /**
     * Checks if this is a plain string pattern.
     */
    public get isPlain(): boolean {
        return !this._isRegex && !this._isWildcard;
    }

    /**
     * Checks if WASM is being used.
     */
    public get usingWasm(): boolean {
        return this.useWasm;
    }
}

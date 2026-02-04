/**
 * WebAssembly-optimized wildcard pattern matching
 * 
 * This module provides high-performance pattern matching for:
 * - Plain string matching (substring search)
 * - Wildcard patterns with * (glob-style)
 * - Full regular expressions
 */

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const char = str.charAt(i);
        // Escape special regex characters: . * + ? ^ $ { } ( ) | [ ] \
        if (
            char === '.' || char === '*' || char === '+' || char === '?' ||
            char === '^' || char === '$' || char === '{' || char === '}' ||
            char === '(' || char === ')' || char === '|' || char === '[' ||
            char === ']' || char === '\\'
        ) {
            result += '\\';
        }
        result += char;
    }
    return result;
}

/**
 * Convert wildcard pattern to regex pattern
 * Splits by * and joins with [\s\S]* (match any character including newlines)
 */
function wildcardToRegex(pattern: string): string {
    const parts: string[] = [];
    let currentPart = '';
    
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern.charAt(i);
        if (char === '*') {
            if (currentPart.length > 0) {
                parts.push(escapeRegExp(currentPart));
                currentPart = '';
            }
        } else {
            currentPart += char;
        }
    }
    
    if (currentPart.length > 0) {
        parts.push(escapeRegExp(currentPart));
    }
    
    let regexStr = '^';
    for (let i = 0; i < parts.length; i++) {
        regexStr += parts[i];
        if (i < parts.length - 1) {
            regexStr += '[\\s\\S]*';
        }
    }
    regexStr += '$';
    
    return regexStr;
}

/**
 * Simple case-insensitive substring search
 * Returns 1 if found, 0 if not found
 */
export function plainMatch(haystack: string, needle: string): i32 {
    const haystackLower = haystack.toLowerCase();
    const needleLower = needle.toLowerCase();
    
    if (haystackLower.includes(needleLower)) {
        return 1;
    }
    return 0;
}

/**
 * Wildcard pattern matching with * support
 * Returns 1 if match, 0 if no match
 * 
 * Pattern format: "*.example.com" matches "sub.example.com"
 */
export function wildcardMatch(str: string, pattern: string): i32 {
    // Simple optimization: if no wildcard, do plain match
    if (!pattern.includes('*')) {
        return plainMatch(str, pattern);
    }
    
    // Split pattern by wildcards
    const parts: string[] = [];
    let currentPart = '';
    
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern.charAt(i);
        if (char === '*') {
            if (currentPart.length > 0) {
                parts.push(currentPart.toLowerCase());
                currentPart = '';
            }
        } else {
            currentPart += char;
        }
    }
    
    if (currentPart.length > 0) {
        parts.push(currentPart.toLowerCase());
    }
    
    // If no parts, pattern is just "*" which matches everything
    if (parts.length === 0) {
        return 1;
    }
    
    const strLower = str.toLowerCase();
    let searchPos = 0;
    
    // Check if each part exists in order
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const pos = strLower.indexOf(part, searchPos);
        
        if (pos < 0) {
            return 0;  // Part not found
        }
        
        // For first part, must match at start if pattern doesn't start with *
        if (i === 0 && !pattern.startsWith('*') && pos !== 0) {
            return 0;
        }
        
        searchPos = pos + part.length;
    }
    
    // For last part, must match at end if pattern doesn't end with *
    if (!pattern.endsWith('*')) {
        const lastPart = parts[parts.length - 1];
        if (!strLower.endsWith(lastPart)) {
            return 0;
        }
    }
    
    return 1;
}

/**
 * Check if a string is a regex pattern (starts and ends with /)
 */
export function isRegexPattern(pattern: string): i32 {
    if (pattern.length <= 2) {
        return 0;
    }
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
        return 1;
    }
    return 0;
}

/**
 * Check if a pattern contains wildcards
 */
export function hasWildcard(pattern: string): i32 {
    if (pattern.includes('*')) {
        return 1;
    }
    return 0;
}

/**
 * Hash function for strings (simple DJB2 hash)
 * Useful for deduplication
 */
export function hashString(str: string): u32 {
    let hash: u32 = 5381;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        hash = ((hash << 5) + hash) + c; // hash * 33 + c
    }
    return hash;
}

/**
 * Compare two strings for equality (case-sensitive)
 */
export function stringEquals(a: string, b: string): i32 {
    if (a === b) {
        return 1;
    }
    return 0;
}

/**
 * Compare two strings for equality (case-insensitive)
 */
export function stringEqualsIgnoreCase(a: string, b: string): i32 {
    if (a.toLowerCase() === b.toLowerCase()) {
        return 1;
    }
    return 0;
}

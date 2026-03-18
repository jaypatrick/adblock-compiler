/**
 * Tests for worker utility constants.
 *
 * Covers:
 *   - API_DOCS_REDIRECT is a non-empty string
 *   - SPA_SERVER_PREFIXES is a non-empty readonly array of strings
 *   - DOCS_SITE_URL is a valid https URL
 *   - ASSETS_BASE_URL is a non-empty string
 *   - FILE_EXTENSION_RE matches file extension paths
 *   - FILE_EXTENSION_RE does not match paths without extensions
 *
 * @see worker/utils/constants.ts
 */

import { assertEquals, assertMatch } from '@std/assert';
import { API_DOCS_REDIRECT, ASSETS_BASE_URL, DOCS_SITE_URL, FILE_EXTENSION_RE, SPA_SERVER_PREFIXES } from './constants.ts';

// ============================================================================
// API_DOCS_REDIRECT
// ============================================================================

Deno.test('API_DOCS_REDIRECT - is a non-empty string', () => {
    assertEquals(typeof API_DOCS_REDIRECT, 'string');
    assertEquals(API_DOCS_REDIRECT.length > 0, true);
});

Deno.test('API_DOCS_REDIRECT - starts with a slash', () => {
    assertEquals(API_DOCS_REDIRECT.startsWith('/'), true);
});

// ============================================================================
// SPA_SERVER_PREFIXES
// ============================================================================

Deno.test('SPA_SERVER_PREFIXES - is a non-empty array', () => {
    assertEquals(Array.isArray(SPA_SERVER_PREFIXES), true);
    assertEquals(SPA_SERVER_PREFIXES.length > 0, true);
});

Deno.test('SPA_SERVER_PREFIXES - all entries start with a slash', () => {
    for (const prefix of SPA_SERVER_PREFIXES) {
        assertEquals(prefix.startsWith('/'), true, `Expected ${prefix} to start with /`);
    }
});

Deno.test('SPA_SERVER_PREFIXES - contains /api', () => {
    assertEquals(SPA_SERVER_PREFIXES.includes('/api'), true);
});

Deno.test('SPA_SERVER_PREFIXES - contains /compile', () => {
    assertEquals(SPA_SERVER_PREFIXES.includes('/compile'), true);
});

// ============================================================================
// DOCS_SITE_URL
// ============================================================================

Deno.test('DOCS_SITE_URL - is a valid https URL', () => {
    assertMatch(DOCS_SITE_URL, /^https:\/\//);
});

// ============================================================================
// ASSETS_BASE_URL
// ============================================================================

Deno.test('ASSETS_BASE_URL - is a non-empty string', () => {
    assertEquals(typeof ASSETS_BASE_URL, 'string');
    assertEquals(ASSETS_BASE_URL.length > 0, true);
});

// ============================================================================
// FILE_EXTENSION_RE
// ============================================================================

Deno.test('FILE_EXTENSION_RE - matches paths with file extensions', () => {
    assertEquals(FILE_EXTENSION_RE.test('/assets/app.js'), true);
    assertEquals(FILE_EXTENSION_RE.test('/assets/style.css'), true);
    assertEquals(FILE_EXTENSION_RE.test('/images/logo.png'), true);
    assertEquals(FILE_EXTENSION_RE.test('/fonts/inter.woff2'), true);
});

Deno.test('FILE_EXTENSION_RE - does not match plain path segments (no extension)', () => {
    assertEquals(FILE_EXTENSION_RE.test('/api'), false);
    assertEquals(FILE_EXTENSION_RE.test('/api/version'), false);
    assertEquals(FILE_EXTENSION_RE.test('/compile'), false);
});

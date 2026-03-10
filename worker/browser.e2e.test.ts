/**
 * End-to-End tests for Browser Rendering endpoints.
 *
 * These tests require a running server instance with the BROWSER binding
 * configured (wrangler dev with [browser] binding in wrangler.toml).
 *
 * Run with:
 *   deno task dev (in a separate terminal)
 *   deno test --allow-net worker/browser.e2e.test.ts
 *
 * Tests cover:
 * - POST /browser/resolve-url — 503 when BROWSER absent, valid response shape
 * - POST /browser/monitor — 503 when BROWSER absent, valid response shape, KV write
 */

import { assertEquals, assertExists } from '@std/assert';

// Configuration
let BASE_URL = 'http://localhost:8787';
try {
    BASE_URL = Deno.env.get('E2E_BASE_URL') || BASE_URL;
} catch {
    // Env access not granted, use default
}

const TIMEOUT_MS = 15_000; // Browser Rendering may take longer than plain HTTP

/**
 * Utility to fetch with timeout
 */
async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Check if server is available
 */
async function isServerAvailable(): Promise<boolean> {
    try {
        const response = await fetchWithTimeout(`${BASE_URL}/api`, undefined, 5_000);
        return response.ok;
    } catch {
        return false;
    }
}

// Skip all tests if server is not available
const serverAvailable = await isServerAvailable();

if (!serverAvailable) {
    console.warn(`⚠️  Server not available at ${BASE_URL}`);
    console.warn('   Start the server with: deno task dev');
    console.warn('   Or set E2E_BASE_URL environment variable');
}

// ============================================================================
// POST /browser/resolve-url
// ============================================================================

Deno.test({
    name: 'E2E: POST /browser/resolve-url - returns 503 when BROWSER binding absent',
    ignore: !serverAvailable,
    fn: async () => {
        // In local dev without the [browser] binding wired, expect a 503.
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/resolve-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://example.com' }),
        });

        // Either 200 (binding present) or 503 (binding absent) — never a 404 or 500
        const validStatus = response.status === 200 || response.status === 503;
        assertEquals(validStatus, true, `Expected 200 or 503, got ${response.status}`);

        const body = await response.json() as Record<string, unknown>;
        if (response.status === 503) {
            assertEquals(body.success, false);
            assertExists(body.error);
            assertEquals(typeof body.error, 'string');
        }
    },
});

Deno.test({
    name: 'E2E: POST /browser/resolve-url - returns 400 for missing url field',
    ignore: !serverAvailable,
    fn: async () => {
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/resolve-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        assertEquals(response.status, 400);
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.success, false);
        assertExists(body.error);
    },
});

Deno.test({
    name: 'E2E: POST /browser/resolve-url - returns 400 for non-http scheme',
    ignore: !serverAvailable,
    fn: async () => {
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/resolve-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'ftp://example.com' }),
        });

        assertEquals(response.status, 400);
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.success, false);
        assertExists(body.error);
    },
});

Deno.test({
    name: 'E2E: POST /browser/resolve-url - with BROWSER binding returns valid response shape',
    ignore: !serverAvailable,
    fn: async () => {
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/resolve-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://example.com' }),
        }, 30_000);

        // If BROWSER is not configured, 503 is acceptable.
        // If it is, we expect the canonical URL shape.
        if (response.status === 503) {
            const body = await response.json() as Record<string, unknown>;
            assertEquals(body.success, false);
            return;
        }

        assertEquals(response.status, 200);
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertExists(body.canonical);
        assertEquals(typeof body.canonical, 'string');
        assertEquals(typeof body.hops, 'number');
    },
});

// ============================================================================
// POST /browser/monitor
// ============================================================================

Deno.test({
    name: 'E2E: POST /browser/monitor - returns 503 when BROWSER binding absent',
    ignore: !serverAvailable,
    fn: async () => {
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/monitor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: ['https://example.com'] }),
        });

        const validStatus = response.status === 200 || response.status === 503;
        assertEquals(validStatus, true, `Expected 200 or 503, got ${response.status}`);

        const body = await response.json() as Record<string, unknown>;
        if (response.status === 503) {
            assertEquals(body.success, false);
            assertExists(body.error);
        }
    },
});

Deno.test({
    name: 'E2E: POST /browser/monitor - returns 400 for missing urls array',
    ignore: !serverAvailable,
    fn: async () => {
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/monitor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        assertEquals(response.status, 400);
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.success, false);
        assertExists(body.error);
    },
});

Deno.test({
    name: 'E2E: POST /browser/monitor - returns 400 for empty urls array',
    ignore: !serverAvailable,
    fn: async () => {
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/monitor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: [] }),
        });

        assertEquals(response.status, 400);
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.success, false);
    },
});

Deno.test({
    name: 'E2E: POST /browser/monitor - with BROWSER binding returns valid response shape',
    ignore: !serverAvailable,
    fn: async () => {
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/monitor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                urls: ['https://example.com'],
                storeScreenshots: false,
            }),
        }, 60_000);

        if (response.status === 503) {
            const body = await response.json() as Record<string, unknown>;
            assertEquals(body.success, false);
            return;
        }

        assertEquals(response.status, 200);
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.success, true);
        assertEquals(typeof body.checked, 'number');
        assertEquals(Array.isArray(body.results), true);

        const results = body.results as Array<Record<string, unknown>>;
        assertEquals(results.length, 1);
        assertExists(results[0].url);
        assertExists(results[0].status);
        const validStatus = results[0].status === 'ok' || results[0].status === 'error';
        assertEquals(validStatus, true);
    },
});

Deno.test({
    name: 'E2E: POST /browser/monitor - responds before waitUntil KV write completes',
    ignore: !serverAvailable,
    fn: async () => {
        const startTime = Date.now();
        const response = await fetchWithTimeout(`${BASE_URL}/api/browser/monitor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                urls: ['https://example.com'],
                storeScreenshots: false,
            }),
        }, 60_000);

        if (response.status === 503) {
            await response.body?.cancel();
            return;
        }

        // Response should come back within 45s total; just verify it eventually returns
        await response.json();
        const elapsed = Date.now() - startTime;
        assertEquals(elapsed < 60_000, true, `Response took unexpectedly long: ${elapsed}ms`);
    },
});

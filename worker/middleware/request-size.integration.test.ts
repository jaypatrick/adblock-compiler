/**
 * Integration test for request body size limits in compile endpoints.
 * Tests the end-to-end flow of body size validation.
 */

import { assertEquals } from '@std/assert';
import type { Env } from '../types.ts';

// Mock a minimal Env for testing
function createMockEnv(maxRequestBodyMB?: string): Env {
    return {
        COMPILER_VERSION: '0.12.1',
        MAX_REQUEST_BODY_MB: maxRequestBodyMB,
        COMPILATION_CACHE: {
            get: async () => null,
            put: async () => {},
        } as unknown as KVNamespace,
        RATE_LIMIT: {
            get: async () => null,
            put: async () => {},
        } as unknown as KVNamespace,
        METRICS: {
            get: async () => null,
            put: async () => {},
        } as unknown as KVNamespace,
    };
}

Deno.test({
    name: 'Integration: validateRequestSize function exists and is callable',
    fn: async () => {
        // Import the module to ensure it compiles
        const { validateRequestSize, getMaxRequestBodySize } = await import('./index.ts');

        // Verify functions exist
        assertEquals(typeof validateRequestSize, 'function');
        assertEquals(typeof getMaxRequestBodySize, 'function');

        // Verify getMaxRequestBodySize returns correct default
        const env = createMockEnv();
        const maxSize = getMaxRequestBodySize(env);
        assertEquals(maxSize, 1024 * 1024);
    },
});

Deno.test({
    name: 'Integration: validateRequestSize with small request',
    fn: async () => {
        const { validateRequestSize } = await import('./index.ts');
        const env = createMockEnv();

        const request = new Request('https://example.com/compile', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': '100',
            },
            body: JSON.stringify({ test: 'data' }),
        });

        const result = await validateRequestSize(request, env);
        assertEquals(result.valid, true);
        assertEquals(result.maxBytes, 1024 * 1024);
    },
});

Deno.test({
    name: 'Integration: validateRequestSize with large request',
    fn: async () => {
        const { validateRequestSize } = await import('./index.ts');
        const env = createMockEnv();

        // Create a request claiming to be 2MB
        const request = new Request('https://example.com/compile', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': String(2 * 1024 * 1024),
            },
            body: 'x'.repeat(2 * 1024 * 1024),
        });

        const result = await validateRequestSize(request, env);
        assertEquals(result.valid, false);
        assertEquals(typeof result.error, 'string');
        assertEquals(result.error?.includes('exceeds maximum allowed size'), true);
    },
});

Deno.test({
    name: 'Integration: custom limit via environment variable',
    fn: async () => {
        const { validateRequestSize, getMaxRequestBodySize } = await import('./index.ts');
        const env = createMockEnv('2'); // 2MB limit

        // Verify the limit is set correctly
        const maxSize = getMaxRequestBodySize(env);
        assertEquals(maxSize, 2 * 1024 * 1024);

        // Test with 1MB request (should pass)
        const smallRequest = new Request('https://example.com/compile', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': String(1024 * 1024),
            },
            body: 'x'.repeat(1024 * 1024),
        });

        const smallResult = await validateRequestSize(smallRequest, env);
        assertEquals(smallResult.valid, true);

        // Test with 3MB request (should fail)
        const largeRequest = new Request('https://example.com/compile', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': String(3 * 1024 * 1024),
            },
            body: 'x'.repeat(3 * 1024 * 1024),
        });

        const largeResult = await validateRequestSize(largeRequest, env);
        assertEquals(largeResult.valid, false);
    },
});

Deno.test({
    name: 'Integration: router imports validateRequestSize successfully',
    fn: async () => {
        // This test verifies that router.ts can be imported and has the correct imports
        try {
            // Just importing the module verifies that all dependencies resolve correctly
            await import('../router.ts');
            // If we get here, the import succeeded - no explicit assertion needed
        } catch (error) {
            // Fail the test if import fails
            throw new Error(`Router import failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

/**
 * Tests for request body size validation middleware.
 * Ensures proper validation and DoS attack prevention.
 */

import { assert, assertEquals } from '@std/assert';
import { getMaxRequestBodySize, validateRequestSize } from './index.ts';
import type { Env } from '../types.ts';

// Mock environment for testing
function createMockEnv(maxRequestBodyMB?: string): Env {
    return {
        COMPILER_VERSION: '0.12.1',
        MAX_REQUEST_BODY_MB: maxRequestBodyMB,
        // Mock KV namespaces with minimal required methods
        COMPILATION_CACHE: {} as KVNamespace,
        RATE_LIMIT: {} as KVNamespace,
        METRICS: {} as KVNamespace,
    };
}

// Helper to create request with specific body size
function createRequestWithBody(bodySize: number, includeContentLength = true): Request {
    const body = 'x'.repeat(bodySize);
    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };
    if (includeContentLength) {
        headers['content-length'] = String(bodySize);
    }
    return new Request('https://example.com/compile', {
        method: 'POST',
        headers,
        body,
    });
}

// ============================================================================
// getMaxRequestBodySize Tests
// ============================================================================

Deno.test({
    name: 'getMaxRequestBodySize - returns default 1MB when not configured',
    fn: () => {
        const env = createMockEnv();
        const maxSize = getMaxRequestBodySize(env);
        assertEquals(maxSize, 1024 * 1024);
    },
});

Deno.test({
    name: 'getMaxRequestBodySize - returns configured value in bytes',
    fn: () => {
        const env = createMockEnv('2');
        const maxSize = getMaxRequestBodySize(env);
        assertEquals(maxSize, 2 * 1024 * 1024);
    },
});

Deno.test({
    name: 'getMaxRequestBodySize - handles fractional MB values',
    fn: () => {
        const env = createMockEnv('0.5');
        const maxSize = getMaxRequestBodySize(env);
        assertEquals(maxSize, 0.5 * 1024 * 1024);
    },
});

// ============================================================================
// validateRequestSize Tests
// ============================================================================

Deno.test({
    name: 'validateRequestSize - accepts small request (Content-Length check)',
    fn: async () => {
        const env = createMockEnv();
        const request = createRequestWithBody(100);
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, true);
        assertEquals(result.maxBytes, 1024 * 1024);
    },
});

Deno.test({
    name: 'validateRequestSize - rejects request exceeding limit (Content-Length check)',
    fn: async () => {
        const env = createMockEnv();
        const request = createRequestWithBody(2 * 1024 * 1024); // 2MB
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, false);
        assertEquals(result.maxBytes, 1024 * 1024);
        assert(
            result.error?.includes('exceeds maximum allowed size'),
            'Error message should mention exceeding limit',
        );
    },
});

Deno.test({
    name: 'validateRequestSize - accepts request at exact limit',
    fn: async () => {
        const env = createMockEnv();
        const request = createRequestWithBody(1024 * 1024); // Exactly 1MB
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, true);
        assertEquals(result.maxBytes, 1024 * 1024);
    },
});

Deno.test({
    name: 'validateRequestSize - rejects request 1 byte over limit',
    fn: async () => {
        const env = createMockEnv();
        const request = createRequestWithBody(1024 * 1024 + 1); // 1MB + 1 byte
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, false);
        assertEquals(result.maxBytes, 1024 * 1024);
    },
});

Deno.test({
    name: 'validateRequestSize - uses custom limit from environment',
    fn: async () => {
        const env = createMockEnv('0.5'); // 0.5MB limit
        const request = createRequestWithBody(600 * 1024); // 600KB
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, false);
        assertEquals(result.maxBytes, 0.5 * 1024 * 1024);
    },
});

Deno.test({
    name: 'validateRequestSize - validates actual body size when no Content-Length',
    fn: async () => {
        const env = createMockEnv();
        const request = createRequestWithBody(100, false); // No Content-Length header
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, true);
        assertEquals(result.maxBytes, 1024 * 1024);
    },
});

Deno.test({
    name: 'validateRequestSize - rejects large body without Content-Length',
    fn: async () => {
        const env = createMockEnv();
        const request = createRequestWithBody(2 * 1024 * 1024, false); // 2MB, no Content-Length
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, false);
        assertEquals(result.maxBytes, 1024 * 1024);
    },
});

Deno.test({
    name: 'validateRequestSize - provides detailed error message with sizes',
    fn: async () => {
        const env = createMockEnv();
        const bodySize = 2 * 1024 * 1024;
        const request = createRequestWithBody(bodySize);
        const result = await validateRequestSize(request, env);

        assertEquals(result.valid, false);
        assert(result.error?.includes(String(bodySize)), 'Should include actual size');
        assert(result.error?.includes(String(1024 * 1024)), 'Should include max size');
    },
});

Deno.test({
    name: 'validateRequestSize - handles various configured limits',
    fn: async () => {
        // Test 0.1MB limit
        const env1 = createMockEnv('0.1');
        const request1 = createRequestWithBody(200 * 1024); // 200KB
        const result1 = await validateRequestSize(request1, env1);
        assertEquals(result1.valid, false);

        // Test 10MB limit
        const env2 = createMockEnv('10');
        const request2 = createRequestWithBody(5 * 1024 * 1024); // 5MB
        const result2 = await validateRequestSize(request2, env2);
        assertEquals(result2.valid, true);
    },
});

Deno.test({
    name: 'validateRequestSize - handles invalid Content-Length gracefully',
    fn: async () => {
        const env = createMockEnv();
        const request = new Request('https://example.com/compile', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': 'invalid',
            },
            body: 'x'.repeat(100),
        });
        const result = await validateRequestSize(request, env);

        // Should fall through to actual body size check
        assertEquals(result.valid, true);
    },
});

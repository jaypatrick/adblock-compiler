/**
 * Tests for CSRF protection middleware
 */

import { assertEquals } from '@std/assert';
import { generateCsrfToken, validateCsrfToken } from './index.ts';

Deno.test('CSRF: generateCsrfToken - should generate 64-character hex token', () => {
    const token = generateCsrfToken();

    assertEquals(typeof token, 'string');
    assertEquals(token.length, 64);
    assertEquals(/^[0-9a-f]{64}$/.test(token), true);
});

Deno.test('CSRF: generateCsrfToken - should generate unique tokens', () => {
    const token1 = generateCsrfToken();
    const token2 = generateCsrfToken();

    assertEquals(typeof token1, 'string');
    assertEquals(typeof token2, 'string');
    assertEquals(token1 === token2, false);
});

Deno.test('CSRF: validateCsrfToken - should return true when token matches cookie', () => {
    const token = 'test-token-12345';

    const request = new Request('https://example.com', {
        headers: {
            'X-CSRF-Token': token,
            'Cookie': `csrf-token=${token}`,
        },
    });

    const isValid = validateCsrfToken(request);
    assertEquals(isValid, true);
});

Deno.test('CSRF: validateCsrfToken - should return false when token is missing', () => {
    const request = new Request('https://example.com', {
        headers: {
            'Cookie': 'csrf-token=test-token-12345',
        },
    });

    const isValid = validateCsrfToken(request);
    assertEquals(isValid, false);
});

Deno.test('CSRF: validateCsrfToken - should return false when cookie is missing', () => {
    const request = new Request('https://example.com', {
        headers: {
            'X-CSRF-Token': 'test-token-12345',
        },
    });

    const isValid = validateCsrfToken(request);
    assertEquals(isValid, false);
});

Deno.test('CSRF: validateCsrfToken - should return false when token and cookie mismatch', () => {
    const request = new Request('https://example.com', {
        headers: {
            'X-CSRF-Token': 'token-1',
            'Cookie': 'csrf-token=token-2',
        },
    });

    const isValid = validateCsrfToken(request);
    assertEquals(isValid, false);
});

Deno.test('CSRF: validateCsrfToken - should return false when both are missing', () => {
    const request = new Request('https://example.com');

    const isValid = validateCsrfToken(request);
    assertEquals(isValid, false);
});

Deno.test('CSRF: validateCsrfToken - should handle multiple cookies correctly', () => {
    const token = 'my-csrf-token';

    const request = new Request('https://example.com', {
        headers: {
            'X-CSRF-Token': token,
            'Cookie': `session=abc123; csrf-token=${token}; user=john`,
        },
    });

    const isValid = validateCsrfToken(request);
    assertEquals(isValid, true);
});

Deno.test('CSRF: validateCsrfToken - should handle cookies with spaces', () => {
    const token = 'token-with-dashes';

    const request = new Request('https://example.com', {
        headers: {
            'X-CSRF-Token': token,
            'Cookie': `session=abc; csrf-token=${token}; user=john`,
        },
    });

    const isValid = validateCsrfToken(request);
    assertEquals(isValid, true);
});

/**
 * Tests for URL validation (SSRF protection)
 */

import { assertEquals, assertRejects } from '@std/assert';
import { isSafeUrl, validateUrlForSsrf } from './UrlValidator.ts';
import { ValidationError } from './ErrorUtils.ts';

Deno.test('UrlValidator - should allow valid public HTTP URLs', () => {
    const validUrls = [
        'http://example.com',
        'http://example.com/path',
        'http://example.com:8080/path',
        'http://subdomain.example.com',
    ];

    for (const url of validUrls) {
        validateUrlForSsrf(url); // Should not throw
        assertEquals(isSafeUrl(url), true);
    }
});

Deno.test('UrlValidator - should allow valid public HTTPS URLs', () => {
    const validUrls = [
        'https://example.com',
        'https://example.com/path',
        'https://example.com:443/path',
        'https://subdomain.example.com',
        'https://easylist.to/easylist/easylist.txt',
    ];

    for (const url of validUrls) {
        validateUrlForSsrf(url); // Should not throw
        assertEquals(isSafeUrl(url), true);
    }
});

Deno.test('UrlValidator - should block localhost', async () => {
    const localhostUrls = [
        'http://localhost',
        'http://localhost:8080',
        'https://localhost/path',
        'http://127.0.0.1',
        'http://127.0.0.1:8080',
        'http://127.0.0.2',
        'http://127.1.2.3',
        'http://0.0.0.0',
        'http://[::1]',
        'http://[::1]:8080',
        'http://[::]',
    ];

    for (const url of localhostUrls) {
        await assertRejects(
            async () => validateUrlForSsrf(url),
            ValidationError,
            'Localhost access is blocked',
        );
        assertEquals(isSafeUrl(url), false);
    }
});

Deno.test('UrlValidator - should block private IP ranges', async () => {
    const privateIpUrls = [
        // 10.0.0.0/8
        'http://10.0.0.1',
        'http://10.1.2.3',
        'http://10.255.255.255',
        // 172.16.0.0/12
        'http://172.16.0.1',
        'http://172.20.1.2',
        'http://172.31.255.255',
        // 192.168.0.0/16
        'http://192.168.0.1',
        'http://192.168.1.1',
        'http://192.168.255.255',
        // IPv6 Unique Local Addresses (fc00::/7)
        'http://[fc00::1]',
        'http://[fd00::1]',
        'http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    ];

    for (const url of privateIpUrls) {
        await assertRejects(
            async () => validateUrlForSsrf(url),
            ValidationError,
            'Private IP access is blocked',
        );
        assertEquals(isSafeUrl(url), false);
    }
});

Deno.test('UrlValidator - should block link-local addresses', async () => {
    const linkLocalUrls = [
        // IPv4 link-local (169.254.0.0/16)
        'http://169.254.0.1',
        'http://169.254.1.1',
        'http://169.254.255.255',
        // IPv6 link-local (fe80::/10)
        'http://[fe80::1]',
        'http://[fe80::abcd:1234]',
        'http://[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    ];

    for (const url of linkLocalUrls) {
        await assertRejects(
            async () => validateUrlForSsrf(url),
            ValidationError,
            'Link-local address access is blocked',
        );
        assertEquals(isSafeUrl(url), false);
    }
});

Deno.test('UrlValidator - should block non-HTTP protocols', async () => {
    const unsafeProtocolUrls = [
        'file:///etc/passwd',
        'ftp://example.com',
        'gopher://example.com',
        'data:text/plain,hello',
        'javascript:alert(1)',
        'ws://example.com',
        'wss://example.com',
    ];

    for (const url of unsafeProtocolUrls) {
        await assertRejects(
            async () => validateUrlForSsrf(url),
            ValidationError,
            'Unsafe protocol',
        );
        assertEquals(isSafeUrl(url), false);
    }
});

Deno.test('UrlValidator - should reject invalid URLs', async () => {
    const invalidUrls = [
        'not a url',
        'htp://example.com', // typo in protocol
        '://example.com',
        '',
    ];

    for (const url of invalidUrls) {
        await assertRejects(
            async () => validateUrlForSsrf(url),
            ValidationError,
            'Invalid URL format',
        );
        assertEquals(isSafeUrl(url), false);
    }
});

Deno.test('UrlValidator - should not block public IPs', () => {
    const publicIpUrls = [
        'http://1.1.1.1', // Cloudflare DNS
        'http://8.8.8.8', // Google DNS
        'http://93.184.216.34', // example.com
        'http://151.101.1.140', // Reddit
        'http://172.15.0.1', // Just outside 172.16.0.0/12
        'http://172.32.0.1', // Just outside 172.16.0.0/12
        'http://11.0.0.1', // Just outside 10.0.0.0/8
        'http://9.255.255.255', // Just outside 10.0.0.0/8
        'http://192.167.255.255', // Just outside 192.168.0.0/16
        'http://192.169.0.1', // Just outside 192.168.0.0/16
        'http://169.253.255.255', // Just outside 169.254.0.0/16
        'http://169.255.0.1', // Just outside 169.254.0.0/16
    ];

    for (const url of publicIpUrls) {
        validateUrlForSsrf(url); // Should not throw
        assertEquals(isSafeUrl(url), true);
    }
});

Deno.test('UrlValidator - should handle edge cases', () => {
    // URLs with ports
    validateUrlForSsrf('https://example.com:443');
    validateUrlForSsrf('http://example.com:80');

    // URLs with paths and query strings
    validateUrlForSsrf('https://example.com/path/to/resource?query=value');
    validateUrlForSsrf('https://example.com/path#fragment');

    // URLs with userinfo (username/password - discouraged but valid)
    validateUrlForSsrf('https://user:pass@example.com');

    assertEquals(isSafeUrl('https://example.com:443'), true);
});

Deno.test('UrlValidator - should handle IPv6 edge cases', async () => {
    // Valid public IPv6
    validateUrlForSsrf('http://[2001:4860:4860::8888]'); // Google DNS
    assertEquals(isSafeUrl('http://[2001:4860:4860::8888]'), true);

    // Invalid IPv6 loopback
    await assertRejects(
        async () => validateUrlForSsrf('http://[0:0:0:0:0:0:0:1]'),
        ValidationError,
    );

    // IPv6 site-local (deprecated but still blocked)
    await assertRejects(
        async () => validateUrlForSsrf('http://[fec0::1]'),
        ValidationError,
        'Private IP access is blocked',
    );
});

/**
 * Tests for cookie utilities
 */

import { assertEquals } from '@std/assert';
import { getCookie, setCookie } from './cookies.ts';

Deno.test('Cookies: getCookie - should retrieve cookie value', () => {
    const request = new Request('https://example.com', {
        headers: {
            'Cookie': 'name=value',
        },
    });

    const value = getCookie(request, 'name');
    assertEquals(value, 'value');
});

Deno.test('Cookies: getCookie - should return undefined for missing cookie', () => {
    const request = new Request('https://example.com', {
        headers: {
            'Cookie': 'name=value',
        },
    });

    const value = getCookie(request, 'missing');
    assertEquals(value, undefined);
});

Deno.test('Cookies: getCookie - should return undefined when no Cookie header', () => {
    const request = new Request('https://example.com');

    const value = getCookie(request, 'name');
    assertEquals(value, undefined);
});

Deno.test('Cookies: getCookie - should handle multiple cookies', () => {
    const request = new Request('https://example.com', {
        headers: {
            'Cookie': 'session=abc123; user=john; csrf-token=xyz789',
        },
    });

    assertEquals(getCookie(request, 'session'), 'abc123');
    assertEquals(getCookie(request, 'user'), 'john');
    assertEquals(getCookie(request, 'csrf-token'), 'xyz789');
});

Deno.test('Cookies: getCookie - should handle cookies with spaces', () => {
    const request = new Request('https://example.com', {
        headers: {
            'Cookie': 'name1=value1;  name2=value2;   name3=value3',
        },
    });

    assertEquals(getCookie(request, 'name2'), 'value2');
});

Deno.test('Cookies: getCookie - should handle cookie values containing equals signs', () => {
    const request = new Request('https://example.com', {
        headers: {
            'Cookie': 'token=abc=def=ghi',
        },
    });

    assertEquals(getCookie(request, 'token'), 'abc=def=ghi');
});

Deno.test('Cookies: setCookie - should create basic cookie', () => {
    const cookie = setCookie('name', 'value');
    assertEquals(cookie, 'name=value');
});

Deno.test('Cookies: setCookie - should include maxAge', () => {
    const cookie = setCookie('name', 'value', { maxAge: 3600 });
    assertEquals(cookie, 'name=value; Max-Age=3600');
});

Deno.test('Cookies: setCookie - should include path', () => {
    const cookie = setCookie('name', 'value', { path: '/' });
    assertEquals(cookie, 'name=value; Path=/');
});

Deno.test('Cookies: setCookie - should include domain', () => {
    const cookie = setCookie('name', 'value', { domain: 'example.com' });
    assertEquals(cookie, 'name=value; Domain=example.com');
});

Deno.test('Cookies: setCookie - should include secure flag', () => {
    const cookie = setCookie('name', 'value', { secure: true });
    assertEquals(cookie, 'name=value; Secure');
});

Deno.test('Cookies: setCookie - should include httpOnly flag', () => {
    const cookie = setCookie('name', 'value', { httpOnly: true });
    assertEquals(cookie, 'name=value; HttpOnly');
});

Deno.test('Cookies: setCookie - should include sameSite', () => {
    assertEquals(
        setCookie('name', 'value', { sameSite: 'Strict' }),
        'name=value; SameSite=Strict',
    );
    assertEquals(
        setCookie('name', 'value', { sameSite: 'Lax' }),
        'name=value; SameSite=Lax',
    );
    assertEquals(
        setCookie('name', 'value', { sameSite: 'None' }),
        'name=value; SameSite=None',
    );
});

Deno.test('Cookies: setCookie - should include all options', () => {
    const cookie = setCookie('csrf-token', 'abc123', {
        maxAge: 3600,
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'Lax',
    });

    assertEquals(cookie, 'csrf-token=abc123; Max-Age=3600; Path=/; Secure; SameSite=Lax');
});

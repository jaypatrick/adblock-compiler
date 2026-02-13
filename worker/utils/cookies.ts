/**
 * Cookie utilities for the Cloudflare Worker.
 * Provides functions for parsing and setting cookies.
 */

/**
 * Parse a cookie value from the request Cookie header.
 *
 * @param request - The incoming request
 * @param name - The name of the cookie to retrieve
 * @returns The cookie value if found, undefined otherwise
 */
export function getCookie(request: Request, name: string): string | undefined {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) return undefined;

    const cookies = cookieHeader.split(';').map((c) => c.trim());
    const cookie = cookies.find((c) => c.startsWith(`${name}=`));
    return cookie?.split('=')[1];
}

/**
 * Options for setting a cookie
 */
export interface SetCookieOptions {
    /** Max age in seconds */
    maxAge?: number;
    /** Domain for the cookie */
    domain?: string;
    /** Path for the cookie */
    path?: string;
    /** Whether to set Secure flag */
    secure?: boolean;
    /** Whether to set HttpOnly flag */
    httpOnly?: boolean;
    /** SameSite policy */
    sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Generate a Set-Cookie header value.
 *
 * @param name - The name of the cookie
 * @param value - The value of the cookie
 * @param options - Cookie options
 * @returns The Set-Cookie header value
 */
export function setCookie(
    name: string,
    value: string,
    options: SetCookieOptions = {},
): string {
    const parts = [`${name}=${value}`];

    if (options.maxAge !== undefined) {
        parts.push(`Max-Age=${options.maxAge}`);
    }

    if (options.domain) {
        parts.push(`Domain=${options.domain}`);
    }

    if (options.path) {
        parts.push(`Path=${options.path}`);
    }

    if (options.secure) {
        parts.push('Secure');
    }

    if (options.httpOnly) {
        parts.push('HttpOnly');
    }

    if (options.sameSite) {
        parts.push(`SameSite=${options.sameSite}`);
    }

    return parts.join('; ');
}

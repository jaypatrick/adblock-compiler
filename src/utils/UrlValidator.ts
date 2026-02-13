/**
 * URL validation utilities for preventing SSRF (Server-Side Request Forgery) attacks.
 * Validates URLs before fetching to ensure they don't target internal network resources.
 */

import { ValidationError } from './ErrorUtils.ts';

/**
 * Checks if a hostname is localhost
 */
function isLocalhost(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return lower === 'localhost' ||
        lower === '127.0.0.1' ||
        lower === '::1' ||
        lower === '0.0.0.0' ||
        lower.startsWith('127.') || // 127.0.0.0/8
        lower === '[::1]' || // IPv6 localhost with brackets
        lower === '[::]'; // IPv6 unspecified address with brackets
}

/**
 * Checks if an IP address is in a private range
 * Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 */
function isPrivateIp(hostname: string): boolean {
    // Remove brackets for IPv6
    const ip = hostname.replace(/^\[|\]$/g, '');

    // Check IPv4 private ranges
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        const parts = ip.split('.').map(Number);

        // 10.0.0.0/8
        if (parts[0] === 10) return true;

        // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

        // 192.168.0.0/16
        if (parts[0] === 192 && parts[1] === 168) return true;
    }

    // Check IPv6 private ranges (Unique Local Addresses fc00::/7)
    if (ip.includes(':')) {
        const lower = ip.toLowerCase();
        // ULA: fc00::/7 (fc00:: - fdff::)
        if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
        // Site-local (deprecated but still checked): fec0::/10
        if (lower.startsWith('fec') || lower.startsWith('fed') || lower.startsWith('fee') || lower.startsWith('fef')) return true;
    }

    return false;
}

/**
 * Checks if an IP address is link-local
 * Link-local IPv4: 169.254.0.0/16
 * Link-local IPv6: fe80::/10
 */
function isLinkLocal(hostname: string): boolean {
    // Remove brackets for IPv6
    const ip = hostname.replace(/^\[|\]$/g, '');

    // IPv4 link-local: 169.254.0.0/16
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        const parts = ip.split('.').map(Number);
        if (parts[0] === 169 && parts[1] === 254) return true;
    }

    // IPv6 link-local: fe80::/10
    if (ip.includes(':')) {
        const lower = ip.toLowerCase();
        if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
            return true;
        }
    }

    return false;
}

/**
 * Checks if a protocol is safe for HTTP requests
 * Only http: and https: are allowed
 */
function isSafeProtocol(protocol: string): boolean {
    return protocol === 'http:' || protocol === 'https:';
}

/**
 * Validates a URL to prevent SSRF attacks
 * Blocks:
 * - localhost and loopback addresses
 * - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
 * - Link-local addresses (169.254.x, fe80::/10)
 * - Non-HTTP/HTTPS protocols
 *
 * @param url - URL to validate
 * @throws {ValidationError} if URL is not safe
 */
export function validateUrlForSsrf(url: string): void {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch (error) {
        throw new ValidationError(
            `Invalid URL format: ${url}`,
            'url',
            ['URL could not be parsed'],
        );
    }

    // Check protocol
    if (!isSafeProtocol(parsed.protocol)) {
        throw new ValidationError(
            `Unsafe protocol: ${parsed.protocol}. Only http: and https: are allowed.`,
            'url.protocol',
            [`Protocol '${parsed.protocol}' is not allowed for security reasons`],
        );
    }

    const hostname = parsed.hostname;

    // Check for localhost
    if (isLocalhost(hostname)) {
        throw new ValidationError(
            `Localhost access is blocked: ${hostname}`,
            'url.hostname',
            ['Access to localhost and loopback addresses is not allowed for security reasons'],
        );
    }

    // Check for private IPs
    if (isPrivateIp(hostname)) {
        throw new ValidationError(
            `Private IP access is blocked: ${hostname}`,
            'url.hostname',
            ['Access to private IP ranges (10.x, 172.16-31.x, 192.168.x, fc00::/7) is not allowed for security reasons'],
        );
    }

    // Check for link-local addresses
    if (isLinkLocal(hostname)) {
        throw new ValidationError(
            `Link-local address access is blocked: ${hostname}`,
            'url.hostname',
            ['Access to link-local addresses (169.254.x, fe80::/10) is not allowed for security reasons'],
        );
    }
}

/**
 * Checks if a URL is safe for fetching (does not throw)
 * @param url - URL to check
 * @returns true if URL is safe, false otherwise
 */
export function isSafeUrl(url: string): boolean {
    try {
        validateUrlForSsrf(url);
        return true;
    } catch {
        return false;
    }
}

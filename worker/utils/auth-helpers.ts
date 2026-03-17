/**
 * Auth helper utilities for the Cloudflare Worker.
 * Provides timing-safe comparison and admin auth verification.
 */

import type { Env } from '../types.ts';

/**
 * Constant-time string comparison using HMAC-SHA-256 to prevent timing attacks.
 *
 * A static, non-secret HMAC key is intentional here: the purpose is purely to
 * make the comparison time-independent of the content (i.e., prevent timing
 * oracles), not to add cryptographic confidentiality. The actual secret being
 * protected is the admin key compared at the call site. Using a static key is
 * an established pattern for this use case (see e.g. Node.js `timingSafeEqual`
 * wrappers) and does not leak any sensitive material.
 */
export async function timingSafeCompareWorker(a: string, b: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode('timing-safe-compare-key');
    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const aMac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(a)));
    const bMac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(b)));
    if (aMac.length !== bMac.length) return false;
    let result = 0;
    for (let i = 0; i < aMac.length; i++) {
        result |= aMac[i] ^ bMac[i];
    }
    return result === 0;
}

/**
 * Verify admin authentication via the X-Admin-Key request header.
 * Returns { authorized: true } on success, { authorized: false, error } on failure.
 */
export async function verifyAdminAuth(
    request: Request,
    env: Env,
): Promise<{ authorized: boolean; error?: string }> {
    const adminKey = request.headers.get('X-Admin-Key');

    if (!env.ADMIN_KEY) {
        return { authorized: false, error: 'Admin features not configured' };
    }

    if (!adminKey) {
        return { authorized: false, error: 'Unauthorized' };
    }

    const matches = await timingSafeCompareWorker(adminKey, env.ADMIN_KEY);
    if (!matches) {
        return { authorized: false, error: 'Unauthorized' };
    }

    return { authorized: true };
}

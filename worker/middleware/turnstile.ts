/**
 * Cloudflare Turnstile verification middleware.
 * Provides human verification for public write endpoints.
 *
 * ZTA: Turnstile protects /compile*, /validate, /ast/parse, /ws/compile.
 * Verification is skipped when TURNSTILE_SECRET_KEY is not configured.
 */

import type { Env } from '../types.ts';

/**
 * Response from the Cloudflare Turnstile verification API.
 */
export interface TurnstileVerifyResponse {
    success: boolean;
    challenge_ts?: string;
    hostname?: string;
    'error-codes'?: string[];
    action?: string;
    cdata?: string;
}

/**
 * Verify a Cloudflare Turnstile token.
 *
 * Returns `{ success: true }` when TURNSTILE_SECRET_KEY is not configured
 * (verification is bypassed — useful for local development).
 */
export async function verifyTurnstileToken(
    env: Env,
    token: string,
    ip: string,
): Promise<{ success: boolean; error?: string }> {
    if (!env.TURNSTILE_SECRET_KEY) {
        return { success: true };
    }

    if (!token) {
        return { success: false, error: 'Missing Turnstile token' };
    }

    try {
        const formData = new FormData();
        formData.append('secret', env.TURNSTILE_SECRET_KEY);
        formData.append('response', token);
        formData.append('remoteip', ip);

        const response = await fetch(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            {
                method: 'POST',
                body: formData,
            },
        );

        const result = await response.json() as TurnstileVerifyResponse;

        if (result.success) {
            return { success: true };
        }

        const errorCodes = result['error-codes'] || [];
        return {
            success: false,
            error: `Turnstile verification failed: ${errorCodes.join(', ') || 'unknown error'}`,
        };
    } catch (error) {
        // deno-lint-ignore no-console
        console.error('Turnstile verification error:', error);
        return {
            success: false,
            error: 'Turnstile verification service unavailable',
        };
    }
}

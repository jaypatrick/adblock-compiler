/**
 * Public Auth Providers Endpoint — GET /api/auth/providers
 *
 * Returns which authentication methods are currently available to the frontend.
 * This is a PUBLIC endpoint (no auth required) — the frontend calls it on startup
 * to conditionally render social login buttons.
 *
 * Response shape:
 * ```json
 * {
 *   "emailPassword": true,
 *   "github": false,
 *   "google": false,
 *   "mfa": true
 * }
 * ```
 *
 * @see frontend/src/app/services/better-auth.service.ts — consumes this endpoint
 * @see docs/auth/social-providers.md — setup instructions
 */

import type { Env } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';

export function handleAuthProviders(_request: Request, env: Env): Response {
    return JsonResponse.success({
        /** Email + password login is always available. */
        emailPassword: true,
        /** GitHub OAuth is active when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are configured. */
        github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        /**
         * Google OAuth — reserved for a future release.
         * Wire is present but will always return false until activated.
         */
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        /** TOTP-based 2FA is always active via the twoFactor() Better Auth plugin. */
        mfa: true,
    });
}

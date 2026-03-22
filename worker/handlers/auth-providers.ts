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
         * Hard-coded false: the provider block in worker/lib/auth.ts is commented
         * out, so even if GOOGLE_CLIENT_ID/SECRET are set the provider is inactive.
         * Activate by uncommenting the google block in createAuth() and removing
         * the hard-coded `false` here.
         */
        google: false,
        /** TOTP-based 2FA is always active via the twoFactor() Better Auth plugin. */
        mfa: true,
    });
}

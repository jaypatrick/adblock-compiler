/**
 * Better Auth Configuration Factory
 *
 * Creates a Better Auth instance configured for Cloudflare Workers + Prisma
 * backed by Neon PostgreSQL via Cloudflare Hyperdrive.
 *
 * ## Database adapter
 * Uses `prismaAdapter` from `better-auth/adapters/prisma` with a PrismaClient
 * created per request via {@link createPrismaClient}. Hyperdrive IS the
 * connection pool — it proxies connections locally, so per-request
 * instantiation connects to a local proxy socket, not directly to PostgreSQL.
 *
 * ## Per-request factory pattern
 * Cloudflare Workers expose bindings via `env`, which is only available
 * inside the fetch handler. This factory creates a fresh auth instance per
 * request, passing the live `env.HYPERDRIVE` binding.
 *
 * ## Plugin extensibility
 * The `plugins` array is ready for future additions:
 *   - `twoFactor()` — TOTP/2FA
 *   - `admin()` — built-in admin plugin
 *   - `apiKey()` — API key management
 *   - `multiSession()` — multiple active sessions
 *   - `organization()` — multi-tenancy
 *
 * @see https://better-auth.com/docs/concepts/database
 * @see https://better-auth.com/docs/adapters/prisma
 * @see https://better-auth.com/docs/integrations/hono
 * @see worker/middleware/better-auth-provider.ts — IAuthProvider implementation
 */

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin, bearer, multiSession, organization, twoFactor } from 'better-auth/plugins';
import type { Env } from '../types.ts';
import { createPrismaClient } from './prisma.ts';

/**
 * Session duration constants — single source of truth consumed by both
 * {@link createAuth} and the admin `/admin/auth/config` inspector endpoint.
 * Changing these values here automatically propagates to both.
 */
export const AUTH_SESSION_CONFIG = {
    /** Session expiry in seconds (7 days). */
    expiresIn: 60 * 60 * 24 * 7,
    /** Refresh session token when this many seconds remain (1 day). */
    updateAge: 60 * 60 * 24,
    /** Cookie-level session cache duration in seconds (5 minutes). */
    cookieCacheMaxAge: 60 * 5,
} as const;

/**
 * Thrown when a required Worker binding or secret is absent at startup.
 *
 * Using a named subclass ensures `error.name === 'WorkerConfigurationError'`
 * so that callers which only log `error.name` (e.g. BetterAuthProvider) can
 * distinguish configuration failures from authentication failures without
 * having to parse message strings.
 */
export class WorkerConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorkerConfigurationError';
    }
}

/**
 * Create a Better Auth instance bound to the current request's environment.
 *
 * Uses the Prisma adapter backed by Neon PostgreSQL via Hyperdrive.
 * A fresh PrismaClient is created per request using the Hyperdrive
 * connection string — this is safe because Hyperdrive proxies locally.
 *
 * @param env - Cloudflare Worker environment bindings (must include HYPERDRIVE and BETTER_AUTH_SECRET)
 * @param baseURL - The base URL for the auth endpoints (derived from the request)
 * @returns Configured Better Auth instance
 */
export function createAuth(env: Env, baseURL?: string) {
    if (!env.HYPERDRIVE?.connectionString) {
        throw new WorkerConfigurationError(
            'HYPERDRIVE binding is not configured.\n' +
                '  → Production: add [[hyperdrive]] to wrangler.toml\n' +
                '  → Local dev:  set WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE (preferred)\n' +
                '                or CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE in .dev.vars',
        );
    }
    if (!env.BETTER_AUTH_SECRET) {
        throw new WorkerConfigurationError(
            'BETTER_AUTH_SECRET is required but not set.\n' +
                '  → Generate one: openssl rand -base64 32\n' +
                '  → Then add it to .dev.vars (local) or wrangler secret put BETTER_AUTH_SECRET (production)',
        );
    }

    const prisma = createPrismaClient(env.HYPERDRIVE.connectionString);

    // Build social providers object — only include providers whose credentials are configured.
    const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {};
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
        socialProviders.github = {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
        };
    }
    // Google is wired but NOT exposed in the UI — activate later by setting
    // GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in wrangler secrets:
    // if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    //     socialProviders.google = {
    //         clientId: env.GOOGLE_CLIENT_ID,
    //         clientSecret: env.GOOGLE_CLIENT_SECRET,
    //     };
    // }

    return betterAuth({
        database: prismaAdapter(prisma, { provider: 'postgresql' }),
        secret: env.BETTER_AUTH_SECRET,
        basePath: '/api/auth',
        baseURL: env.BETTER_AUTH_URL || baseURL,

        socialProviders,

        emailAndPassword: {
            enabled: true,
        },

        user: {
            additionalFields: {
                tier: {
                    type: 'string',
                    required: false,
                    defaultValue: 'free',
                    input: false, // prevent users from self-assigning tier
                },
                role: {
                    type: 'string',
                    required: false,
                    defaultValue: 'user',
                    input: false, // prevent users from self-assigning role
                },
            },
        },

        session: {
            // 7-day session expiry
            expiresIn: AUTH_SESSION_CONFIG.expiresIn,
            // Refresh session if it expires within 1 day
            updateAge: AUTH_SESSION_CONFIG.updateAge,
            cookieCache: {
                enabled: true,
                maxAge: AUTH_SESSION_CONFIG.cookieCacheMaxAge,
            },
        },
        advanced: {
            // ⚠️ BREAKING: changing this prefix renames all Better Auth cookies and
            // forcibly logs out every existing session on the next request.
            cookiePrefix: 'bloqr',
            defaultCookieAttributes: {
                httpOnly: true,
                secure: true,
                sameSite: 'lax', // 'lax' allows OAuth redirects; 'strict' blocks them
                path: '/',
            },
            // ── Cloudflare reverse proxy IP extraction ────────────────────────────
            // Without this, Better Auth cannot determine the real client IP and its
            // built-in rate limiter (brute-force protection on /sign-in, /sign-up,
            // /two-factor/*) silently skips ALL rate limiting. CF-Connecting-IP is
            // injected by Cloudflare's edge and is the authoritative client IP.
            // X-Forwarded-For is included as fallback for local dev / wrangler dev.
            ipAddress: {
                ipAddressHeaders: ['CF-Connecting-IP', 'X-Forwarded-For'],
            },
        },

        plugins: [
            // Bearer token plugin — allows API authentication via Authorization: Bearer <token>
            // instead of browser cookies. Critical for this project's API-first architecture.
            bearer(),
            // TOTP-based two-factor authentication — auto-exposes:
            //   POST /api/auth/two-factor/enable   — generate TOTP secret + QR URI
            //   POST /api/auth/two-factor/verify    — verify TOTP code (enables 2FA)
            //   POST /api/auth/two-factor/disable   — remove 2FA for the current user
            // ⚠️ BREAKING: changing the issuer label updates the otpauth URI and
            // invalidates every existing authenticator-app TOTP registration.
            // Users must re-enroll their 2FA device after this change is deployed.
            twoFactor({
                issuer: 'bloqr',
            }),
            // Multi-session management — auto-exposes:
            //   GET    /api/auth/list-sessions                — list all active sessions
            //   POST   /api/auth/revoke-session               — revoke a specific session
            //   POST   /api/auth/revoke-other-sessions        — revoke all except current
            multiSession(),
            // Better Auth admin plugin — auto-exposes:
            //   GET    /api/auth/admin/list-users        — list all users
            //   POST   /api/auth/admin/set-role          — change user role
            //   POST   /api/auth/admin/ban-user          — ban a user
            //   POST   /api/auth/admin/unban-user        — unban a user
            //   POST   /api/auth/admin/impersonate-user  — impersonate a user
            //   POST   /api/auth/admin/revoke-user-sessions — revoke sessions
            admin(),
            // Organization plugin — multi-tenancy support, auto-exposes:
            //   POST   /api/auth/organization/create                    — create organization
            //   POST   /api/auth/organization/invite-member             — invite user to org
            //   POST   /api/auth/organization/remove-member             — remove member
            //   POST   /api/auth/organization/update-member-role        — change member role
            //   GET    /api/auth/organization/list-organizations        — list user's orgs
            //   GET    /api/auth/organization/get-full-organization     — get org details
            //   POST   /api/auth/organization/leave-organization        — leave org
            //   POST   /api/auth/organization/delete-organization       — delete org (owner only)
            //   POST   /api/auth/organization/update-organization       — update org metadata
            //   GET    /api/auth/organization/get-active-organization   — get current active org
            //   POST   /api/auth/organization/set-active-organization   — set active org
            organization({
                // Allow any authenticated user to create an organization
                allowUserToCreateOrganization: true,
                // Limit each user to 3 organizations (owner role)
                organizationLimit: 3,
                // Default member roles: owner, admin, member
                // Owners can manage all aspects; admins can manage members; members are read-only
            }),
            // Future plugins (uncomment when needed):
            // apiKey(),       — Built-in API key management (we use custom impl)
        ],
    });
}

/** Inferred type of a Better Auth instance created by createAuth. */
export type Auth = ReturnType<typeof createAuth>;

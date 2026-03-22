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
import { bearer, multiSession, twoFactor } from 'better-auth/plugins';
import type { Env } from '../types.ts';
import { createPrismaClient } from './prisma.ts';

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

/** OAuth client credential pair used by Better Auth's social provider config. */
interface OAuthClientCredentials {
    clientId: string;
    clientSecret: string;
}

/** Shape of Better Auth's `socialProviders` config object. */
interface SocialProviderConfig {
    github?: OAuthClientCredentials;
    // google?: OAuthClientCredentials;  // Uncomment when Google is activated
}

/**
 * Build the socialProviders config from environment variables.
 *
 * GitHub is active when both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set.
 * Google is wired but commented-out — uncomment and set env vars to activate.
 */
function buildSocialProviders(env: Env): { socialProviders?: SocialProviderConfig } {
    const providers: SocialProviderConfig = {};

    // GitHub OAuth — activate by setting GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
    // Callback URL: <BETTER_AUTH_URL>/api/auth/callback/github
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
        providers.github = {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
        };
    }

    // Google OAuth — reserved for future activation.
    // To enable: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then uncomment below.
    // if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    //     providers.google = {
    //         clientId: env.GOOGLE_CLIENT_ID,
    //         clientSecret: env.GOOGLE_CLIENT_SECRET,
    //     };
    // }

    return Object.keys(providers).length > 0 ? { socialProviders: providers } : {};
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

    return betterAuth({
        database: prismaAdapter(prisma, { provider: 'postgresql' }),
        secret: env.BETTER_AUTH_SECRET,
        basePath: '/api/auth',
        baseURL: env.BETTER_AUTH_URL || baseURL,

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
            expiresIn: 60 * 60 * 24 * 7,
            // Refresh session if it expires within 1 day
            updateAge: 60 * 60 * 24,
            cookieCache: {
                enabled: true,
                maxAge: 60 * 5, // 5-minute cookie cache
            },
        },
        advanced: {
            cookiePrefix: 'adblock',
            defaultCookieAttributes: {
                httpOnly: true,
                secure: true,
                sameSite: 'lax', // 'lax' allows OAuth redirects; 'strict' blocks them
                path: '/',
            },
        },

        ...(buildSocialProviders(env)),

        plugins: [
            // Bearer token plugin — allows API authentication via Authorization: Bearer <token>
            // instead of browser cookies. Critical for this project's API-first architecture.
            bearer(),
            // TOTP-based two-factor authentication — auto-exposes:
            //   POST /api/auth/two-factor/enable   — generate TOTP secret + QR URI
            //   POST /api/auth/two-factor/verify    — verify TOTP code (enables 2FA)
            //   POST /api/auth/two-factor/disable   — remove 2FA for the current user
            twoFactor({
                issuer: 'adblock-compiler',
            }),
            // Multi-session management — auto-exposes:
            //   GET    /api/auth/list-sessions                — list all active sessions
            //   POST   /api/auth/revoke-session               — revoke a specific session
            //   POST   /api/auth/revoke-other-sessions        — revoke all except current
            multiSession(),
            // Future plugins (uncomment when needed):
            // admin(),        — Better Auth's admin user management
            // apiKey(),       — Built-in API key management (we use custom impl)
            // organization(), — Multi-tenancy
        ],
    });
}

/** Inferred type of a Better Auth instance created by createAuth. */
export type Auth = ReturnType<typeof createAuth>;

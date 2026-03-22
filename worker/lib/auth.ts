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
import { bearer } from 'better-auth/plugins';
import type { Env } from '../types.ts';
import { createPrismaClient } from './prisma.ts';

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
    const prisma = createPrismaClient(env.HYPERDRIVE!.connectionString);

    return betterAuth({
        database: prismaAdapter(prisma, { provider: 'postgresql' }),
        secret: env.BETTER_AUTH_SECRET!,
        basePath: '/api/auth',
        baseURL,

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
        },

        plugins: [
            // Bearer token plugin — allows API authentication via Authorization: Bearer <token>
            // instead of browser cookies. Critical for this project's API-first architecture.
            bearer(),
            // Future plugins (uncomment when needed):
            // twoFactor(),    — TOTP/2FA for admin accounts
            // admin(),        — Better Auth's admin user management
            // apiKey(),       — Built-in API key management
            // multiSession(), — Multiple active sessions per user
            // organization(), — Multi-tenancy
        ],
    });
}

/** Inferred type of a Better Auth instance created by createAuth. */
export type Auth = ReturnType<typeof createAuth>;

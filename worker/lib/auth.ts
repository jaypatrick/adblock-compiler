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
 * The `plugins` array ships with the following active plugins:
 *   - `dash()` — Better Auth Dash dashboard integration (from `@better-auth/infra`); `BETTER_AUTH_API_KEY` is only required for Dash connectivity, and the plugin is expected to no-op when the key is unset
 *   - `bearer()` — API-first Bearer token auth
 *   - `twoFactor()` — TOTP/2FA
 *   - `multiSession()` — multiple active sessions
 *   - `admin()` — built-in admin plugin
 *   - `organization()` — multi-tenancy
 *
 * Inactive (available but not wired):
 *   - `apiKey()` — built-in API key management (we use a custom implementation)
 *
 * ## @better-auth/infra import — ESM/CDN compatibility notes
 *
 * The `dash()` plugin ships in `@better-auth/infra` (npm). The following
 * approaches were evaluated for Deno/Cloudflare Workers compatibility:
 *
 *  1. CDN ESM import — `import { dash } from 'https://esm.sh/@better-auth/infra?target=deno'`
 *     ❌ Not viable: wrangler uses esbuild to bundle the Worker. esbuild does not
 *        support `https://` URL specifiers — it can resolve bare specifiers and
 *        relative/absolute file paths, but not network URLs. The CDN import fails
 *        at build time with "Could not resolve".
 *
 *  2. Wrangler alias config — `[build.alias] "@better-auth/infra" = "…"`
 *     ❌ Not viable: wrangler aliases map to local file paths, not CDN URLs.
 *        A local vendor file would still import `better-auth`, `@better-fetch/fetch`,
 *        etc. via bare specifiers, requiring those to be resolved from node_modules too.
 *
 *  3. Vendor the full package locally — copy dist/index.mjs into worker/vendor/
 *     ❌ Not viable: `@better-auth/infra@0.2.5/dist/index.mjs` is ~7,900 lines with
 *        transitive bare-specifier imports (`@better-fetch/fetch`, `libphonenumber-js`,
 *        `better-auth/api`, `@better-auth/core/context`, `jose`, `zod`). A full vendor
 *        would require vendoring all transitive dependencies — effectively a sub-registry.
 *
 *  4. Add to package.json + pnpm install (chosen approach) ✅
 *     The package is already declared in `deno.json` imports as
 *     `"@better-auth/infra": "npm:@better-auth/infra@^0.2.5"`. Adding it to
 *     `package.json` as well is required so wrangler's esbuild bundler can resolve
 *     the bare specifier via `node_modules` (managed by pnpm). Both entry points
 *     (Deno and wrangler) then see the same package version.
 *     No secret or auth logic changes — `BETTER_AUTH_API_KEY` stays a Worker Secret.
 *
 * Recommendations for future improvement:
 *   - File an issue with @better-auth requesting a Deno/Cloudflare Workers ESM-only
 *     publish target compatible with URL imports (deno.land/x or jsr.io).
 *   - Track: https://github.com/better-auth/better-auth/issues
 *
 * @see https://better-auth.com/docs/concepts/database
 * @see https://better-auth.com/docs/adapters/prisma
 * @see https://better-auth.com/docs/integrations/hono
 * @see worker/middleware/better-auth-provider.ts — IAuthProvider implementation
 */

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin, bearer, multiSession, organization, twoFactor } from 'better-auth/plugins';
// @better-auth/infra is declared in deno.json imports as "npm:@better-auth/infra@^0.2.5"
// and added to package.json so wrangler/esbuild can resolve it from node_modules.
// See the ESM/CDN compatibility notes in the module JSDoc above.
import { dash } from '@better-auth/infra';
import type { Env } from '../types.ts';
import { createPrismaClient } from './prisma.ts';
import { FROM_ADDRESS_CRITICAL, ResendEmailService } from '../services/email-service.ts';
import { renderEmailVerification, renderPasswordReset } from '../services/email-templates.ts';

/**
 * Better Auth → Prisma field name mapping for the `User` model.
 *
 * Better Auth's canonical user shape uses `name` and `image`, but the Prisma
 * `User` model exposes `displayName` (column `display_name`) and `imageUrl`
 * (column `image_url`). Without this mapping, Better Auth passes the wrong
 * field names to Prisma, causing `PrismaClientValidationError: Unknown
 * argument 'name'` / `Unknown argument 'image'` on every sign-up or
 * OAuth/profile-sync flow.
 *
 * Exported as a named constant so regression tests can assert the mapping
 * without requiring a real Hyperdrive / PostgreSQL connection.
 */
export const USER_FIELD_MAPPING = {
    name: 'displayName', // Better Auth 'name'  → Prisma 'displayName' (display_name column)
    image: 'imageUrl', // Better Auth 'image' → Prisma 'imageUrl'     (image_url column)
} as const;

/**
 * UUID v4 regex used to validate Better Auth–generated IDs against PostgreSQL's
 * `uuid` column type.  Exported so regression tests can assert the same pattern
 * without requiring a database connection.
 *
 * PostgreSQL's `uuid` type requires the canonical 8-4-4-4-12 lower-hex format:
 * `xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`
 */
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ID generator used in the Better Auth `advanced.generateId` config.
 *
 * Better Auth's default generator produces opaque alphanumeric strings (e.g.
 * `9hrbjIfqhl2sTXOhzrWSNwL9i2kipz51`) that PostgreSQL rejects with
 * "invalid input syntax for type uuid" when the column type is `uuid`.
 * `crypto.randomUUID()` is available natively in Cloudflare Workers.
 *
 * Exported as a named constant so regression tests can assert that this
 * specific function is wired into the auth config — if `generateId` is
 * removed or reassigned, the test that imports `AUTH_ID_GENERATOR` and
 * calls it will still compile, but any test that directly references the
 * exported value alongside the config will detect the drift.
 */
// Better Auth 1.5+ passes `{ model }` as an argument to generateId.
// Optional parameter ensures compatibility with both the legacy no-arg calling
// convention and the newer object-parameter form, without breaking existing callers.
export const AUTH_ID_GENERATOR = (_opts?: { model?: string }) => crypto.randomUUID();

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
 * @param env - Cloudflare Worker environment bindings (must include HYPERDRIVE and BETTER_AUTH_SECRET; BETTER_AUTH_API_KEY is optional but required for the Dash dashboard)
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
            // Block sign-in until the user has verified their email address.
            requireEmailVerification: true,
            sendResetPassword: async ({ user, url }) => {
                if (!env.RESEND_API_KEY) {
                    // deno-lint-ignore no-console
                    console.warn('[auth] RESEND_API_KEY not set — password reset email dropped');
                    return;
                }
                const mailer = new ResendEmailService(env.RESEND_API_KEY, FROM_ADDRESS_CRITICAL);
                await mailer.sendEmail({
                    to: user.email,
                    ...renderPasswordReset({ email: user.email, url }),
                });
            },
        },

        // ── Email verification (core option — not a plugin) ───────────────────
        // Sends a verification link on sign-up and when explicitly requested.
        // If RESEND_API_KEY is absent (local dev without credentials), the send is
        // skipped with a warning — auth still works, verification is best-effort.
        // Note: requireEmailVerification is set on emailAndPassword above.
        emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: async ({ user, url }) => {
                if (!env.RESEND_API_KEY) {
                    // deno-lint-ignore no-console
                    console.warn(
                        '[auth] RESEND_API_KEY not set — email verification send skipped. ' +
                            'Set RESEND_API_KEY in .dev.vars (local) or wrangler secret put RESEND_API_KEY (production).',
                    );
                    return;
                }
                const mailer = new ResendEmailService(env.RESEND_API_KEY, FROM_ADDRESS_CRITICAL);
                await mailer.sendEmail({
                    to: user.email,
                    ...renderEmailVerification({ email: user.email, url }),
                });
            },
        },

        user: {
            fields: USER_FIELD_MAPPING,
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
            // Belt-and-suspenders fallback: Better Auth 1.5.x does not reliably call
            // generateId before the Prisma adapter is invoked. The primary fix is the
            // $extends query extension in worker/lib/prisma.ts, which intercepts every
            // create operation and replaces non-UUID ids at the Prisma layer.
            // This generateId covers code paths where Better Auth calls it directly.
            generateId: AUTH_ID_GENERATOR,
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
            // Dash plugin — integrates with the dash.better-auth.com dashboard.
            // Reads BETTER_AUTH_API_KEY from env automatically. Set the key via:
            //   Local dev:  BETTER_AUTH_API_KEY=<key> in .dev.vars
            //   Production: wrangler secret put BETTER_AUTH_API_KEY
            dash(),
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

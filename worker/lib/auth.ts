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
 *   - `dash()` — Better Auth Dash dashboard integration (from `@better-auth/infra`); requires `env.BETTER_AUTH_API_KEY` passed explicitly — Cloudflare Workers do not expose Worker Secrets via `process.env`; the plugin no-ops when the key is absent
 *   - `sentinel()` — infrastructure security: credential stuffing protection, impossible travel detection, bot blocking, suspicious IP blocking (from `@better-auth/infra`); also requires `env.BETTER_AUTH_API_KEY` passed explicitly (same reason as `dash()`); **conditionally loaded** — only when `BETTER_AUTH_SENTINEL_ENABLED=true` (requires Better Auth Pro tier)
 *   - `bearer()` — API-first Bearer token auth
 *   - `twoFactor()` — TOTP/2FA
 *   - `multiSession()` — multiple active sessions
 *   - `admin()` — built-in admin plugin
 *   - `organization()` — multi-tenancy
 *
 * Inactive (available but not wired):
 *   - `apiKey()` — built-in API key management (we use a custom implementation)
 *   - `auditLogs()` — **pending** `@better-auth/infra` publishing this export; will record all auth events to the DB for compliance and visual audit trail in Dash
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
// NOTE: auditLogs is NOT exported in @better-auth/infra@0.2.5 (the latest published version).
// TODO(auth): import { auditLogs } from '@better-auth/infra' once the package publishes it.
//             Track: https://github.com/better-auth/better-auth/issues?q=is%3Aissue+auditLogs+infra
import { dash, sentinel } from '@better-auth/infra';
import type { Env } from '../types.ts';
import { createPrismaClient } from './prisma.ts';
import { createEmailService } from '../services/email-service.ts';
import { renderEmailVerification, renderPasswordReset } from '../services/email-templates.ts';
import { createResendContactService } from '../services/resend-contact-service.ts';
import { parseAllowedOrigins } from '../utils/cors.ts';

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
 * Whether Better Auth's internal CSRF origin check is disabled.
 *
 * Better Auth 1.5.x throws `MISSING_OR_NULL_ORIGIN` when a request carries a
 * Cookie header but no Origin header — i.e. every non-browser API client
 * (Postman, curl, SDK) that has received a session cookie from a previous
 * request.  This is a false positive: CSRF attacks require the victim's
 * browser to silently send cookies cross-site, which is already prevented by
 * `sameSite: 'lax'` on all `bloqr.*` cookies.  CSRF cannot originate from
 * non-browser clients because those clients don't participate in the same-site
 * cookie model.
 *
 * Setting `advanced.disableCSRFCheck: true` in the Better Auth config sets
 * `skipCSRFCheck = true` in the request context, which causes `validateOrigin`
 * to return early before throwing `MISSING_OR_NULL_ORIGIN`.
 *
 * For browser flows, `sameSite: 'lax'` (set on all `bloqr.*` cookies) is the
 * CSRF mitigation this module actually configures: browsers do not send lax
 * cookies on typical cross-site POST requests.  The Better Auth handler is
 * registered at step 1b in `worker/hono-app.ts` and returns a Response
 * directly (no `next()` call), so the global CORS middleware at step 4 does
 * not execute for `/api/auth/*` routes.  Any explicit origin enforcement for
 * auth routes must therefore run before the Better Auth handler.
 *
 * Exported as a named constant so tests can assert this is `true` and future
 * reviewers have a clear audit trail.
 */
export const AUTH_DISABLE_CSRF_CHECK = true;

/**
 * Builds the `trustedOrigins` function for Better Auth.
 *
 * Better Auth uses `trustedOrigins` to validate callback URLs, redirect URLs,
 * and (when `disableCSRFCheck` is false) the `Origin` request header.  This
 * builder parses the env-configured allowlist once and returns a closure that
 * serves the cached array, keeping Better Auth's URL validation in sync with
 * the custom CORS middleware (single source of truth: the
 * `CORS_ALLOWED_ORIGINS` env var / `wrangler.toml [vars]`) without reparsing
 * on every auth request.
 *
 * The `request` parameter is unused — the allowlist is env-based, not
 * request-dependent.  The `_request` prefix signals this intentionally.
 *
 * Exported for testability: callers can call the returned function directly
 * without instantiating a full Better Auth instance.
 */
export function buildTrustedOriginsFn(env: Env): (_request?: Request) => string[] {
    const trustedOrigins = parseAllowedOrigins(env);
    return (_request?: Request): string[] => trustedOrigins;
}

/**
 * Adapts a Cloudflare KVNamespace to Better Auth's secondaryStorage interface.
 *
 * Better Auth uses secondaryStorage for sessions, rate-limit counters, and
 * short-lived verification tokens — offloading these from Postgres/Prisma keeps
 * the primary DB free for business-logic queries.
 *
 * The graceful-fallback when the KV binding is absent is handled by the caller
 * (`createAuth`) via a conditional spread — this function always requires a
 * bound `KVNamespace` and will throw if called with an undefined binding.
 *
 * The interface expected by Better Auth is:
 * ```typescript
 * { get(key): Promise<string|null>; set(key, value, ttl?): Promise<void>; delete(key): Promise<void>; }
 * ```
 *
 * Exported for unit testing without requiring a real Hyperdrive connection.
 *
 * @param kv - Cloudflare KVNamespace binding (e.g. `env.BETTER_AUTH_KV`)
 */
export function createKvSecondaryStorage(kv: KVNamespace): {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
} {
    return {
        get: (key: string) => kv.get(key),
        // Cloudflare KV requires expirationTtl to be a positive integer (≥ 60 s in
        // production; ≥ 1 s in dev). A ttl of 0 or any negative value has no valid
        // KV representation, so we store without expiry (equivalent to "no TTL").
        // Better Auth never passes ttl ≤ 0 in practice; this guard is a safety net.
        set: (key: string, value: string, ttl?: number) => kv.put(key, value, ttl !== undefined && ttl > 0 ? { expirationTtl: Math.max(60, ttl) } : undefined),
        delete: (key: string) => kv.delete(key),
    };
}

/**
 * Builds the options object for the {@link dash} plugin.
 *
 * Both `apiKey` and `kvUrl` are conditionally spread so the plugin gracefully
 * no-ops when either variable is absent (local dev without secrets configured).
 *
 * **Why explicit passthrough?** Worker Secrets set via `wrangler secret put` are
 * only accessible through the `env` binding — they are never exposed on
 * `process.env`, even with `nodejs_compat` enabled.  `@better-auth/infra`
 * internally reads `process.env.BETTER_AUTH_API_KEY`, which is always `undefined`
 * in a Cloudflare Worker, so the key must be injected here.
 *
 * Exported as a pure helper so tests can assert `apiKey` / `kvUrl` presence and
 * absence without requiring a live Hyperdrive / PostgreSQL connection.
 */
export function buildDashOptions(env: Pick<Env, 'BETTER_AUTH_API_KEY' | 'BETTER_AUTH_KV_URL'>): { apiKey?: string; kvUrl?: string } {
    return {
        ...(env.BETTER_AUTH_API_KEY ? { apiKey: env.BETTER_AUTH_API_KEY } : {}),
        ...(env.BETTER_AUTH_KV_URL ? { kvUrl: env.BETTER_AUTH_KV_URL } : {}),
    };
}

/**
 * Builds the options object for the {@link sentinel} plugin.
 *
 * `apiKey` and `kvUrl` use the same conditional-spread pattern as
 * {@link buildDashOptions} (same Worker-Secret passthrough requirement).
 * The `security` block is always present — it is static configuration that
 * does not depend on runtime env values.
 *
 * Exported as a pure helper so tests can assert `apiKey` / `kvUrl` presence
 * and absence, and confirm the `security` block is always included, without
 * requiring a live Hyperdrive / PostgreSQL connection.
 */
export function buildSentinelOptions(env: Pick<Env, 'BETTER_AUTH_API_KEY' | 'BETTER_AUTH_KV_URL'>): {
    apiKey?: string;
    kvUrl?: string;
    security: {
        credentialStuffing: { enabled: boolean; thresholds: { challenge: number; block: number }; windowSeconds: number; cooldownSeconds: number };
        impossibleTravel: { enabled: boolean; maxSpeedKmh: number; action: 'challenge' | 'block' };
        unknownDeviceNotification: boolean;
        botBlocking: boolean;
        suspiciousIpBlocking: boolean;
    };
} {
    return {
        ...(env.BETTER_AUTH_API_KEY ? { apiKey: env.BETTER_AUTH_API_KEY } : {}),
        ...(env.BETTER_AUTH_KV_URL ? { kvUrl: env.BETTER_AUTH_KV_URL } : {}),
        security: {
            // Credential stuffing / brute-force protection.
            // Challenge after 3 failures; block after 5 within 1 hour.
            credentialStuffing: {
                enabled: true,
                thresholds: { challenge: 3, block: 5 },
                windowSeconds: 3600,
                cooldownSeconds: 900,
            },
            // Flag logins that are geographically impossible given the previous session.
            impossibleTravel: {
                enabled: true,
                maxSpeedKmh: 1200,
                action: 'challenge',
            },
            // Notify users when a sign-in occurs from an unrecognised device.
            unknownDeviceNotification: true,
            // Block known bot user-agents and headless browser signatures.
            botBlocking: true,
            // Block IPs flagged in the Better Auth threat intelligence feed.
            suspiciousIpBlocking: true,
        },
    };
}

/**
 * Returns `true` when the Sentinel plugin should be loaded.
 *
 * Sentinel is a **Better Auth Pro tier** feature.  Loading it on the free tier
 * causes sign-in requests to hang with no response returned.  Gate it behind
 * this helper so it can be safely enabled in production by setting
 * `BETTER_AUTH_SENTINEL_ENABLED=true` in `wrangler.toml [vars]` — no code change
 * required when upgrading to Pro.
 *
 * Only the exact string `"true"` enables the plugin; any other value (including
 * `"1"`, `"false"`, or absent) leaves it disabled.
 *
 * Exported so it can be tested and used in future admin/config inspection
 * endpoints.
 */
export function isSentinelEnabled(env: Pick<Env, 'BETTER_AUTH_SENTINEL_ENABLED'>): boolean {
    return env.BETTER_AUTH_SENTINEL_ENABLED === 'true';
}

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
export function createAuth(env: Env, baseURL?: string, ctx?: Pick<ExecutionContext, 'waitUntil'>) {
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

    // Resend audience contact sync — fire-and-forget user lifecycle hooks.
    // Falls back to NullResendContactService when RESEND_API_KEY or RESEND_AUDIENCE_ID is absent.
    const contacts = createResendContactService(env);

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

    // A viable critical-path email provider is any provider that can actually
    // deliver the email (not just silently drop it via NullEmailService).
    // If no such provider is configured, enabling requireEmailVerification would
    // permanently block sign-in for newly registered users.
    const hasViableEmailProvider = !!(env.RESEND_API_KEY || env.SEND_EMAIL);

    return betterAuth({
        database: prismaAdapter(prisma, { provider: 'postgresql' }),
        secret: env.BETTER_AUTH_SECRET,
        basePath: '/api/auth',
        baseURL: env.BETTER_AUTH_URL || baseURL,

        // ── Trusted origins — keeps Better Auth's URL validation in sync with ──
        // the custom CORS middleware (single source of truth: CORS_ALLOWED_ORIGINS
        // env var / wrangler.toml [vars]).  Used to validate callbackURL, redirectTo,
        // errorCallbackURL, and newUserCallbackURL on every auth request.
        // NOTE: CSRF protection for browser clients is handled by sameSite: 'lax'
        // cookies and the custom CORS middleware, NOT by Better Auth's origin check
        // (which is disabled via advanced.disableCSRFCheck below).
        trustedOrigins: buildTrustedOriginsFn(env),

        socialProviders,

        // ── Secondary storage (Cloudflare KV) ────────────────────────────────
        // When BETTER_AUTH_KV is bound, Better Auth offloads sessions,
        // rate-limit counters, and short-lived verification tokens to KV.
        // This keeps Prisma/Neon free for business-logic queries.
        // Omitted entirely when the binding is absent — Better Auth falls back
        // to Postgres for all storage.
        ...(env.BETTER_AUTH_KV ? { secondaryStorage: createKvSecondaryStorage(env.BETTER_AUTH_KV) } : {}),

        emailAndPassword: {
            enabled: true,
            // Only block sign-in on unverified email when a provider is configured that can
            // actually deliver the verification link. Setting this unconditionally with no
            // provider configured would permanently lock out newly registered users.
            requireEmailVerification: hasViableEmailProvider,
            sendResetPassword: async ({ user, url }) => {
                const mailer = createEmailService(env, { useQueue: false, priority: 'critical', reason: 'password_reset' });
                await mailer.sendEmail({
                    to: user.email,
                    ...renderPasswordReset({ email: user.email, url }),
                });
            },
        },

        // ── Email verification (core option — not a plugin) ───────────────────
        // Sends a verification link on sign-up and when explicitly requested.
        // Routes through createEmailService so configured fallbacks
        // (CfEmailWorkerService / NullEmailService) are honoured when
        // RESEND_API_KEY is absent — no silent drops in non-Resend environments.
        // Note: requireEmailVerification is set on emailAndPassword above.
        emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: async ({ user, url }) => {
                const mailer = createEmailService(env, { useQueue: false, priority: 'critical', reason: 'email_verification' });
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
            // ── Disable Better Auth's internal CSRF origin check ─────────────────
            // For browser flows, sameSite: 'lax' (above) is the CSRF mitigation
            // this module actually configures: browsers do not send lax cookies on
            // typical cross-site POST requests.  Disabling Better Auth's Origin
            // requirement here avoids breaking legitimate non-browser clients that
            // do not send an Origin header.
            // Note: this setting does not itself enforce an origin allowlist for
            // /api/auth/* routes; any explicit origin enforcement must run before
            // the Better Auth handler (step 1b in worker/hono-app.ts).
            // See AUTH_DISABLE_CSRF_CHECK in this module for the full rationale.
            disableCSRFCheck: AUTH_DISABLE_CSRF_CHECK,
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
            // Options are built by buildDashOptions(): apiKey and kvUrl are conditionally
            // spread so the plugin gracefully no-ops when secrets are absent in local dev.
            // See buildDashOptions() for the full rationale on why explicit passthrough
            // is required (Worker Secrets are not exposed on process.env).
            dash(buildDashOptions(env)),
            // Audit logs — records all auth events (sign-in, sign-up, token refresh,
            // role changes, bans, etc.) to the database for compliance and debugging.
            // Integrates with the Dash dashboard for visual audit trail browsing.
            // TODO(auth): enable auditLogs() once @better-auth/infra exports it.
            //             auditLogs is NOT in @better-auth/infra@0.2.5 (latest as of 2026-04).
            //             Uncomment once the package publishes the export:
            //   auditLogs({ retention: 90 }),
            // Sentinel — infrastructure-level security plugin (Better Auth Pro tier only).
            // Guarded by isSentinelEnabled(env): only loaded when
            // BETTER_AUTH_SENTINEL_ENABLED=true. Without the flag, the plugin is
            // omitted entirely — loading it on the free/pilot tier causes sign-in
            // requests to hang with no response. Set the flag in wrangler.toml [vars]
            // when upgrading to Better Auth Pro; no code change required at that point.
            ...(isSentinelEnabled(env) ? [sentinel(buildSentinelOptions(env))] : []),
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

        // ── User lifecycle hooks — Resend audience contact sync ───────────────
        // syncUserCreated / syncUserDeleted are fire-and-forget: errors are caught
        // and logged as warnings inside ResendContactService and never propagate.
        // When an ExecutionContext is provided, Promises are registered with
        // ctx.waitUntil() so they survive response completion in Cloudflare Workers.
        databaseHooks: {
            user: {
                create: {
                    after: async (user) => {
                        const syncPromise = contacts.syncUserCreated({ id: user.id, email: user.email, name: user.name });
                        if (ctx) {
                            ctx.waitUntil(syncPromise);
                        } else {
                            // Without an ExecutionContext the promise runs fire-and-forget.
                            // Errors are already swallowed inside syncUserCreated.
                            void syncPromise;
                        }
                    },
                },
                delete: {
                    after: async (user) => {
                        const syncPromise = contacts.syncUserDeleted({ id: user.id, email: user.email });
                        if (ctx) {
                            ctx.waitUntil(syncPromise);
                        } else {
                            void syncPromise;
                        }
                    },
                },
            },
        },
    });
}

/** Inferred type of a Better Auth instance created by createAuth. */
export type Auth = ReturnType<typeof createAuth>;

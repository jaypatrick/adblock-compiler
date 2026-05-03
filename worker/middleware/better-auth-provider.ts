/**
 * BetterAuthProvider — IAuthProvider implementation for Better Auth.
 *
 * Verifies session tokens via Better Auth's `auth.api.getSession()` API.
 * Maps the session/user object to the standard {@link IAuthProviderResult}
 * shape consumed by {@link authenticateRequestUnified}.
 *
 * ## How it works
 * Better Auth stores sessions in PostgreSQL (Neon via Hyperdrive) and authenticates via:
 *   - Cookie (`better-auth.session_token`) — for browser-based flows
 *   - Bearer token (`Authorization: Bearer <token>`) — for API clients
 *     (enabled by the `bearer()` plugin in `worker/lib/auth.ts`)
 *
 * `auth.api.getSession()` accepts request headers and automatically
 * handles both authentication methods.
 *
 * ## ZTA compliance
 * Tier and role are resolved from the database via Better Auth's session
 * lookup — not from JWT claims. This ensures privilege changes take effect
 * immediately on the next request.
 *
 * ## Provider selection
 * Better Auth is the PRIMARY auth provider.
 * See `worker/hono-app.ts` for the priority chain:
 *   API key → Better Auth → Anonymous
 *
 * @see worker/lib/auth.ts — Better Auth factory
 * @see worker/types.ts — IAuthProvider interface
 */

import { type Env, type IAuthProvider, type IAuthProviderResult, UserTier } from '../types.ts';
import { createAuth } from '../lib/auth.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';

// ============================================================================
// Helpers (exported for unit testing)
// ============================================================================

/**
 * Resolve tier from a Better Auth user's additionalField value.
 * Validates against the UserTier enum and falls back to Free for unknown values.
 */
export function resolveTier(tier: string | null | undefined): UserTier {
    if (!tier) return UserTier.Free;
    const valid = Object.values(UserTier) as string[];
    if (!valid.includes(tier)) return UserTier.Free;
    return tier as UserTier;
}

/**
 * Resolve role from a Better Auth user's additionalField value.
 */
export function resolveRole(role: string | null | undefined): string {
    return role ?? 'user';
}

// ============================================================================
// Provider
// ============================================================================

/**
 * Better Auth implementation of {@link IAuthProvider}.
 *
 * Stateless per request — creates a fresh Better Auth instance using the
 * request's environment bindings (Hyperdrive, secret).
 */
export class BetterAuthProvider implements IAuthProvider {
    readonly name = 'better-auth';
    readonly authMethod = 'better-auth' as const;

    constructor(
        private readonly env: Env,
        private readonly ctx?: Pick<ExecutionContext, 'waitUntil'>,
    ) {}

    async verifyToken(request: Request): Promise<IAuthProviderResult> {
        // Guard: BETTER_AUTH_SECRET must be configured
        if (!this.env.BETTER_AUTH_SECRET) {
            return {
                valid: false,
                error: 'BETTER_AUTH_SECRET not configured. Add BETTER_AUTH_SECRET to .dev.vars (local) or run: wrangler secret put BETTER_AUTH_SECRET',
            };
        }

        // Guard: Hyperdrive must be configured (required for Prisma → PostgreSQL)
        if (!this.env.HYPERDRIVE) {
            return {
                valid: false,
                error: 'Hyperdrive binding not configured (env.HYPERDRIVE is missing). Check wrangler.toml [[hyperdrive]] or .dev.vars',
            };
        }

        try {
            const url = new URL(request.url);
            const auth = createAuth(this.env, url.origin, this.ctx);
            const abortController = new AbortController();
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const betterAuthRequest = new Request(url.toString(), {
                method: 'GET',
                headers: request.headers,
                signal: abortController.signal,
            });
            const sessionPromise = auth.api.getSession(betterAuthRequest as Request);
            const session = await Promise.race([
                sessionPromise.finally(() => {
                    if (timeoutId !== undefined) {
                        clearTimeout(timeoutId);
                    }
                }),
                new Promise<never>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        abortController.abort();
                        reject(new DOMException('DB call exceeded 10s', 'TimeoutError'));
                    }, 10_000);
                }),
            ]);

            if (!session) {
                // No session found — signal anonymous flow (no error = not a failure,
                // just no credentials present).
                return { valid: false };
            }

            return {
                valid: true,
                providerUserId: session.user.id,
                tier: resolveTier((session.user as Record<string, unknown>).tier as string | undefined),
                role: resolveRole((session.user as Record<string, unknown>).role as string | undefined),
                sessionId: session.session.id,
                email: session.user.email ?? null,
                displayName: session.user.name ?? null,
            };
        } catch (error) {
            // Better Auth throws on invalid/expired tokens — treat as anonymous.
            // Distinguish timeout errors (DB call exceeded budget) from other failures
            // so telemetry can surface them separately.
            const isTimeout = error instanceof Error &&
                (error.name === 'AbortError' || error.name === 'TimeoutError');

            // deno-lint-ignore no-console
            console.error(
                '[better-auth] Token verification error:',
                isTimeout ? 'TimeoutError (DB call exceeded 10s)' : (error instanceof Error ? error.name : 'UnknownError'),
            );

            // ZTA telemetry: emit auth failure event with enriched fields
            if (this.env.ANALYTICS_ENGINE) {
                const url = new URL(request.url);
                new AnalyticsService(this.env.ANALYTICS_ENGINE).trackSecurityEvent({
                    eventType: 'auth_failure',
                    authMethod: 'better-auth',
                    reason: isTimeout ? 'better_auth_timeout' : 'better_auth_verification_error',
                    path: url.pathname,
                    method: request.method,
                    clientIpHash: AnalyticsService.hashIp(request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown'),
                });
            }

            return { valid: false, error: isTimeout ? 'Authentication timed out' : 'Authentication failed' };
        }
    }
}

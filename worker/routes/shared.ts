/// <reference types="@cloudflare/workers-types" />

/**
 * Shared types and helper functions used by route modules and hono-app.ts.
 *
 * Extracted here to avoid circular imports: hono-app.ts imports route modules,
 * and route modules must NOT import from hono-app.ts at runtime.
 *
 * @see worker/hono-app.ts — main app setup, middleware, and route mounting
 */

import type { Context } from 'hono';
import type { Env, IAuthContext } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { verifyTurnstileToken } from '../middleware/index.ts';
import type { PrismaClient } from '../../prisma/generated/client.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Hono context variables set by middleware and available in route handlers.
 *
 * `prisma` is set by the global `prismaMiddleware` in `hono-app.ts` when
 * `HYPERDRIVE` is configured.  Always guard: `c.get('prisma')` may be `undefined`
 * in local dev without a Hyperdrive binding, unit tests, or static-asset requests.
 */
export interface Variables {
    authContext: IAuthContext;
    analytics: AnalyticsService;
    requestId: string;
    ip: string;
    isSSR: boolean; // true when the request originated from the SSR Worker via env.API.fetch()
    /** Request-scoped PrismaClient — set by prismaMiddleware() when HYPERDRIVE is bound. */
    prisma?: InstanceType<typeof PrismaClient>;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Shared zValidator error callback — returns a 422 JSON response when Zod
 * validation fails.  Used across all `zValidator('json', ...)` calls.
 *
 * @hono/zod-validator types against npm:zod while this project uses
 * jsr:@zod/zod — both are Zod v4 with identical runtime APIs; the cast
 * to `any` avoids a module-identity mismatch that is type-only.
 *
 * When validation fails, `result.error` is a `ZodError` instance from
 * jsr:@zod/zod — typed as `unknown` here to bridge the module identity gap,
 * but serialised as-is into the 422 response body so callers receive full
 * structured error details.
 *
 * @example
 * ```ts
 * zValidator('json', SomeSchema as any, zodValidationError)
 * ```
 */
// deno-lint-ignore no-explicit-any
export function zodValidationError(result: { success: boolean; error?: unknown }, c: AppContext): Response | void {
    if (!result.success) {
        return c.json({ success: false, error: 'Invalid request body', details: result.error }, 422);
    }
}

/**
 * Verify a Turnstile token extracted from an already-validated JSON body.
 *
 * Must be called AFTER `zValidator` has consumed the body stream (when the
 * `turnstileToken` field is accessed via `c.req.valid('json')`).
 *
 * Returns the error `Response` (403) on rejection, or `null` when the
 * Turnstile check passes (or when Turnstile is not configured).
 */
export async function verifyTurnstileInline(c: AppContext, token: string): Promise<Response | null> {
    if (!c.env.TURNSTILE_SECRET_KEY) return null;
    const tsResult = await verifyTurnstileToken(c.env, token, c.get('ip'));
    if (!tsResult.success) {
        c.get('analytics').trackSecurityEvent({
            eventType: 'turnstile_rejection',
            path: c.req.path,
            method: c.req.method,
            clientIpHash: AnalyticsService.hashIp(c.get('ip')),
            tier: c.get('authContext').tier,
            reason: tsResult.error ?? 'turnstile_verification_failed',
        });
        return c.json({ success: false, error: tsResult.error ?? 'Turnstile verification failed' }, 403);
    }
    return null;
}

/**
 * Reconstruct a synthetic `Request` from a validated body.
 *
 * When `zValidator` consumes the original body stream, the existing handler
 * functions (which accept a `Request`) cannot re-read `c.req.raw`.  This
 * helper creates a new `Request` that re-serialises the validated body so the
 * handlers can continue using their existing `request.json()` API.
 */
export function buildSyntheticRequest(c: AppContext, validatedBody: unknown): Request {
    return new Request(c.req.url, {
        method: 'POST',
        headers: c.req.raw.headers,
        body: JSON.stringify(validatedBody),
    });
}

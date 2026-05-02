/// <reference types="@cloudflare/workers-types" />

/**
 * Flash message routes.
 *
 * Routes:
 *   GET /api/flash/:token  — Consume a one-time flash message from KV.
 *
 * ## Design
 * Flash messages are short-lived, one-time-read notifications stored in
 * FLASH_STORE KV (see `worker/lib/flash.ts`). The Angular frontend reads
 * `?flash=<token>` on startup and calls this endpoint to exchange the token
 * for the message text, which is then displayed to the user.
 *
 * ## Security
 * - No auth required: must be publicly accessible so the sign-in page can
 *   consume messages before the user is authenticated.
 * - Tokens are crypto.randomUUID() — 122 bits of entropy.
 * - Each token is consumed (deleted) on first read.
 * - TTL of 30 s enforced server-side; expired tokens return 404.
 * - Rate-limited per IP to prevent token-guessing enumeration attacks.
 *
 * ## ZTA checklist
 * - [x] No PII stored in flash messages (only UI status strings)
 * - [x] Consume-once semantics prevent replay
 * - [x] FLASH_STORE binding optional — guarded before use
 * - [x] Token extracted from path param (no query-string injection risk)
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { getFlash } from '../lib/flash.ts';

export const flashRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Note: /api/flash/* is already rate-limited by the global pre-auth middleware
// in hono-app.ts (checkRateLimitTiered). Adding rateLimitMiddleware() here would
// double-increment counters — do not add it again.

// ── Zod schemas ───────────────────────────────────────────────────────────────

const FlashMessageSchema = z.object({
    message: z.string(),
    type: z.enum(['info', 'warn', 'error', 'success']),
    createdAt: z.string(),
});

// ── OpenAPI route definition ──────────────────────────────────────────────────

const getFlashRoute = createRoute({
    method: 'get',
    path: '/api/flash/{token}',
    tags: ['Meta'],
    summary: 'Consume a flash message',
    description: 'Reads and deletes a one-time flash message from the FLASH_STORE KV namespace. ' +
        'Returns the message payload if the token is valid and has not expired (30 s TTL). ' +
        'Returns 404 if the token is unknown, already consumed, or expired. ' +
        'No authentication required — must be accessible on the sign-in page before the user is authenticated.',
    request: {
        params: z.object({
            token: z.string().uuid(),
        }),
    },
    responses: {
        200: {
            description: 'Flash message payload',
            content: {
                'application/json': {
                    schema: FlashMessageSchema,
                },
            },
        },
        404: {
            description: 'Token not found, already consumed, or expired',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        503: {
            description: 'FLASH_STORE KV binding unavailable',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

// ── Handler ───────────────────────────────────────────────────────────────────

flashRoutes.openapi(getFlashRoute, async (c) => {
    if (!c.env.FLASH_STORE) {
        return c.json({ success: false, error: 'Flash store unavailable' }, 503);
    }

    const { token } = c.req.valid('param');
    const flash = await getFlash(c.env.FLASH_STORE, token, c.executionCtx);

    if (!flash) {
        return c.json({ success: false, error: 'Flash message not found or expired' }, 404);
    }

    return c.json(flash, 200);
});

/// <reference types="@cloudflare/workers-types" />

/**
 * Frontend error logging route.
 *
 * Routes:
 *   POST /api/log/frontend-error  — Receive and persist Angular frontend errors to D1.
 *
 * ## Design
 * The Angular `GlobalErrorHandler` calls this endpoint to log unhandled frontend
 * errors for offline analysis. The endpoint accepts a structured JSON body,
 * validates it with Zod, and inserts a row into the `error_events` D1 table.
 *
 * ## Security
 * - No auth required: frontend errors should be logged even when the user is
 *   not authenticated (e.g. sign-in page crashes, SSR hydration errors).
 * - Rate-limited per IP to prevent abuse.
 * - Source is hard-coded to 'frontend' by the server (clients cannot spoof it).
 * - Body size is capped to prevent large stack trace flooding.
 * - Zod-validated before any DB write.
 *
 * ## ZTA checklist
 * - [x] Source field hard-coded server-side
 * - [x] All inputs Zod-validated before DB write
 * - [x] D1 queries parameterized (.prepare().bind())
 * - [x] DB unavailable → 503 (not 500)
 * - [x] Returns 204 — clients should ignore the response body
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import { bodySizeMiddleware, rateLimitMiddleware } from '../middleware/hono-middleware.ts';
import type { Variables } from './shared.ts';
import { logErrorToD1 } from '../utils/error-logger.ts';

export const logRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Cap payload size then rate-limit (body first so rate limiter only fires on valid-size requests)
logRoutes.use('/api/log/frontend-error', bodySizeMiddleware(), rateLimitMiddleware());

// ── Zod schema ────────────────────────────────────────────────────────────────

const FrontendErrorBodySchema = z.object({
    /** Human-readable error message (required). */
    message: z.string().min(1).max(2048),
    /** Stack trace from Error.stack (optional). */
    stack: z.string().max(16384).optional(),
    /** Free-form JSON context (route, component name, etc.). */
    context: z.string().max(4096).optional(),
    /** document.location.href at the time of the error. */
    url: z.string().max(2048).optional(),
    /** navigator.userAgent */
    userAgent: z.string().max(512).optional(),
    /** Frontend session ID (from auth state). */
    sessionId: z.string().max(256).optional(),
});

// ── OpenAPI route definition ──────────────────────────────────────────────────

const logFrontendErrorRoute = createRoute({
    method: 'post',
    path: '/api/log/frontend-error',
    tags: ['Meta'],
    summary: 'Log frontend error',
    description: 'Receives a structured Angular frontend error report and persists it to the ' +
        '`error_events` D1 table (source=frontend). ' +
        'No authentication required — errors should be logged regardless of auth state. ' +
        'Rate-limited and body-size-capped to prevent abuse.',
    request: {
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: FrontendErrorBodySchema,
                },
            },
        },
    },
    responses: {
        204: {
            description: 'Error logged — no content',
        },
        400: {
            description: 'Malformed or invalid request body',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        503: {
            description: 'Database unavailable',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

// ── Handler ───────────────────────────────────────────────────────────────────

logRoutes.openapi(logFrontendErrorRoute, async (c) => {
    if (!c.env.DB) {
        return c.json({ success: false, error: 'Database unavailable' }, 503);
    }

    let body: z.infer<typeof FrontendErrorBodySchema>;

    try {
        const raw = await c.req.text();
        if (!raw.trim()) {
            return c.json({ success: false, error: 'Empty request body' }, 400);
        }
        const parsed = JSON.parse(raw) as unknown;
        const validation = FrontendErrorBodySchema.safeParse(parsed);
        if (!validation.success) {
            return c.json({ success: false, error: 'Invalid request body' }, 400);
        }
        body = validation.data;
    } catch {
        return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    // Parse the context string as JSON if possible so it is stored as a
    // structured object (error-logger.ts calls JSON.stringify internally).
    // Fall back to the raw string if parsing fails.
    let parsedContext: unknown = body.context;
    if (body.context != null) {
        try {
            parsedContext = JSON.parse(body.context);
        } catch {
            parsedContext = body.context;
        }
    }

    // Fire D1 insert via waitUntil so the 204 response is sent immediately.
    // logErrorToD1 never throws — it catches internally and logs a warning.
    // Source is hard-coded to 'frontend' — clients cannot spoof it.
    c.executionCtx.waitUntil(
        logErrorToD1(c.env.DB, {
            source: 'frontend',
            message: body.message,
            stack: body.stack,
            context: parsedContext,
            url: body.url,
            userAgent: body.userAgent,
            sessionId: body.sessionId,
        }),
    );

    return c.body(null, 204);
});

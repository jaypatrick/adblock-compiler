/// <reference types="@cloudflare/workers-types" />

/**
 * CSP violation reporting route.
 *
 * Routes:
 *   POST /csp-report  — accepts browser Content-Security-Policy violation reports
 *                        and persists them to the `csp_violations` D1 table.
 *
 * ## Security
 * - No auth required: browsers submit CSP reports without credentials.
 * - Rate limiting should be applied per-use via `rateLimitMiddleware()` on the route.
 * - Input is Zod-validated before any DB write.
 *
 * ## Browser report format
 * Browsers submit `application/csp-report` (older) or `application/json` (newer).
 * Both carry a JSON body with a `csp-report` sub-object; this endpoint parses and
 * validates that sub-object before persisting it.
 *
 * ## ZTA checklist
 * - [x] No auth required for reporting endpoint (browsers cannot carry Bearer tokens)
 * - [x] All external inputs Zod-validated before DB write
 * - [x] D1 queries parameterized (.prepare().bind())
 * - [x] Wrong method → 405; malformed body → 400
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import { rateLimitMiddleware } from '../middleware/hono-middleware.ts';
import type { Variables } from './shared.ts';

export const cspReportRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Rate-limit public writes: browsers should not be able to flood D1 with synthetic reports.
cspReportRoutes.use('/csp-report', rateLimitMiddleware());

// ── Zod schema ───────────────────────────────────────────────────────────────

/** Shape of the `csp-report` sub-object sent by browsers. */
const CspReportBodySchema = z.object({
    'csp-report': z.object({
        // Always present in conforming browsers; `.default('')` tolerates malformed reports.
        'document-uri': z.string().max(2048).default(''),
        'blocked-uri': z.string().max(2048).default(''),
        'violated-directive': z.string().max(512).default(''),
        /** Full CSP header value that triggered the violation. */
        'original-policy': z.string().max(4096).optional(),
        /** Normalized directive name (may differ from `violated-directive`). */
        'effective-directive': z.string().max(512).optional(),
        /** HTTP status of the blocked resource (0 for local/inline blocks). */
        'status-code': z.number().int().optional(),
    }),
});

// ── OpenAPI route definition ─────────────────────────────────────────────────

const cspReportRoute = createRoute({
    method: 'post',
    path: '/csp-report',
    tags: ['Security'],
    summary: 'Receive CSP violation report',
    description: 'Accepts browser Content-Security-Policy violation reports and persists them to the D1 `csp_violations` table. ' +
        'No authentication required — the endpoint is intentionally public so browsers can submit reports without credentials.',
    request: {
        body: {
            required: true,
            // Only declare application/csp-report here.
            // Declaring application/json would cause @hono/zod-openapi to add a
            // JSON body validator that runs for ALL incoming content types: for
            // application/csp-report requests it passes {} to Zod (wrong CT ->
            // skipped body read) and returns 400; for application/json + invalid
            // JSON it throws HTTPException(400) which the global onError handler
            // converts to 500.  With only a non-JSON content type declared no
            // automatic body validator is injected, so the handler's own
            // c.req.text() + JSON.parse() + try/catch handles both content types
            // correctly.
            content: {
                'application/csp-report': {
                    schema: CspReportBodySchema,
                },
            },
        },
    },
    responses: {
        204: {
            description: 'Violation recorded — no content',
        },
        400: {
            description: 'Malformed request body',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        405: {
            description: 'Method not allowed',
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

// ── Handler ──────────────────────────────────────────────────────────────────

cspReportRoutes.openapi(cspReportRoute, async (c) => {
    if (!c.env.DB) {
        return c.json({ success: false, error: 'Database unavailable' }, 503);
    }

    let report: z.infer<typeof CspReportBodySchema>;

    try {
        const raw = await c.req.text();
        if (!raw.trim()) {
            return c.json({ success: false, error: 'Empty request body' }, 400);
        }
        const parsed = JSON.parse(raw) as unknown;
        const validation = CspReportBodySchema.safeParse(parsed);
        if (!validation.success) {
            return c.json({ success: false, error: 'Invalid report body' }, 400);
        }
        report = validation.data;
    } catch {
        return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    const cspReport = report['csp-report'];

    try {
        await c.env.DB.prepare(
            `INSERT INTO csp_violations (id, document_uri, blocked_uri, violated_directive, timestamp)
             VALUES (?, ?, ?, ?, ?)`,
        )
            .bind(
                crypto.randomUUID(),
                cspReport['document-uri'],
                cspReport['blocked-uri'],
                cspReport['violated-directive'],
                new Date().toISOString(),
            )
            .run();
    } catch (error) {
        // deno-lint-ignore no-console
        console.error('[csp-report] Failed to persist violation to D1', error);
        return c.json({ success: false, error: 'Failed to persist CSP violation report to D1' }, 503);
    }

    // 204 No Content — browsers ignore the response body.
    return c.body(null, 204);
});

// ── Explicit 405 for non-POST requests ───────────────────────────────────────

cspReportRoutes.on(['GET', 'PUT', 'PATCH', 'DELETE'], '/csp-report', (c) => {
    return c.json({ success: false, error: 'Method Not Allowed' }, 405);
});

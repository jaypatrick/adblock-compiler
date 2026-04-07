/// <reference types="@cloudflare/workers-types" />

/**
 * Webhook notification routes.
 *
 * Routes:
 *   POST /notify
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';

import { handleNotify } from '../handlers/webhook.ts';

export const webhookRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Inline OpenAPI-compatible schemas for webhook notifications
const webhookNotifyRequestSchema = z.object({
    event: z.string().min(1).max(128).describe('Event identifier (e.g., "compilation.failed")'),
    level: z.enum(['info', 'warn', 'error']).optional().describe('Severity level'),
    message: z.string().min(1).describe('Human-readable notification message'),
    source: z.string().optional().describe('Source application or service name'),
    timestamp: z.string().datetime().optional().describe('ISO 8601 event timestamp'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Additional context data'),
});

const deliveryResultSchema = z.object({
    target: z.string().describe('Target webhook type (generic, sentry, datadog)'),
    success: z.boolean().describe('Whether delivery succeeded'),
    statusCode: z.number().int().optional().describe('HTTP status code from target'),
    error: z.string().optional().describe('Error message if delivery failed'),
});

// ── Webhooks ──────────────────────────────────────────────────────────────────

const notifyRoute = createRoute({
    method: 'post',
    path: '/notify',
    tags: ['Webhooks'],
    summary: 'Send webhook notification',
    description: 'Forwards a notification event to configured webhook targets (generic HTTP endpoint, Sentry, Datadog). Requires authentication and rate limiting.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: webhookNotifyRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Notification delivered to at least one target',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        event: z.string(),
                        deliveries: z.array(deliveryResultSchema),
                        duration: z.string().describe('Delivery duration (e.g., "123ms")'),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid JSON body',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        422: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        502: {
            description: 'All webhook targets failed',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        event: z.string(),
                        deliveries: z.array(deliveryResultSchema),
                        duration: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'No webhook targets configured',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

webhookRoutes.use('/notify', requireAuthMiddleware());
webhookRoutes.use('/notify', bodySizeMiddleware());
webhookRoutes.use('/notify', rateLimitMiddleware());
webhookRoutes.openapi(notifyRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleNotify(c.req.raw, c.env) as any;
});

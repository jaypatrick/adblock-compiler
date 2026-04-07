/// <reference types="@cloudflare/workers-types" />

/**
 * Queue routes.
 *
 * Routes:
 *   GET    /queue/stats
 *   GET    /queue/history
 *   GET    /queue/results/:requestId
 *   DELETE /queue/cancel/:requestId
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

export const queueRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Inline OpenAPI-compatible schemas for queue operations
const jobInfoSchema = z.object({
    requestId: z.string().describe('Unique job request identifier'),
    status: z.enum(['pending', 'completed', 'failed', 'cancelled']).describe('Job status'),
    enqueuedAt: z.string().datetime().describe('ISO 8601 timestamp when job was enqueued'),
    completedAt: z.string().datetime().optional().describe('ISO 8601 timestamp when job completed'),
    processingTime: z.number().optional().describe('Processing time in milliseconds'),
    error: z.string().optional().describe('Error message if job failed'),
});

const depthHistoryItemSchema = z.object({
    timestamp: z.string().datetime().describe('ISO 8601 timestamp'),
    depth: z.number().int().nonnegative().describe('Queue depth at this time'),
});

const queueStatsSchema = z.object({
    pending: z.number().int().nonnegative().describe('Number of pending jobs'),
    completed: z.number().int().nonnegative().describe('Number of completed jobs'),
    failed: z.number().int().nonnegative().describe('Number of failed jobs'),
    cancelled: z.number().int().nonnegative().describe('Number of cancelled jobs'),
    totalProcessingTime: z.number().nonnegative().describe('Total processing time in milliseconds'),
    averageProcessingTime: z.number().nonnegative().describe('Average processing time in milliseconds'),
    processingRate: z.number().nonnegative().describe('Jobs processed per second'),
    queueLag: z.number().nonnegative().describe('Current queue lag in milliseconds'),
    lastUpdate: z.string().datetime().describe('ISO 8601 timestamp of last stats update'),
    history: z.array(jobInfoSchema).describe('Recent job history'),
    depthHistory: z.array(depthHistoryItemSchema).describe('Queue depth over time'),
});

// ── Queue ─────────────────────────────────────────────────────────────────────

const queueStatsRoute = createRoute({
    method: 'get',
    path: '/queue/stats',
    tags: ['Queue'],
    summary: 'Get queue statistics',
    description: 'Returns current queue statistics including pending, completed, failed, and cancelled job counts',
    responses: {
        200: {
            description: 'Queue statistics',
            content: {
                'application/json': {
                    schema: queueStatsSchema,
                },
            },
        },
    },
});

queueRoutes.openapi(queueStatsRoute, async (c) => {
    const { handleQueueStats } = await import('../handlers/queue.ts');
    // deno-lint-ignore no-explicit-any
    return handleQueueStats(c.env) as any;
});

const queueHistoryRoute = createRoute({
    method: 'get',
    path: '/queue/history',
    tags: ['Queue'],
    summary: 'Get queue history',
    description: 'Returns recent job history and queue depth history',
    responses: {
        200: {
            description: 'Queue history',
            content: {
                'application/json': {
                    schema: z.object({
                        history: z.array(jobInfoSchema),
                        depthHistory: z.array(depthHistoryItemSchema),
                    }),
                },
            },
        },
    },
});

queueRoutes.openapi(queueHistoryRoute, async (c) => {
    const { handleQueueHistory } = await import('../handlers/queue.ts');
    // deno-lint-ignore no-explicit-any
    return handleQueueHistory(c.env) as any;
});

const queueResultsRoute = createRoute({
    method: 'get',
    path: '/queue/results/{requestId}',
    tags: ['Queue'],
    summary: 'Get queue job results',
    description: 'Returns the results of a specific queue job by request ID',
    request: {
        params: z.object({
            requestId: z.string().describe('Request ID of the queue job'),
        }),
    },
    responses: {
        200: {
            description: 'Job results or not found status',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string().optional(),
                        status: z.string().optional(),
                        result: z.unknown().optional(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid request ID',
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

queueRoutes.openapi(queueResultsRoute, async (c) => {
    const { handleQueueResults } = await import('../handlers/queue.ts');
    const requestId = c.req.param('requestId')!;
    // deno-lint-ignore no-explicit-any
    return handleQueueResults(requestId, c.env) as any;
});

const queueCancelRoute = createRoute({
    method: 'delete',
    path: '/queue/cancel/{requestId}',
    tags: ['Queue'],
    summary: 'Cancel a queue job',
    description: 'Attempts to cancel a pending queue job. This is a best-effort operation - the job may have already started processing.',
    request: {
        params: z.object({
            requestId: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid requestId format').describe('Request ID of the queue job to cancel'),
        }),
    },
    responses: {
        200: {
            description: 'Cancellation signal sent',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid request ID',
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
    },
});

queueRoutes.openapi(queueCancelRoute, async (c) => {
    const { handleQueueCancel } = await import('../handlers/queue.ts');
    const requestId = c.req.param('requestId')!;
    // deno-lint-ignore no-explicit-any
    return handleQueueCancel(c.req.raw, c.env, c.get('authContext'), c.get('analytics'), requestId) as any;
});

/// <reference types="@cloudflare/workers-types" />

/**
 * Workflow routes.
 *
 * Routes:
 *   POST   /workflow/compile
 *   POST   /workflow/batch
 *   POST   /workflow/cache-warm
 *   POST   /workflow/health-check
 *   GET    /workflow/status/:type/:id
 *   GET    /workflow/metrics
 *   GET    /workflow/events/:id
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';
import { batchCompileRequestSchema, cacheWarmRequestSchema, compileRequestSchema, healthCheckRequestSchema } from './workflow.schemas.ts';

export const workflowRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Response and auxiliary schemas for OpenAPI
const workflowStartResponseSchema = z.object({
    success: z.boolean(),
    message: z.string().describe('Human-readable message'),
    workflowId: z.string().describe('Unique workflow instance identifier'),
    workflowType: z.enum(['compilation', 'batch-compilation', 'cache-warming', 'health-monitoring']).describe('Type of workflow'),
});

const workflowStatusResponseSchema = z.object({
    success: z.boolean(),
    workflowId: z.string(),
    workflowType: z.string(),
    status: z.enum(['queued', 'running', 'paused', 'errored', 'terminated', 'complete', 'waiting', 'waitingForPause', 'unknown']).describe('Current workflow status'),
    output: z.unknown().optional().describe('Workflow output data if completed'),
    error: z.unknown().optional().describe('Error information if workflow failed'),
});

const workflowEventSchema = z.object({
    type: z.string().describe('Event type (e.g., "workflow:started", "workflow:progress", "workflow:completed")'),
    workflowId: z.string().describe('Workflow instance identifier'),
    workflowType: z.string().describe('Workflow type'),
    timestamp: z.string().datetime().describe('ISO 8601 event timestamp'),
    step: z.string().optional().describe('Workflow step identifier'),
    progress: z.number().min(0).max(100).optional().describe('Progress percentage (0-100)'),
    message: z.string().optional().describe('Human-readable event message'),
    data: z.record(z.string(), z.unknown()).optional().describe('Additional event data'),
});

const workflowEventsResponseSchema = z.object({
    success: z.boolean(),
    workflowId: z.string(),
    workflowType: z.string().optional(),
    startedAt: z.string().datetime().optional().describe('ISO 8601 workflow start time'),
    completedAt: z.string().datetime().optional().describe('ISO 8601 workflow completion time'),
    progress: z.number().min(0).max(100).optional().describe('Current progress percentage'),
    isComplete: z.boolean().optional().describe('Whether workflow has completed or failed'),
    events: z.array(workflowEventSchema).describe('Array of workflow events'),
    message: z.string().optional().describe('Message when no events found'),
});

const workflowMetricsResponseSchema = z.object({
    success: z.boolean(),
    timestamp: z.string().datetime().describe('ISO 8601 timestamp of metrics snapshot'),
    workflows: z.object({
        compilation: z.object({
            totalCompilations: z.number().int().nonnegative(),
        }).passthrough(),
        batchCompilation: z.object({
            totalBatches: z.number().int().nonnegative(),
        }).passthrough(),
        cacheWarming: z.object({
            totalRuns: z.number().int().nonnegative(),
        }).passthrough(),
        healthMonitoring: z.object({
            totalChecks: z.number().int().nonnegative(),
        }).passthrough(),
    }),
});

// ── Workflow (requireAuth) ────────────────────────────────────────────────────

const workflowCompileRoute = createRoute({
    method: 'post',
    path: '/workflow/compile',
    tags: ['Workflows'],
    summary: 'Start a compilation workflow',
    description: 'Triggers a long-running compilation workflow using Cloudflare Workflows. Returns immediately with a workflow ID for status polling.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: compileRequestSchema,
                },
            },
        },
    },
    responses: {
        202: {
            description: 'Workflow started successfully',
            content: {
                'application/json': {
                    schema: workflowStartResponseSchema,
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
        500: {
            description: 'Internal server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Workflow bindings not configured',
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

workflowRoutes.use('/workflow/compile', requireAuthMiddleware());
workflowRoutes.use('/workflow/compile', rateLimitMiddleware());
workflowRoutes.openapi(workflowCompileRoute, async (c) => {
    const { handleWorkflowCompile } = await import('../handlers/workflow.ts');
    // deno-lint-ignore no-explicit-any
    return handleWorkflowCompile(c.req.valid('json'), c.env) as any;
});

const workflowBatchRoute = createRoute({
    method: 'post',
    path: '/workflow/batch',
    tags: ['Workflows'],
    summary: 'Start a batch compilation workflow',
    description: 'Triggers a workflow to compile multiple configurations in a single batch. Returns immediately with a workflow ID.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: batchCompileRequestSchema,
                },
            },
        },
    },
    responses: {
        202: {
            description: 'Batch workflow started successfully',
            content: {
                'application/json': {
                    schema: workflowStartResponseSchema.extend({
                        batchSize: z.number().int().positive().describe('Number of items in the batch'),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid batch request',
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
        500: {
            description: 'Internal server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Workflow bindings not configured',
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

workflowRoutes.use('/workflow/batch', requireAuthMiddleware());
workflowRoutes.use('/workflow/batch', rateLimitMiddleware());
workflowRoutes.openapi(workflowBatchRoute, async (c) => {
    const { handleWorkflowBatchCompile } = await import('../handlers/workflow.ts');
    // deno-lint-ignore no-explicit-any
    return handleWorkflowBatchCompile(c.req.valid('json'), c.env) as any;
});

const workflowCacheWarmRoute = createRoute({
    method: 'post',
    path: '/workflow/cache-warm',
    tags: ['Workflows'],
    summary: 'Start a cache warming workflow',
    description: 'Triggers a workflow to pre-warm compilation caches for specified configurations. Returns immediately with a workflow ID.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: cacheWarmRequestSchema,
                },
            },
        },
    },
    responses: {
        202: {
            description: 'Cache warming workflow started successfully',
            content: {
                'application/json': {
                    schema: workflowStartResponseSchema.extend({
                        configurationsCount: z.union([z.number().int().nonnegative(), z.literal('default')]).describe('Number of configurations or "default"'),
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
        500: {
            description: 'Internal server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Workflow bindings not configured',
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

workflowRoutes.use('/workflow/cache-warm', requireAuthMiddleware());
workflowRoutes.use('/workflow/cache-warm', rateLimitMiddleware());
workflowRoutes.openapi(workflowCacheWarmRoute, async (c) => {
    const { handleWorkflowCacheWarm } = await import('../handlers/workflow.ts');
    // deno-lint-ignore no-explicit-any
    return handleWorkflowCacheWarm(c.req.valid('json'), c.env) as any;
});

const workflowHealthCheckRoute = createRoute({
    method: 'post',
    path: '/workflow/health-check',
    tags: ['Workflows'],
    summary: 'Start a health monitoring workflow',
    description: 'Triggers a workflow to check the health of filter list sources. Returns immediately with a workflow ID.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: healthCheckRequestSchema,
                },
            },
        },
    },
    responses: {
        202: {
            description: 'Health monitoring workflow started successfully',
            content: {
                'application/json': {
                    schema: workflowStartResponseSchema.extend({
                        sourcesCount: z.union([z.number().int().nonnegative(), z.literal('default')]).describe('Number of sources or "default"'),
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
        500: {
            description: 'Internal server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Workflow bindings not configured',
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

workflowRoutes.use('/workflow/health-check', requireAuthMiddleware());
workflowRoutes.use('/workflow/health-check', rateLimitMiddleware());
workflowRoutes.openapi(workflowHealthCheckRoute, async (c) => {
    const { handleWorkflowHealthCheck } = await import('../handlers/workflow.ts');
    // deno-lint-ignore no-explicit-any
    return handleWorkflowHealthCheck(c.req.valid('json'), c.env) as any;
});

const workflowStatusRoute = createRoute({
    method: 'get',
    path: '/workflow/status/{type}/{id}',
    tags: ['Workflows'],
    summary: 'Get workflow status',
    description: 'Returns the current status of a workflow instance by type and ID',
    request: {
        params: z.object({
            type: z.enum(['compilation', 'batch-compilation', 'cache-warming', 'health-monitoring']).describe('Workflow type'),
            id: z.string().describe('Workflow instance identifier'),
        }),
    },
    responses: {
        200: {
            description: 'Workflow status retrieved successfully',
            content: {
                'application/json': {
                    schema: workflowStatusResponseSchema,
                },
            },
        },
        400: {
            description: 'Invalid workflow type',
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
        404: {
            description: 'Workflow instance not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Workflow bindings not configured',
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

workflowRoutes.use('/workflow/status/:type/:id', requireAuthMiddleware());
workflowRoutes.use('/workflow/status/:type/:id', rateLimitMiddleware());
workflowRoutes.openapi(workflowStatusRoute, async (c) => {
    const { handleWorkflowStatus } = await import('../handlers/workflow.ts');
    const workflowType = c.req.param('type')!;
    const instanceId = c.req.param('id')!;
    // deno-lint-ignore no-explicit-any
    return handleWorkflowStatus(workflowType, instanceId, c.env) as any;
});

const workflowMetricsRoute = createRoute({
    method: 'get',
    path: '/workflow/metrics',
    tags: ['Workflows'],
    summary: 'Get aggregated workflow metrics',
    description: 'Returns aggregated metrics for all workflow types',
    responses: {
        200: {
            description: 'Workflow metrics retrieved successfully',
            content: {
                'application/json': {
                    schema: workflowMetricsResponseSchema,
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
        500: {
            description: 'Internal server error',
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

workflowRoutes.use('/workflow/metrics', requireAuthMiddleware());
workflowRoutes.use('/workflow/metrics', rateLimitMiddleware());
workflowRoutes.openapi(workflowMetricsRoute, async (c) => {
    const { handleWorkflowMetrics } = await import('../handlers/workflow.ts');
    // deno-lint-ignore no-explicit-any
    return handleWorkflowMetrics(c.env) as any;
});

const workflowEventsRoute = createRoute({
    method: 'get',
    path: '/workflow/events/{id}',
    tags: ['Workflows'],
    summary: 'Get workflow events',
    description: 'Returns the event log for a specific workflow instance. Optionally filter events after a specific timestamp using the "since" query parameter.',
    request: {
        params: z.object({
            id: z.string().describe('Workflow instance identifier'),
        }),
        query: z.object({
            since: z.string().datetime().optional().describe('ISO 8601 timestamp to filter events after'),
        }),
    },
    responses: {
        200: {
            description: 'Workflow events retrieved successfully',
            content: {
                'application/json': {
                    schema: workflowEventsResponseSchema,
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
        500: {
            description: 'Internal server error',
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

workflowRoutes.use('/workflow/events/:id', requireAuthMiddleware());
workflowRoutes.use('/workflow/events/:id', rateLimitMiddleware());
workflowRoutes.openapi(workflowEventsRoute, async (c) => {
    const { handleWorkflowEvents } = await import('../handlers/workflow.ts');
    const workflowId = c.req.param('id')!;
    const since = c.req.query('since');
    // deno-lint-ignore no-explicit-any
    return handleWorkflowEvents(workflowId, c.env, since) as any;
});

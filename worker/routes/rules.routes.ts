/// <reference types="@cloudflare/workers-types" />

/**
 * Rules (saved rule-sets) routes.
 *
 * Routes:
 *   GET    /rules
 *   POST   /rules
 *   GET    /rules/:id
 *   PUT    /rules/:id
 *   DELETE /rules/:id
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';

import { handleRulesCreate, handleRulesDelete, handleRulesGet, handleRulesList, handleRulesUpdate } from '../handlers/rules.ts';

export const rulesRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Inline OpenAPI-compatible schemas for rules
const ruleSetCreateRequestSchema = z.object({
    name: z.string().min(1).max(128).describe('Human-readable name for this rule set'),
    description: z.string().max(512).optional().describe('Optional description'),
    rules: z.array(z.string()).min(1, 'At least one rule is required').max(10_000, 'Maximum 10,000 rules per set'),
    tags: z.array(z.string().max(64)).max(20).optional().describe('Optional tags for categorisation'),
});

const ruleSetUpdateRequestSchema = z.object({
    name: z.string().min(1).max(128).optional(),
    description: z.string().max(512).optional(),
    rules: z.array(z.string()).min(1).max(10_000).optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
});

const ruleSetResponseSchema = z.object({
    id: z.string().uuid().describe('Unique identifier for the rule set'),
    name: z.string(),
    description: z.string().optional(),
    rules: z.array(z.string()),
    ruleCount: z.number().int().nonnegative(),
    tags: z.array(z.string()).optional(),
    createdAt: z.string().datetime().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().datetime().describe('ISO 8601 last-updated timestamp'),
});

// ── Rules (requireAuth) ───────────────────────────────────────────────────────

const listRulesRoute = createRoute({
    method: 'get',
    path: '/rules',
    tags: ['Rules'],
    summary: 'List saved rule sets',
    description: 'Returns all saved rule sets for the authenticated user',
    responses: {
        200: {
            description: 'List of rule sets',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        rules: z.array(ruleSetResponseSchema),
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

rulesRoutes.use('/rules', requireAuthMiddleware());
rulesRoutes.openapi(listRulesRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleRulesList(c.req.raw, c.env) as any;
});

const createRuleRoute = createRoute({
    method: 'post',
    path: '/rules',
    tags: ['Rules'],
    summary: 'Create a new rule set',
    description: 'Creates a new saved rule set for the authenticated user',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: ruleSetCreateRequestSchema,
                },
            },
        },
    },
    responses: {
        201: {
            description: 'Rule set created successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        ruleSet: ruleSetResponseSchema,
                    }),
                },
            },
        },
        400: {
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

rulesRoutes.use('/rules', bodySizeMiddleware());
rulesRoutes.use('/rules', rateLimitMiddleware());
rulesRoutes.openapi(createRuleRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleRulesCreate(c.req.raw, c.env) as any;
});

const getRuleRoute = createRoute({
    method: 'get',
    path: '/rules/{id}',
    tags: ['Rules'],
    summary: 'Get a rule set by ID',
    description: 'Returns a single saved rule set by its ID',
    request: {
        params: z.object({
            id: z.string().uuid().describe('Rule set ID'),
        }),
    },
    responses: {
        200: {
            description: 'Rule set found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        ruleSet: ruleSetResponseSchema,
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
            description: 'Rule set not found',
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

rulesRoutes.use('/rules/:id', requireAuthMiddleware());
rulesRoutes.openapi(getRuleRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleRulesGet(c.req.param('id')!, c.env) as any;
});

const updateRuleRoute = createRoute({
    method: 'put',
    path: '/rules/{id}',
    tags: ['Rules'],
    summary: 'Update a rule set',
    description: 'Updates an existing saved rule set',
    request: {
        params: z.object({
            id: z.string().uuid().describe('Rule set ID'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: ruleSetUpdateRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Rule set updated successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        ruleSet: ruleSetResponseSchema,
                    }),
                },
            },
        },
        400: {
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
            description: 'Rule set not found',
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

rulesRoutes.use('/rules/:id', bodySizeMiddleware());
rulesRoutes.use('/rules/:id', rateLimitMiddleware());
rulesRoutes.openapi(updateRuleRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleRulesUpdate(c.req.param('id')!, c.req.raw, c.env) as any;
});

const deleteRuleRoute = createRoute({
    method: 'delete',
    path: '/rules/{id}',
    tags: ['Rules'],
    summary: 'Delete a rule set',
    description: 'Deletes a saved rule set by its ID',
    request: {
        params: z.object({
            id: z.string().uuid().describe('Rule set ID'),
        }),
    },
    responses: {
        200: {
            description: 'Rule set deleted successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
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
            description: 'Rule set not found',
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

rulesRoutes.openapi(deleteRuleRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleRulesDelete(c.req.param('id')!, c.env) as any;
});

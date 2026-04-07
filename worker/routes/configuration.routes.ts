/// <reference types="@cloudflare/workers-types" />

/**
 * Configuration routes.
 *
 * Routes:
 *   GET  /configuration/defaults
 *   POST /configuration/validate
 *   POST /configuration/resolve
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cache } from 'hono/cache';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { buildSyntheticRequest, verifyTurnstileInline } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware } from '../middleware/hono-middleware.ts';

import { handleConfigurationDefaults, handleConfigurationResolve, handleConfigurationValidate } from '../handlers/configuration.ts';

export const configurationRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Configuration ─────────────────────────────────────────────────────────────

const configurationDefaultsRoute = createRoute({
    method: 'get',
    path: '/configuration/defaults',
    tags: ['Configuration'],
    summary: 'Get default configuration values',
    description: 'Returns system defaults and hard limits for compilation',
    responses: {
        200: {
            description: 'Default configuration values',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        defaults: z.object({
                            compilation: z.record(z.string(), z.unknown()),
                            validation: z.record(z.string(), z.unknown()),
                        }),
                        limits: z.record(z.string(), z.unknown()).optional(),
                    }),
                },
            },
        },
    },
});

configurationRoutes.use('/configuration/defaults', cache({ cacheName: 'config-defaults', cacheControl: 'public, max-age=300' }));
configurationRoutes.use('/configuration/defaults', rateLimitMiddleware());
configurationRoutes.openapi(configurationDefaultsRoute, async (c) => {
    const res = await handleConfigurationDefaults(c.req.raw, c.env);
    // deno-lint-ignore no-explicit-any
    return new Response(res.body, {
        status: res.status,
        headers: {
            ...Object.fromEntries(res.headers),
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        },
    }) as any;
});

const configurationValidateRoute = createRoute({
    method: 'post',
    path: '/configuration/validate',
    tags: ['Configuration'],
    summary: 'Validate configuration object',
    description: 'Validates a configuration object against the schema',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        config: z.record(z.string(), z.unknown()),
                        turnstileToken: z.string().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Configuration is valid',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        valid: z.boolean(),
                        errors: z.array(z.unknown()).optional(),
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
    },
});

configurationRoutes.use('/configuration/validate', bodySizeMiddleware());
configurationRoutes.use('/configuration/validate', rateLimitMiddleware());
configurationRoutes.openapi(configurationValidateRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleConfigurationValidate(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

const configurationResolveRoute = createRoute({
    method: 'post',
    path: '/configuration/resolve',
    tags: ['Configuration'],
    summary: 'Resolve configuration layers',
    description: 'Merges configuration layers and returns the effective configuration',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        config: z.record(z.string(), z.unknown()),
                        override: z.record(z.string(), z.unknown()).optional(),
                        applyEnvOverrides: z.boolean().optional(),
                        turnstileToken: z.string().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Resolved configuration',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        config: z.record(z.string(), z.unknown()),
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
    },
});

configurationRoutes.use('/configuration/resolve', bodySizeMiddleware());
configurationRoutes.use('/configuration/resolve', rateLimitMiddleware());
configurationRoutes.openapi(configurationResolveRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleConfigurationResolve(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

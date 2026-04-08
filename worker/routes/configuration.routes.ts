/// <reference types="@cloudflare/workers-types" />

/**
 * Configuration routes.
 *
 * Routes:
 *   GET  /configuration/defaults
 *   POST /configuration/validate
 *   POST /configuration/resolve
 *   POST /configuration/create
 *   GET  /configuration/download/:id
 *   GET  /configuration/saved
 *   POST /configuration/saved
 *   DELETE /configuration/saved/:id
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { cache } from 'hono/cache';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { buildSyntheticRequest, verifyTurnstileInline } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';

import {
    handleConfigurationCreate,
    handleConfigurationDefaults,
    handleConfigurationDownload,
    handleConfigurationResolve,
    handleConfigurationValidate,
} from '../handlers/configuration.ts';

import { handleDeleteSavedConfiguration, handleListSavedConfigurations, handleSaveConfiguration } from '../handlers/saved-configurations.ts';

import { JsonResponse } from '../utils/response.ts';
import { createPgPool } from '../utils/pg-pool.ts';

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

const configurationCreateRoute = createRoute({
    method: 'post',
    path: '/configuration/create',
    tags: ['Configuration'],
    summary: 'Create and store configuration',
    description: 'Creates and stores a configuration file, returning an ID for download',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        config: z.record(z.string(), z.unknown()),
                        format: z.enum(['json', 'yaml']).optional(),
                        turnstileToken: z.string().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Configuration created successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        id: z.string().optional(),
                        format: z.string().optional(),
                        expiresIn: z.number().optional(),
                        valid: z.boolean().optional(),
                        errors: z.array(z.unknown()).optional(),
                    }),
                },
            },
        },
        400: {
            description: 'Bad request',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Turnstile verification failed',
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

configurationRoutes.use('/configuration/create', bodySizeMiddleware());
configurationRoutes.use('/configuration/create', rateLimitMiddleware());
configurationRoutes.openapi(configurationCreateRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleConfigurationCreate(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

const configurationDownloadRoute = createRoute({
    method: 'get',
    path: '/configuration/download/:id',
    tags: ['Configuration'],
    summary: 'Download stored configuration',
    description: 'Downloads a previously stored configuration file',
    request: {
        params: z.object({
            id: z.string().uuid(),
        }),
        query: z.object({
            format: z.enum(['json', 'yaml']).optional(),
        }),
    },
    responses: {
        200: {
            description: 'Configuration file',
            content: {
                'application/json': {
                    schema: z.unknown(),
                },
                'application/x-yaml': {
                    schema: z.unknown(),
                },
            },
        },
        404: {
            description: 'Configuration not found',
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

configurationRoutes.use('/configuration/download/:id', rateLimitMiddleware());
configurationRoutes.openapi(configurationDownloadRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    // deno-lint-ignore no-explicit-any
    return handleConfigurationDownload(id, format, c.env) as any;
});

/** Auth methods that represent an interactive user session (not API key or anonymous). */
const INTERACTIVE_AUTH_METHODS = new Set(['better-auth']);

// ── Saved configurations (Better Auth interactive session required) ────────

const savedConfigItemSchema = z.object({
    id: z.string().uuid().describe('Unique identifier'),
    name: z.string().describe('Human-readable name'),
    description: z.string().nullable().describe('Optional description'),
    createdAt: z.string().datetime().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().datetime().describe('ISO 8601 last-updated timestamp'),
});

const listSavedConfigsRoute = createRoute({
    method: 'get',
    path: '/configuration/saved',
    tags: ['Configuration'],
    summary: 'List saved configurations',
    description: 'Returns up to 50 saved configurations for the authenticated user, ordered by most recently updated.',
    responses: {
        200: {
            description: 'List of saved configurations',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        configs: z.array(savedConfigItemSchema),
                        total: z.number().int().nonnegative(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        403: {
            description: 'Forbidden — requires an interactive user session',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        503: {
            description: 'Database not configured',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

configurationRoutes.use('/configuration/saved', requireAuthMiddleware());
configurationRoutes.use('/configuration/saved', rateLimitMiddleware());
configurationRoutes.openapi(listSavedConfigsRoute, async (c) => {
    if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('Saved configurations require an authenticated user session');
    if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
    // deno-lint-ignore no-explicit-any
    return handleListSavedConfigurations(c.req.raw, c.env, c.get('authContext'), createPgPool(c.env.HYPERDRIVE.connectionString)) as any;
});

const saveSavedConfigRoute = createRoute({
    method: 'post',
    path: '/configuration/saved',
    tags: ['Configuration'],
    summary: 'Save a configuration',
    description: "Persists a configuration to the authenticated user's account.",
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().min(1).max(128).describe('Human-readable name'),
                        description: z.string().max(512).optional().describe('Optional description'),
                        config: z.record(z.string(), z.unknown()).describe('Configuration object to persist'),
                    }),
                },
            },
        },
    },
    responses: {
        201: {
            description: 'Configuration saved successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        id: z.string().uuid(),
                        name: z.string(),
                        description: z.string().nullable(),
                        config: z.record(z.string(), z.unknown()),
                        createdAt: z.string().datetime(),
                        updatedAt: z.string().datetime(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid request body',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        403: {
            description: 'Forbidden — requires an interactive user session',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        503: {
            description: 'Database not configured',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

configurationRoutes.openapi(saveSavedConfigRoute, async (c) => {
    if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('Saved configurations require an authenticated user session');
    if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
    // deno-lint-ignore no-explicit-any
    return handleSaveConfiguration(c.req.raw, c.env, c.get('authContext'), createPgPool(c.env.HYPERDRIVE.connectionString), c.req.valid('json')) as any;
});

const deleteSavedConfigRoute = createRoute({
    method: 'delete',
    path: '/configuration/saved/{id}',
    tags: ['Configuration'],
    summary: 'Delete a saved configuration',
    description: 'Permanently deletes a saved configuration owned by the authenticated user.',
    request: {
        params: z.object({
            id: z.string().uuid().describe('Saved configuration ID'),
        }),
    },
    responses: {
        204: {
            description: 'Configuration deleted',
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        403: {
            description: 'Forbidden — requires an interactive user session',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        404: {
            description: 'Configuration not found',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        503: {
            description: 'Database not configured',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

configurationRoutes.use('/configuration/saved/:id', requireAuthMiddleware());
configurationRoutes.use('/configuration/saved/:id', rateLimitMiddleware());
configurationRoutes.openapi(deleteSavedConfigRoute, async (c) => {
    if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('Saved configurations require an authenticated user session');
    if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
    const { id } = c.req.valid('param');
    // deno-lint-ignore no-explicit-any
    return handleDeleteSavedConfiguration(c.req.raw, c.env, c.get('authContext'), createPgPool(c.env.HYPERDRIVE.connectionString), id) as any;
});

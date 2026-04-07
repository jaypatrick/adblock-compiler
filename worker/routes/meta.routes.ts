/// <reference types="@cloudflare/workers-types" />

/**
 * Meta/info routes — API discovery, version, deployment history, config endpoints.
 *
 * Routes:
 *   GET /api
 *   GET /api/version
 *   GET /api/schemas
 *   GET /api/deployments
 *   GET /api/deployments/stats
 *   GET /api/turnstile-config
 *   GET /api/sentry-config
 *   GET /api/auth/providers
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

export const metaRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Inline OpenAPI-compatible schemas for meta routes ────────────────────────

const apiInfoResponseSchema = z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
    repository: z.string(),
    endpoints: z.object({
        compile: z.string(),
        validate: z.string(),
        ast: z.string(),
        monitoring: z.string(),
        configuration: z.string(),
        documentation: z.string(),
        openapi: z.string(),
    }),
    features: z.array(z.string()),
    authentication: z.object({
        methods: z.array(z.string()),
        providers: z.string(),
    }),
});

const deploymentInfoSchema = z.object({
    version: z.string(),
    buildNumber: z.string(),
    fullVersion: z.string(),
    gitCommit: z.string().nullable(),
    gitBranch: z.string().nullable(),
    deployedAt: z.date(),
    deployedBy: z.string().nullable(),
    status: z.string(),
    metadata: z.unknown().nullable(),
});

const versionResponseSchema = z.object({
    success: z.boolean(),
    version: z.string().optional(),
    buildNumber: z.string().optional(),
    fullVersion: z.string().optional(),
    gitCommit: z.string().nullable().optional(),
    gitBranch: z.string().nullable().optional(),
    deployedAt: z.date().optional(),
    deployedBy: z.string().nullable().optional(),
    status: z.string().optional(),
    metadata: z.unknown().nullable().optional(),
    message: z.string().optional(),
});

const deploymentsResponseSchema = z.object({
    success: z.boolean(),
    deployments: z.array(deploymentInfoSchema),
    count: z.number().int().nonnegative(),
});

const deploymentStatsResponseSchema = z.object({
    success: z.boolean(),
    totalDeployments: z.number().int().nonnegative(),
    successfulDeployments: z.number().int().nonnegative(),
    failedDeployments: z.number().int().nonnegative(),
    latestVersion: z.string().nullable(),
});

const turnstileConfigResponseSchema = z.object({
    siteKey: z.string().nullable(),
    enabled: z.boolean(),
});

const sentryConfigResponseSchema = z.object({
    dsn: z.string().nullable(),
    environment: z.string(),
    enabled: z.boolean(),
});

const authProvidersResponseSchema = z.object({
    success: z.boolean(),
    emailPassword: z.boolean(),
    github: z.boolean(),
    google: z.boolean(),
});

const schemasResponseSchema = z.object({
    success: z.boolean(),
    schemas: z.record(z.string(), z.unknown()),
});

// ── Meta Routes ───────────────────────────────────────────────────────────────

const apiInfoRoute = createRoute({
    method: 'get',
    path: '/api',
    tags: ['Meta'],
    summary: 'Get API information',
    description: 'Returns general information about the Adblock Compiler API, including available endpoints and features',
    responses: {
        200: {
            description: 'API information',
            content: {
                'application/json': {
                    schema: apiInfoResponseSchema,
                },
            },
        },
    },
});

metaRoutes.openapi(apiInfoRoute, async (c) => {
    const { handleInfo } = await import('../handlers/info.ts');
    // deno-lint-ignore no-explicit-any
    return handleInfo(c.req.raw, c.env) as any;
});

const versionRoute = createRoute({
    method: 'get',
    path: '/api/version',
    tags: ['Meta'],
    summary: 'Get API version',
    description: 'Returns the current API version and deployment information from the latest successful deployment',
    responses: {
        200: {
            description: 'Version information',
            content: {
                'application/json': {
                    schema: versionResponseSchema,
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                        version: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                        version: z.string(),
                    }),
                },
            },
        },
    },
});

metaRoutes.openapi(versionRoute, async (c) => {
    const { routeApiMeta } = await import('../handlers/info.ts');
    const url = new URL(c.req.url);
    // deno-lint-ignore no-explicit-any
    return (await routeApiMeta(c.req.path, c.req.raw, url, c.env)) as any;
});

const schemasRoute = createRoute({
    method: 'get',
    path: '/api/schemas',
    tags: ['Meta'],
    summary: 'Get validation schemas',
    description: 'Returns all Zod validation schemas used by the API for request/response validation',
    responses: {
        200: {
            description: 'Validation schemas',
            content: {
                'application/json': {
                    schema: schemasResponseSchema,
                },
            },
        },
    },
});

metaRoutes.openapi(schemasRoute, async (c) => {
    const { handleSchemas } = await import('../handlers/schemas.ts');
    // deno-lint-ignore no-explicit-any
    return handleSchemas(c.req.raw, c.env) as any;
});

const deploymentsRoute = createRoute({
    method: 'get',
    path: '/api/deployments',
    tags: ['Meta'],
    summary: 'List deployment history',
    description: 'Returns deployment history, optionally filtered by version, status, or branch',
    request: {
        query: z.object({
            limit: z.coerce.number().int().min(1).max(1000).default(50).optional().describe('Maximum number of deployments to return'),
            version: z.string().optional().describe('Filter by version'),
            status: z.string().optional().describe('Filter by deployment status (success, failed)'),
            branch: z.string().optional().describe('Filter by git branch'),
        }),
    },
    responses: {
        200: {
            description: 'Deployment history',
            content: {
                'application/json': {
                    schema: deploymentsResponseSchema,
                },
            },
        },
        500: {
            description: 'Server error',
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
            description: 'Database not configured',
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

metaRoutes.openapi(deploymentsRoute, async (c) => {
    const { routeApiMeta } = await import('../handlers/info.ts');
    const url = new URL(c.req.url);
    // deno-lint-ignore no-explicit-any
    return (await routeApiMeta(c.req.path, c.req.raw, url, c.env)) as any;
});

const deploymentStatsRoute = createRoute({
    method: 'get',
    path: '/api/deployments/stats',
    tags: ['Meta'],
    summary: 'Get deployment statistics',
    description: 'Returns aggregate deployment statistics including total, successful, and failed deployment counts',
    responses: {
        200: {
            description: 'Deployment statistics',
            content: {
                'application/json': {
                    schema: deploymentStatsResponseSchema,
                },
            },
        },
        500: {
            description: 'Server error',
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
            description: 'Database not configured',
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

metaRoutes.openapi(deploymentStatsRoute, async (c) => {
    const { routeApiMeta } = await import('../handlers/info.ts');
    const url = new URL(c.req.url);
    // deno-lint-ignore no-explicit-any
    return (await routeApiMeta(c.req.path, c.req.raw, url, c.env)) as any;
});

const turnstileConfigRoute = createRoute({
    method: 'get',
    path: '/api/turnstile-config',
    tags: ['Meta'],
    summary: 'Get Cloudflare Turnstile configuration',
    description: 'Returns public Turnstile site key and whether Turnstile verification is enabled',
    responses: {
        200: {
            description: 'Turnstile configuration',
            content: {
                'application/json': {
                    schema: turnstileConfigResponseSchema,
                },
            },
        },
    },
});

metaRoutes.openapi(turnstileConfigRoute, async (c) => {
    const { routeApiMeta } = await import('../handlers/info.ts');
    const url = new URL(c.req.url);
    // deno-lint-ignore no-explicit-any
    return (await routeApiMeta(c.req.path, c.req.raw, url, c.env)) as any;
});

const sentryConfigRoute = createRoute({
    method: 'get',
    path: '/api/sentry-config',
    tags: ['Meta'],
    summary: 'Get Sentry configuration',
    description: 'Returns public Sentry DSN and environment for frontend error tracking',
    responses: {
        200: {
            description: 'Sentry configuration',
            content: {
                'application/json': {
                    schema: sentryConfigResponseSchema,
                },
            },
        },
    },
});

metaRoutes.openapi(sentryConfigRoute, async (c) => {
    const { routeApiMeta } = await import('../handlers/info.ts');
    const url = new URL(c.req.url);
    // deno-lint-ignore no-explicit-any
    return (await routeApiMeta(c.req.path, c.req.raw, url, c.env)) as any;
});

const authProvidersRoute = createRoute({
    method: 'get',
    path: '/api/auth/providers',
    tags: ['Meta'],
    summary: 'Get available auth providers',
    description: 'Returns which authentication providers are currently active (email/password, GitHub, Google)',
    responses: {
        200: {
            description: 'Auth providers configuration',
            content: {
                'application/json': {
                    schema: authProvidersResponseSchema,
                },
            },
        },
    },
});

metaRoutes.openapi(authProvidersRoute, async (c) => {
    const { handleAuthProviders } = await import('../handlers/auth-providers.ts');
    // deno-lint-ignore no-explicit-any
    return handleAuthProviders(c.req.raw, c.env) as any;
});

/// <reference types="@cloudflare/workers-types" />

/**
 * API key management routes.
 *
 * Routes:
 *   POST   /keys
 *   GET    /keys
 *   DELETE /keys/:id
 *   PATCH  /keys/:id
 *
 * NOTE: Only interactive user sessions (Better Auth cookie/bearer) may manage
 * API keys. API-key-on-API-key and anonymous requests are rejected.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';

import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey, handleUpdateApiKey } from '../handlers/api-keys.ts';
import { JsonResponse } from '../utils/response.ts';
import { createPgPool } from '../utils/pg-pool.ts';

/** Auth methods that represent an interactive user session (not API key or anonymous). */
const INTERACTIVE_AUTH_METHODS = new Set(['better-auth']);

export const apiKeysRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Inline OpenAPI-compatible schemas for API key management
const createApiKeyRequestSchema = z.object({
    name: z.string().min(1).max(128).describe('Human-readable name for the API key'),
    scopes: z.array(z.string()).min(1).max(10).describe('Array of permission scopes'),
    expiresInDays: z.number().int().min(1).max(365).optional().describe('Optional expiration period in days'),
});

const updateApiKeyRequestSchema = z.object({
    name: z.string().min(1).max(128).optional().describe('Updated name for the API key'),
    scopes: z.array(z.string()).min(1).max(10).optional().describe('Updated permission scopes'),
});

const apiKeyListItemSchema = z.object({
    id: z.string().uuid().describe('Unique identifier for the API key'),
    keyPrefix: z.string().describe('First few characters of the key (for identification)'),
    name: z.string().describe('Human-readable name'),
    scopes: z.array(z.string()).describe('Permission scopes'),
    rateLimitPerMinute: z.number().int().nonnegative().describe('Rate limit for this key'),
    lastUsedAt: z.string().datetime().nullable().describe('ISO 8601 timestamp of last use'),
    expiresAt: z.string().datetime().nullable().describe('ISO 8601 expiration timestamp'),
    revokedAt: z.string().datetime().nullable().describe('ISO 8601 revocation timestamp'),
    createdAt: z.string().datetime().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().datetime().describe('ISO 8601 last-updated timestamp'),
    isActive: z.boolean().describe('Whether the key is currently active'),
});

// ── API Keys (requireAuth + interactive session — Better Auth only) ──

const createApiKeyRoute = createRoute({
    method: 'post',
    path: '/keys',
    tags: ['API Keys'],
    summary: 'Create a new API key',
    description: 'Creates a new API key for the authenticated user. Requires an interactive user session (Better Auth). The plaintext key is returned only once.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: createApiKeyRequestSchema,
                },
            },
        },
    },
    responses: {
        201: {
            description: 'API key created successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        id: z.string().uuid(),
                        key: z.string(),
                        keyPrefix: z.string(),
                        name: z.string(),
                        scopes: z.array(z.string()),
                        rateLimitPerMinute: z.number(),
                        expiresAt: z.string().datetime().nullable(),
                        createdAt: z.string().datetime(),
                    }),
                },
            },
        },
        400: {
            description: 'Validation error or key limit exceeded',
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
        403: {
            description: 'Forbidden - requires interactive user session',
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

apiKeysRoutes.use('/keys', requireAuthMiddleware());
apiKeysRoutes.use('/keys', rateLimitMiddleware());
apiKeysRoutes.openapi(createApiKeyRoute, async (c) => {
    if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
    if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
    // deno-lint-ignore no-explicit-any
    return handleCreateApiKey(c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool) as any;
});

const listApiKeysRoute = createRoute({
    method: 'get',
    path: '/keys',
    tags: ['API Keys'],
    summary: 'List API keys',
    description: 'Returns all API keys for the authenticated user. Requires an interactive user session (Better Auth).',
    responses: {
        200: {
            description: 'List of API keys',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        keys: z.array(apiKeyListItemSchema),
                        total: z.number().int().nonnegative(),
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
        403: {
            description: 'Forbidden - requires interactive user session',
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

apiKeysRoutes.openapi(listApiKeysRoute, async (c) => {
    if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
    if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
    // deno-lint-ignore no-explicit-any
    return handleListApiKeys(c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool) as any;
});

const revokeApiKeyRoute = createRoute({
    method: 'delete',
    path: '/keys/{id}',
    tags: ['API Keys'],
    summary: 'Revoke an API key',
    description: 'Soft-deletes an API key by setting its revoked_at timestamp. Requires an interactive user session (Better Auth).',
    request: {
        params: z.object({
            id: z.string().uuid().describe('API key ID'),
        }),
    },
    responses: {
        200: {
            description: 'API key revoked successfully',
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
        403: {
            description: 'Forbidden - requires interactive user session',
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
            description: 'API key not found or already revoked',
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

apiKeysRoutes.use('/keys/:id', requireAuthMiddleware());
apiKeysRoutes.use('/keys/:id', rateLimitMiddleware());
apiKeysRoutes.openapi(revokeApiKeyRoute, async (c) => {
    if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
    if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
    // deno-lint-ignore no-explicit-any
    return handleRevokeApiKey(c.req.param('id')!, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool) as any;
});

const updateApiKeyRoute = createRoute({
    method: 'patch',
    path: '/keys/{id}',
    tags: ['API Keys'],
    summary: 'Update an API key',
    description: "Updates an API key's name or scopes. Requires an interactive user session (Better Auth).",
    request: {
        params: z.object({
            id: z.string().uuid().describe('API key ID'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: updateApiKeyRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'API key updated successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        id: z.string().uuid(),
                        keyPrefix: z.string(),
                        name: z.string(),
                        scopes: z.array(z.string()),
                        rateLimitPerMinute: z.number(),
                        lastUsedAt: z.string().datetime().nullable(),
                        expiresAt: z.string().datetime().nullable(),
                        createdAt: z.string().datetime(),
                        updatedAt: z.string().datetime(),
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
        403: {
            description: 'Forbidden - requires interactive user session',
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
            description: 'API key not found or already revoked',
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

apiKeysRoutes.openapi(updateApiKeyRoute, async (c) => {
    if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
    if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
    // deno-lint-ignore no-explicit-any
    return handleUpdateApiKey(c.req.param('id')!, c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool) as any;
});

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

import { OpenAPIHono } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { zodValidationError } from './shared.ts';

import { rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';

import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey, handleUpdateApiKey } from '../handlers/api-keys.ts';
import { CreateApiKeyRequestSchema, UpdateApiKeyRequestSchema } from '../schemas.ts';
import { JsonResponse } from '../utils/response.ts';
import { createPgPool } from '../utils/pg-pool.ts';

/** Auth methods that represent an interactive user session (not API key or anonymous). */
const INTERACTIVE_AUTH_METHODS = new Set(['better-auth']);

export const apiKeysRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── API Keys (requireAuth + interactive session — Better Auth only) ──
//
// Only interactive user sessions (Better Auth cookie/bearer) may manage
// API keys. API-key-on-API-key and anonymous requests are rejected.

apiKeysRoutes.post(
    '/keys',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CreateApiKeyRequestSchema as any, zodValidationError),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleCreateApiKey(c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

apiKeysRoutes.get(
    '/keys',
    requireAuthMiddleware(),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleListApiKeys(c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

apiKeysRoutes.delete(
    '/keys/:id',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleRevokeApiKey(c.req.param('id')!, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

apiKeysRoutes.patch(
    '/keys/:id',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', UpdateApiKeyRequestSchema as any, zodValidationError),
    async (c) => {
        if (!INTERACTIVE_AUTH_METHODS.has(c.get('authContext').authMethod)) return JsonResponse.forbidden('API key management requires an authenticated user session');
        if (!c.env.HYPERDRIVE) return JsonResponse.serviceUnavailable('Database not configured');
        return handleUpdateApiKey(c.req.param('id')!, c.req.raw, c.get('authContext'), c.env.HYPERDRIVE.connectionString, createPgPool);
    },
);

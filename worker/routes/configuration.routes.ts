/// <reference types="@cloudflare/workers-types" />

/**
 * Configuration routes.
 *
 * Routes:
 *   GET  /configuration/defaults
 *   POST /configuration/validate
 *   POST /configuration/resolve
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';
import { cache } from 'hono/cache';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { buildSyntheticRequest, verifyTurnstileInline, zodValidationError } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, turnstileMiddleware } from '../middleware/hono-middleware.ts';

import { handleConfigurationDefaults, handleConfigurationResolve, handleConfigurationValidate } from '../handlers/configuration.ts';
import { ConfigurationValidateRequestSchema, ResolveRequestSchema } from '../handlers/configuration.ts';

export const configurationRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Configuration ─────────────────────────────────────────────────────────────

configurationRoutes.get(
    '/configuration/defaults',
    cache({ cacheName: 'config-defaults', cacheControl: 'public, max-age=300' }),
    rateLimitMiddleware(),
    async (c) => {
        const res = await handleConfigurationDefaults(c.req.raw, c.env);
        return new Response(res.body, {
            status: res.status,
            headers: {
                ...Object.fromEntries(res.headers),
                'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
            },
        });
    },
);

configurationRoutes.post(
    '/configuration/validate',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ConfigurationValidateRequestSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleConfigurationValidate(buildSyntheticRequest(c, c.req.valid('json')), c.env);
    },
);

configurationRoutes.post(
    '/configuration/resolve',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ResolveRequestSchema as any, zodValidationError),
    turnstileMiddleware(),
    (c) => handleConfigurationResolve(c.req.raw, c.env),
);

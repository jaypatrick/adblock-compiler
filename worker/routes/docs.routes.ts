/// <reference types="@cloudflare/workers-types" />

/**
 * Documentation routes — Scalar and Swagger UI endpoints for OpenAPI docs.
 *
 * Routes:
 *   GET /api/docs — Scalar UI (modern OpenAPI documentation)
 *   GET /api/swagger — Swagger UI (traditional OpenAPI documentation)
 *
 * Both consume the live OpenAPI spec from /api/openapi.json
 *
 * Note: These routes are mounted under the `/api` prefix via the routes sub-app,
 * so the paths here don't include `/api`.
 */

import { apiReference } from '@scalar/hono-api-reference';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

export const docsRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Scalar UI endpoint ────────────────────────────────────────────────────────
// Modern, beautiful OpenAPI documentation UI at /api/docs
// Reference: https://hono.dev/examples/scalar/

docsRoutes.get(
    '/docs',
    apiReference({
        theme: 'purple',
        url: '/api/openapi.json',
        pageTitle: 'Adblock Compiler API Documentation',
        metaData: {
            title: 'Adblock Compiler API',
            description: 'Compiler-as-a-Service for adblock filter lists. Transform, optimize, and combine filter lists from multiple sources.',
            ogDescription: 'Interactive API documentation for Adblock Compiler',
        },
    }),
);

// ── Swagger UI endpoint ───────────────────────────────────────────────────────
// Traditional Swagger UI documentation at /api/swagger
// Reference: https://hono.dev/examples/swagger-ui/

docsRoutes.get('/swagger', swaggerUI({ url: '/api/openapi.json' }));

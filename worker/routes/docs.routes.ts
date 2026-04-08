/**
 * API Documentation Routes (Scalar & Swagger UI)
 *
 * Interactive API documentation interfaces using the auto-generated OpenAPI spec.
 * Both UIs read from `/api/openapi.json` which is generated from the Hono app's
 * OpenAPI route definitions.
 *
 * ## Endpoints
 * - GET /api/docs — Scalar API Reference (modern, clean UI)
 * - GET /api/swagger — Swagger UI (classic, widely-known UI)
 *
 * ## Security
 * Public endpoints — no authentication required. The OpenAPI spec itself is public
 * (served at `/api/openapi.json`), so the UI wrappers are also public.
 *
 * ## Why two UIs?
 * - **Scalar** — Modern, fast, clean design with better DX
 * - **Swagger UI** — Industry standard, familiar to most developers
 *
 * @see worker/hono-app.ts — OpenAPI spec generation
 * @see https://hono.dev/examples/scalar
 * @see https://hono.dev/examples/swagger
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { apiReference } from '@scalar/hono-api-reference';
import { swaggerUI } from '@hono/swagger-ui';

const docsRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ============================================================================
// Scalar API Reference (Modern UI)
// ============================================================================

/**
 * Scalar API Reference endpoint.
 *
 * Serves an interactive, modern API documentation interface using Scalar.
 * Reads the OpenAPI spec from `/api/openapi.json`.
 */
docsRoutes.get(
    '/docs',
    apiReference({
        spec: {
            url: '/api/openapi.json',
        },
        pageTitle: 'Adblock Compiler API',
        metaData: {
            title: 'Adblock Compiler API',
            description: 'Compiler-as-a-Service for adblock filter lists. Transform, optimize, and combine filter lists from multiple sources.',
            ogDescription: 'Interactive API documentation for the Adblock Compiler API',
            ogTitle: 'Adblock Compiler API Documentation',
        },
        theme: 'purple',
        layout: 'modern',
        darkMode: true,
        defaultHttpClient: {
            targetKey: 'javascript',
            clientKey: 'fetch',
        },
        customCss: `
            .scalar-api-client__header {
                border-bottom: 1px solid var(--scalar-border-color);
            }
        `,
    }),
);

// ============================================================================
// Swagger UI (Classic UI)
// ============================================================================

/**
 * Swagger UI endpoint.
 *
 * Serves the classic Swagger UI interface for API documentation.
 * Reads the OpenAPI spec from `/api/openapi.json`.
 */
docsRoutes.get(
    '/swagger',
    swaggerUI({
        url: '/api/openapi.json',
        pageTitle: 'Adblock Compiler API - Swagger UI',
    }),
);

// ============================================================================
// Exports
// ============================================================================

export { docsRoutes };

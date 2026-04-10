/// <reference types="@cloudflare/workers-types" />

/**
 * Browser routes.
 *
 * Routes:
 *   GET /browser/health   — checks whether the BROWSER binding is configured
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

export const browserRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Browser binding health check ──────────────────────────────────────────────

const browserHealthRoute = createRoute({
    method: 'get',
    path: '/browser/health',
    tags: ['Browser'],
    operationId: 'browserHealth',
    summary: 'Browser Rendering binding health check',
    description:
        'Returns `{ ok: true }` when the `BROWSER` binding (Cloudflare Browser Rendering) is ' +
        'configured, or `{ ok: false, error: "..." }` when it is absent. ' +
        'This is a configuration check only — it does not make a live request to the Browser Rendering service. ' +
        'This endpoint is publicly accessible and requires no authentication.',
    responses: {
        200: {
            description: 'BROWSER binding is configured',
            content: {
                'application/json': {
                    schema: z.object({ ok: z.literal(true) }),
                },
            },
        },
        503: {
            description: 'BROWSER binding is not configured',
            content: {
                'application/json': {
                    schema: z.object({
                        ok: z.literal(false),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

browserRoutes.openapi(browserHealthRoute, (c) => {
    if (c.env.BROWSER) {
        // deno-lint-ignore no-explicit-any
        return c.json({ ok: true as const }, 200) as any;
    }
    // deno-lint-ignore no-explicit-any
    return c.json(
        {
            ok: false as const,
            error:
                'BROWSER binding is not configured. ' +
                'Add `[browser]\\nbinding = "BROWSER"` to wrangler.toml and redeploy.',
        },
        503,
    ) as any;
});

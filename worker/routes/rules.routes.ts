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

import { OpenAPIHono } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { zodValidationError } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';

import { handleRulesCreate, handleRulesDelete, handleRulesGet, handleRulesList, handleRulesUpdate } from '../handlers/rules.ts';
import { RuleSetCreateSchema, RuleSetUpdateSchema } from '../schemas.ts';

export const rulesRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Rules (requireAuth) ───────────────────────────────────────────────────────

rulesRoutes.get(
    '/rules',
    requireAuthMiddleware(),
    (c) => handleRulesList(c.req.raw, c.env),
);

rulesRoutes.post(
    '/rules',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', RuleSetCreateSchema as any, zodValidationError),
    (c) => handleRulesCreate(c.req.raw, c.env),
);

rulesRoutes.get(
    '/rules/:id',
    requireAuthMiddleware(),
    (c) => handleRulesGet(c.req.param('id')!, c.env),
);

rulesRoutes.put(
    '/rules/:id',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', RuleSetUpdateSchema as any, zodValidationError),
    (c) => handleRulesUpdate(c.req.param('id')!, c.req.raw, c.env),
);

rulesRoutes.delete(
    '/rules/:id',
    requireAuthMiddleware(),
    rateLimitMiddleware(),
    (c) => handleRulesDelete(c.req.param('id')!, c.env),
);

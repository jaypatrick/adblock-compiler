/// <reference types="@cloudflare/workers-types" />

/**
 * Webhook notification routes.
 *
 * Routes:
 *   POST /notify
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { zodValidationError } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, requireAuthMiddleware } from '../middleware/hono-middleware.ts';

import { handleNotify } from '../handlers/webhook.ts';
import { WebhookNotifyRequestSchema } from '../schemas.ts';

export const webhookRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Webhooks ──────────────────────────────────────────────────────────────────

webhookRoutes.post(
    '/notify',
    requireAuthMiddleware(),
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', WebhookNotifyRequestSchema as any, zodValidationError),
    (c) => handleNotify(c.req.raw, c.env),
);

/// <reference types="@cloudflare/workers-types" />

/**
 * Queue routes (lazy-loaded handler).
 *
 * Routes:
 *   ALL /queue/*
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

export const queueRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Queue (lazy) ──────────────────────────────────────────────────────────────

queueRoutes.all('/queue/*', async (c) => {
    const { routeQueue } = await import('../handlers/queue.ts');
    return routeQueue(c.req.path, c.req.raw, c.env, c.get('authContext'), c.get('analytics'), c.get('ip'));
});

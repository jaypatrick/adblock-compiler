/// <reference types="@cloudflare/workers-types" />

/**
 * Workflow routes (lazy-loaded handler).
 *
 * Routes:
 *   ALL /workflow/*
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

export const workflowRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Workflow (lazy) ───────────────────────────────────────────────────────────

workflowRoutes.all('/workflow/*', async (c) => {
    const { routeWorkflow } = await import('../handlers/workflow.ts');
    const url = new URL(c.req.url);
    return routeWorkflow(c.req.path, c.req.raw, c.env, c.get('authContext'), c.get('analytics'), c.get('ip'), url);
});

/// <reference types="@cloudflare/workers-types" />

/**
 * Workflow Diagram routes.
 *
 * Routes:
 *   GET /workflow/diagram         — diagram metadata for all registered workflows
 *   GET /workflow/diagram/:name   — diagram for a single workflow by name
 *
 * Valid workflow names: compilation, batch-compilation, cache-warming, health-monitoring
 *
 * These endpoints are read-only metadata endpoints.
 * Access is still subject to the application's route-permission middleware and configured tier requirements.
 * They are intended for observability tooling and developer exploration for callers with the required access.
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import { WorkflowDiagramBuilder } from '../workflows/diagram.ts';
import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { ProblemResponse } from '../utils/problem-details.ts';

export const workflowDiagramRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── GET /workflow/diagram ──────────────────────────────────────────────────────

workflowDiagramRoutes.get('/workflow/diagram', (c) => {
    // Capture a single timestamp so all diagrams in the response share the same generatedAt value.
    const generatedAt = new Date().toISOString();
    const diagrams = WorkflowDiagramBuilder.list().map((name) => WorkflowDiagramBuilder.build(name, generatedAt));
    return c.json({ success: true, diagrams });
});

// ── GET /workflow/diagram/:name ────────────────────────────────────────────────

workflowDiagramRoutes.get('/workflow/diagram/:name', (c) => {
    const name = c.req.param('name');
    const known = WorkflowDiagramBuilder.list();
    if (!known.includes(name)) {
        return ProblemResponse.notFound(
            c.req.path,
            `Unknown workflow: ${name}. Valid values: ${known.join(', ')}`,
        );
    }
    const diagram = WorkflowDiagramBuilder.build(name);
    return c.json({ success: true, diagram });
});

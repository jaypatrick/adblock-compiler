/// <reference types="@cloudflare/workers-types" />

/**
 * Monitoring and health routes.
 *
 * Routes:
 *   GET /metrics/prometheus
 *   GET /metrics
 *   GET /health
 *   GET /health/latest
 *   GET /health/db-smoke
 *   GET /container/status
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { etag } from 'hono/etag';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { handlePrometheusMetrics } from '../handlers/prometheus-metrics.ts';
import { handleMetrics } from '../handlers/metrics.ts';

export const monitoringRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Metrics ───────────────────────────────────────────────────────────────────

monitoringRoutes.get('/metrics/prometheus', etag(), (c) => handlePrometheusMetrics(c.req.raw, c.env));
monitoringRoutes.get('/metrics', etag(), (c) => handleMetrics(c.env));

// ── Health (lazy) ─────────────────────────────────────────────────────────────

monitoringRoutes.get('/health', async (c) => {
    const { handleHealth } = await import('../handlers/health.ts');
    const res = await handleHealth(c.env);
    // Cache health checks for 30 seconds — stale-while-revalidate for availability
    return new Response(res.body, {
        status: res.status,
        headers: {
            ...Object.fromEntries(res.headers),
            'Cache-Control': 'public, max-age=30, stale-while-revalidate=10',
        },
    });
});

monitoringRoutes.get('/health/latest', async (c) => {
    const { handleHealthLatest } = await import('../handlers/health.ts');
    return handleHealthLatest(c.env);
});

monitoringRoutes.get('/health/db-smoke', async (c) => {
    const { handleDbSmoke } = await import('../handlers/health.ts');
    return handleDbSmoke(c.env);
});

monitoringRoutes.get('/container/status', etag(), async (c) => {
    const { handleContainerStatus } = await import('../handlers/container-status.ts');
    const res = await handleContainerStatus(c.env);
    // Cache container status briefly to reduce DO load from frequent polling
    return new Response(res.body, {
        status: res.status,
        headers: {
            ...Object.fromEntries(res.headers),
            'Cache-Control': 'public, max-age=15, stale-while-revalidate=5',
        },
    });
});

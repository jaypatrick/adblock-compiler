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

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { etag } from 'hono/etag';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { handlePrometheusMetrics } from '../handlers/prometheus-metrics.ts';
import { handleMetrics } from '../handlers/metrics.ts';

export const monitoringRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Metrics ───────────────────────────────────────────────────────────────────

const prometheusMetricsRoute = createRoute({
    method: 'get',
    path: '/metrics/prometheus',
    tags: ['Monitoring'],
    summary: 'Get Prometheus metrics',
    description: 'Returns metrics in Prometheus text format for scraping',
    responses: {
        200: {
            description: 'Prometheus metrics in text format',
            content: {
                'text/plain; version=0.0.4': {
                    schema: z.string(),
                },
            },
        },
    },
});

monitoringRoutes.use('/metrics/prometheus', etag());
monitoringRoutes.openapi(prometheusMetricsRoute, (c) => {
    // Handler returns Response, not TypedResponse
    // deno-lint-ignore no-explicit-any
    return handlePrometheusMetrics(c.req.raw, c.env) as any;
});

const metricsRoute = createRoute({
    method: 'get',
    path: '/metrics',
    tags: ['Monitoring'],
    summary: 'Get application metrics',
    description: 'Returns application metrics in JSON format',
    responses: {
        200: {
            description: 'Application metrics',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        metrics: z.object({
                            timestamp: z.string(),
                            uptime: z.number().optional(),
                            version: z.string().optional(),
                        }),
                    }),
                },
            },
        },
    },
});

monitoringRoutes.use('/metrics', etag());
monitoringRoutes.openapi(metricsRoute, (c) => {
    // Handler returns Response, not TypedResponse
    // deno-lint-ignore no-explicit-any
    return handleMetrics(c.env) as any;
});

// ── Health (lazy) ─────────────────────────────────────────────────────────────

const healthRoute = createRoute({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Health check endpoint',
    description: 'Returns the health status of the application and its dependencies',
    responses: {
        200: {
            description: 'Service is healthy',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        status: z.string(),
                        timestamp: z.string(),
                        checks: z.record(z.string(), z.any()).optional(),
                    }),
                },
            },
        },
        503: {
            description: 'Service is unhealthy',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        status: z.string(),
                        error: z.string().optional(),
                    }),
                },
            },
        },
    },
});

monitoringRoutes.openapi(healthRoute, async (c) => {
    const { handleHealth } = await import('../handlers/health.ts');
    const res = await handleHealth(c.env);
    // Cache health checks for 30 seconds — stale-while-revalidate for availability
    // deno-lint-ignore no-explicit-any
    return new Response(res.body, {
        status: res.status,
        headers: {
            ...Object.fromEntries(res.headers),
            'Cache-Control': 'public, max-age=30, stale-while-revalidate=10',
        },
    }) as any;
});

const healthLatestRoute = createRoute({
    method: 'get',
    path: '/health/latest',
    tags: ['Health'],
    summary: 'Get latest health check result',
    description: 'Returns the most recent cached health check result',
    responses: {
        200: {
            description: 'Latest health check result',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        status: z.string(),
                        timestamp: z.string(),
                    }),
                },
            },
        },
    },
});

monitoringRoutes.openapi(healthLatestRoute, async (c) => {
    const { handleHealthLatest } = await import('../handlers/health.ts');
    // deno-lint-ignore no-explicit-any
    return handleHealthLatest(c.env) as any;
});

const dbSmokeRoute = createRoute({
    method: 'get',
    path: '/health/db-smoke',
    tags: ['Health'],
    summary: 'Database smoke test',
    description: 'Performs a quick database connectivity test',
    responses: {
        200: {
            description: 'Database is accessible',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        database: z.string(),
                        latency: z.number().optional(),
                    }),
                },
            },
        },
        503: {
            description: 'Database is not accessible',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

monitoringRoutes.openapi(dbSmokeRoute, async (c) => {
    const { handleDbSmoke } = await import('../handlers/health.ts');
    // deno-lint-ignore no-explicit-any
    return handleDbSmoke(c.env) as any;
});

const containerStatusRoute = createRoute({
    method: 'get',
    path: '/container/status',
    tags: ['Monitoring'],
    summary: 'Container status',
    description: 'Returns the status of Durable Object containers',
    responses: {
        200: {
            description: 'Container status',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        containers: z.array(
                            z.object({
                                id: z.string(),
                                status: z.string(),
                                lastSeen: z.string().optional(),
                            }),
                        ),
                    }),
                },
            },
        },
    },
});

monitoringRoutes.use('/container/status', etag());
monitoringRoutes.openapi(containerStatusRoute, async (c) => {
    const { handleContainerStatus } = await import('../handlers/container-status.ts');
    const res = await handleContainerStatus(c.env);
    // Cache container status briefly to reduce DO load from frequent polling
    // deno-lint-ignore no-explicit-any
    return new Response(res.body, {
        status: res.status,
        headers: {
            ...Object.fromEntries(res.headers),
            'Cache-Control': 'public, max-age=15, stale-while-revalidate=5',
        },
    }) as any;
});

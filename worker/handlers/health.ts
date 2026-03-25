/**
 * Health check handlers for the Cloudflare Worker.
 * Provides structured service health probes.
 *
 * GET /api/health        — live probe of all services
 * GET /api/health/latest — cached last health check result
 */

import { VERSION } from '../../src/version.ts';
import { _internals } from '../lib/prisma.ts';
import type { Env } from '../types.ts';

/**
 * Perform lightweight per-service health checks and return structured status.
 *
 * Checks:
 *   - database   : D1 `SELECT 1` probe via env.DB
 *   - cache      : KV list probe via env.COMPILATION_CACHE
 *   - auth       : presence of BETTER_AUTH_SECRET (+ DB binding)
 *   - compiler   : Durable Object namespace binding presence
 *   - gateway    : always healthy (we are responding)
 *
 * Overall status is the worst of all individual statuses.
 * This endpoint is unauthenticated intentionally — it exposes no sensitive data.
 */
export async function handleHealth(env: Env): Promise<Response> {
    type ServiceStatus = 'healthy' | 'degraded' | 'down';
    type ServiceResult = { status: ServiceStatus; latency_ms?: number };

    const probe = async (fn: () => Promise<void>): Promise<ServiceResult> => {
        const t0 = Date.now();
        try {
            await fn();
            return { status: 'healthy', latency_ms: Date.now() - t0 };
        } catch {
            return { status: 'down', latency_ms: Date.now() - t0 };
        }
    };

    const [database, cache] = await Promise.all([
        env.HYPERDRIVE
            ? probe(async () => {
                const prisma = _internals.createPrismaClient(env.HYPERDRIVE!.connectionString);
                await (prisma as unknown as { $queryRaw: (query: TemplateStringsArray) => Promise<unknown> }).$queryRaw`SELECT 1`;
            })
            : Promise.resolve<ServiceResult>({ status: 'down' }),
        probe(async () => {
            await env.COMPILATION_CACHE.list({ limit: 1 });
        }),
    ]);

    const authProvider: 'better-auth' | 'none' = env.BETTER_AUTH_SECRET ? 'better-auth' : 'none';
    let authStatus: ServiceStatus;
    if (authProvider === 'none') {
        authStatus = 'degraded';
    } else if (authProvider === 'better-auth' && !env.HYPERDRIVE) {
        // Better Auth requires a Hyperdrive binding for Neon PostgreSQL access; without it, auth cannot function.
        authStatus = 'down';
    } else {
        authStatus = 'healthy';
    }
    const auth: ServiceResult & { provider: 'better-auth' | 'none' } = {
        status: authStatus,
        provider: authProvider,
    };
    const compiler: ServiceResult = { status: env.ADBLOCK_COMPILER ? 'healthy' : 'degraded' };
    const gateway: ServiceResult = { status: 'healthy' };

    const rank: Record<ServiceStatus, number> = { healthy: 0, degraded: 1, down: 2 };
    const worst = [database, cache, auth, compiler, gateway].reduce<ServiceStatus>(
        (acc, s) => rank[s.status] > rank[acc] ? s.status : acc,
        'healthy',
    );

    return Response.json({
        status: worst,
        version: env.COMPILER_VERSION || VERSION,
        timestamp: new Date().toISOString(),
        services: {
            gateway,
            database,
            compiler,
            auth,
            cache,
        },
    });
}

/**
 * Return the latest cached health check result stored by the health monitoring workflow.
 * GET /api/health/latest
 */
export async function handleHealthLatest(env: Env): Promise<Response> {
    try {
        const latest = await env.METRICS.get('health:latest', 'json');

        if (!latest) {
            return Response.json({
                success: true,
                message: 'No health check data available. Run a health check first.',
            });
        }

        return Response.json({
            success: true,
            ...(latest as Record<string, unknown>),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * Health check handlers for the Cloudflare Worker.
 * Provides structured service health probes.
 *
 * GET /api/health          — live probe of all services
 * GET /api/health/latest   — cached last health check result
 * GET /api/health/db-smoke — detailed database connectivity smoke test
 */

import { VERSION } from '../../src/version.ts';
import { _internals } from '../lib/prisma.ts';
import type { Env } from '../types.ts';

/** Redact any postgres:// or postgresql:// connection string from an error message. */
function redactConnectionString(msg: string): string {
    return msg.replace(/postgre(?:s|sql):\/\/[^\s"',}]*/gi, '[redacted]');
}

/** Extract a stable error code string from an unknown thrown value. */
function errorCode(err: unknown): string {
    if (err instanceof Error) {
        // Prisma errors expose a `code` property (e.g. "P2024"); fall back to the name.
        const code = (err as unknown as Record<string, unknown>)['code'];
        if (typeof code === 'string' && code) return code;
        return err.name;
    }
    return 'UNKNOWN';
}

/** Extract a safe, redacted error message from an unknown thrown value. */
function errorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    return redactConnectionString(raw);
}

/**
 * Perform lightweight per-service health checks and return structured status.
 *
 * Checks:
 *   - database   : Neon/Hyperdrive connectivity via Prisma $queryRaw
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
    type DatabaseResult = ServiceResult & {
        db_name?: string;
        hyperdrive_host?: string;
        error_code?: string;
        error_message?: string;
    };

    const probe = async (fn: () => Promise<void>): Promise<ServiceResult> => {
        const t0 = Date.now();
        try {
            await fn();
            return { status: 'healthy', latency_ms: Date.now() - t0 };
        } catch {
            return { status: 'down', latency_ms: Date.now() - t0 };
        }
    };

    // Extended database probe: verify connectivity AND confirm we're on the correct
    // production database. Returns db_name and hyperdrive_host for observability.
    // Includes a 5-second timeout to prevent a hung Hyperdrive connection from
    // blocking the entire health response.
    const databaseProbe = async (): Promise<DatabaseResult> => {
        if (!env.HYPERDRIVE) {
            return { status: 'down' };
        }
        const t0 = Date.now();
        let prisma: ReturnType<typeof _internals.createPrismaClient> | undefined;
        try {
            prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
            const timeoutMs = 5000;
            const queryPromise = prisma.$queryRaw<Array<{ db_name: string }>>`
                SELECT current_database() AS db_name
            `;
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    const e = new Error(`Database probe timed out after ${timeoutMs}ms`);
                    (e as unknown as Record<string, unknown>)['code'] = 'PROBE_TIMEOUT';
                    reject(e);
                }, timeoutMs);
            });
            const rows = await Promise.race([queryPromise, timeoutPromise]);
            clearTimeout(timeoutId);
            const dbName = rows[0]?.db_name ?? 'unknown';
            const latency_ms = Date.now() - t0;
            // Fail-fast guard: warn if connected to wrong database
            if (dbName !== 'adblock-compiler') {
                return {
                    status: 'degraded',
                    latency_ms,
                    db_name: dbName,
                    hyperdrive_host: env.HYPERDRIVE.host,
                };
            }
            return {
                status: 'healthy',
                latency_ms,
                db_name: dbName,
                hyperdrive_host: env.HYPERDRIVE.host,
            };
        } catch (err) {
            return {
                status: 'down',
                latency_ms: Date.now() - t0,
                hyperdrive_host: env.HYPERDRIVE?.host,
                error_code: errorCode(err),
                error_message: errorMessage(err),
            };
        } finally {
            await prisma?.$disconnect?.();
        }
    };

    const [database, cache] = await Promise.all([
        databaseProbe(),
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

/**
 * Detailed database connectivity smoke test.
 * GET /api/health/db-smoke
 *
 * Runs a richer Postgres query set to verify:
 *   1. The connection is live (current_database, pg_version, now)
 *   2. The public schema is populated (table_count from information_schema)
 *
 * Returns diagnostic-only data — no credentials, secrets, or PII.
 * This endpoint is intentionally unauthenticated (same as /api/health).
 *
 * Use this after every production deploy to confirm Hyperdrive → Neon connectivity.
 */
export async function handleDbSmoke(env: Env): Promise<Response> {
    if (!env.HYPERDRIVE) {
        return Response.json(
            { ok: false, error: 'HYPERDRIVE binding is not configured' },
            { status: 400 },
        );
    }

    const t0 = Date.now();
    let prisma: ReturnType<typeof _internals.createPrismaClient> | undefined;
    try {
        prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
        const [infoRows, countRows] = await Promise.all([
            prisma.$queryRaw<Array<{ db_name: string; pg_version: string; server_time: Date }>>`
                SELECT
                    current_database() AS db_name,
                    version() AS pg_version,
                    now() AS server_time
            `,
            prisma.$queryRaw<Array<{ table_count: bigint }>>`
                SELECT COUNT(*) AS table_count
                FROM information_schema.tables
                WHERE table_schema = 'public'
            `,
        ]);

        const row = infoRows[0];
        return Response.json({
            ok: true,
            db_name: row?.db_name ?? 'unknown',
            pg_version: row?.pg_version ?? 'unknown',
            server_time: row?.server_time instanceof Date ? row.server_time.toISOString() : String(row?.server_time),
            table_count: Number(countRows[0]?.table_count ?? 0),
            latency_ms: Date.now() - t0,
            hyperdrive_host: env.HYPERDRIVE.host,
        });
    } catch (err) {
        return Response.json(
            {
                ok: false,
                error: errorMessage(err),
                hyperdrive_host: env.HYPERDRIVE?.host,
            },
            { status: 503 },
        );
    } finally {
        await prisma?.$disconnect?.();
    }
}

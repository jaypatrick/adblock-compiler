/**
 * Admin handlers for the Cloudflare Worker.
 * Provides storage management and database administration endpoints.
 *
 * ZTA: All /admin/storage/* endpoints require JWT admin auth (tier + role check via
 * checkRoutePermission) plus optional Cloudflare Access JWT verification.
 * Auth is checked in routeAdminStorage before any handler executes.
 */

import { JsonResponse } from '../utils/index.ts';
import type { Env, IAuthContext, TableInfo } from '../types.ts';
import { AdminQueryRequestSchema } from '../schemas.ts';
import { verifyCfAccessJwt } from '../middleware/cf-access.ts';
import { _internals } from '../lib/prisma.ts';

// ============================================================================
// Storage Statistics
// ============================================================================

/**
 * Handle GET /admin/storage/stats request.
 */
export async function handleAdminStorageStats(env: Env): Promise<Response> {
    if (!env.HYPERDRIVE) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    try {
        const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
        const now = new Date();
        const [storageCount, filterCacheCount, compilationCount, expiredStorage, expiredCache] = await Promise.all([
            prisma.storageEntry.count(),
            prisma.filterCache.count(),
            prisma.compilationMetadata.count(),
            prisma.storageEntry.count({ where: { expiresAt: { lt: now } } }),
            prisma.filterCache.count({ where: { expiresAt: { lt: now } } }),
        ]);

        return JsonResponse.success({
            stats: {
                storage_entries: storageCount,
                filter_cache: filterCacheCount,
                compilation_metadata: compilationCount,
                expired_storage: expiredStorage,
                expired_cache: expiredCache,
            },
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Handle POST /admin/storage/clear-expired request.
 */
export async function handleAdminClearExpired(env: Env): Promise<Response> {
    if (!env.HYPERDRIVE) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    try {
        const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
        const now = new Date();
        const [storageResult, cacheResult] = await Promise.all([
            prisma.storageEntry.deleteMany({ where: { expiresAt: { lt: now } } }),
            prisma.filterCache.deleteMany({ where: { expiresAt: { lt: now } } }),
        ]);

        const deleted = storageResult.count + cacheResult.count;

        return JsonResponse.success({
            deleted,
            message: `Cleared ${deleted} expired entries`,
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

/**
 * Handle POST /admin/storage/clear-cache request.
 */
export async function handleAdminClearCache(env: Env): Promise<Response> {
    if (!env.HYPERDRIVE) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    try {
        const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
        const [storageResult, cacheResult] = await Promise.all([
            prisma.storageEntry.deleteMany({ where: { key: { startsWith: 'cache/' } } }),
            prisma.filterCache.deleteMany({}),
        ]);

        const deleted = storageResult.count + cacheResult.count;

        return JsonResponse.success({
            deleted,
            message: `Cleared ${deleted} cache entries`,
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

// ============================================================================
// Data Export/Import
// ============================================================================

/**
 * Handle GET /admin/storage/export request.
 */
export async function handleAdminExport(env: Env): Promise<Response> {
    if (!env.HYPERDRIVE) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    try {
        const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
        const [storageEntries, filterCache, compilationMetadata] = await Promise.all([
            prisma.storageEntry.findMany({ take: 1000 }),
            prisma.filterCache.findMany({ take: 100 }),
            prisma.compilationMetadata.findMany({ orderBy: { timestamp: 'desc' }, take: 100 }),
        ]);

        const exportData = {
            exportedAt: new Date().toISOString(),
            storage_entries: storageEntries,
            filter_cache: filterCache,
            compilation_metadata: compilationMetadata,
        };

        return JsonResponse.success(exportData, {
            headers: {
                'Content-Disposition': `attachment; filename="storage-export-${Date.now()}.json"`,
            },
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

// ============================================================================
// Database Maintenance
// ============================================================================

/**
 * Handle POST /admin/storage/vacuum request.
 */
export async function handleAdminVacuum(env: Env): Promise<Response> {
    if (!env.DB) {
        return JsonResponse.serviceUnavailable('D1 database not configured');
    }

    try {
        await env.DB.exec('VACUUM');

        return JsonResponse.success({
            message: 'Database vacuum completed',
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

/**
 * Handle GET /admin/storage/tables request.
 */
export async function handleAdminListTables(env: Env): Promise<Response> {
    if (!env.DB) {
        return JsonResponse.serviceUnavailable('D1 database not configured');
    }

    try {
        const result = await env.DB
            .prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name`)
            .all<TableInfo>();

        return JsonResponse.success({
            tables: result.results || [],
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

/**
 * Strips SQL comments (single-line -- and multi-line / * ... * /) from a query string.
 * Used for security validation to prevent bypassing pattern checks via comments.
 */
function stripSqlComments(sql: string): string {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ') // multi-line comments
        .replace(/--[^\n]*/g, ' '); // single-line comments
}

/**
 * Handle POST /admin/storage/query request.
 * Allows read-only SQL queries for debugging.
 */
export async function handleAdminQuery(request: Request, env: Env): Promise<Response> {
    if (!env.DB) {
        return JsonResponse.serviceUnavailable('D1 database not configured');
    }

    try {
        const rawBody = await request.json();
        const parsed = AdminQueryRequestSchema.safeParse(rawBody);
        if (!parsed.success) {
            return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body');
        }
        const { sql } = parsed.data;

        // Strip comments before validation to prevent bypass
        const sanitized = stripSqlComments(sql);

        // Validate that the query is read-only (SELECT only)
        const normalizedSql = sanitized.trim().toUpperCase();
        if (!normalizedSql.startsWith('SELECT')) {
            return JsonResponse.badRequest('Only SELECT queries are allowed');
        }

        // Additional safety checks - block dangerous patterns
        const dangerousPatterns = [
            /;\s*DELETE/i,
            /;\s*UPDATE/i,
            /;\s*INSERT/i,
            /;\s*DROP/i,
            /;\s*ALTER/i,
            /;\s*CREATE/i,
            /;\s*TRUNCATE/i,
            /;\s*ATTACH/i,
            /;\s*DETACH/i,
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(sanitized)) {
                return JsonResponse.badRequest('Query contains disallowed SQL statements');
            }
        }

        // Enforce row limit to prevent resource exhaustion.
        // Strip trailing semicolon, then clamp or append LIMIT to prevent large result sets.
        const MAX_ROWS = 1000;
        let workingSql = sanitized.trim();
        if (workingSql.endsWith(';')) {
            workingSql = workingSql.slice(0, -1).trimEnd();
        }

        const limitKeywordRegex = /\bLIMIT\b/i;
        const simpleLimitRegex = /\bLIMIT\b\s+(\d+)\s*$/i;

        if (!limitKeywordRegex.test(workingSql)) {
            workingSql = `${workingSql} LIMIT ${MAX_ROWS}`;
        } else {
            const simpleMatch = simpleLimitRegex.exec(workingSql);
            if (!simpleMatch) {
                return JsonResponse.badRequest('Queries must use simple "LIMIT N" syntax with N \u2264 1000');
            }
            const requestedLimit = Number.parseInt(simpleMatch[1], 10);
            if (!Number.isFinite(requestedLimit) || requestedLimit > MAX_ROWS) {
                workingSql = workingSql.replace(simpleLimitRegex, `LIMIT ${MAX_ROWS}`);
            }
        }

        const result = await env.DB.prepare(workingSql).all();

        return JsonResponse.success({
            rows: result.results || [],
            rowCount: result.results?.length || 0,
            meta: result.meta,
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}

// ============================================================================
// Admin Storage Route Handler (for lazy import from worker.ts)
// ============================================================================

/**
 * Route handler for all /admin/storage/* endpoints.
 *
 * ZTA: Permission check (admin tier + role) is enforced in router.ts before
 * this function is called, so unauthorized requests never reach this module.
 * Defense-in-depth: also validates Cloudflare Access JWT when configured.
 *
 * @param routePath   - Path with /api prefix stripped (e.g. "/admin/storage/stats")
 * @param request     - Incoming request
 * @param env         - Worker environment bindings
 * @param authContext - Resolved auth context from the unified auth middleware
 */
export async function routeAdminStorage(
    routePath: string,
    request: Request,
    env: Env,
    _authContext: IAuthContext,
): Promise<Response> {
    // ZTA: permission check is enforced in router.ts before this function is called.
    // Defense-in-depth: also require CF Access JWT when configured.
    const cfAccess = await verifyCfAccessJwt(request, env);
    if (!cfAccess.valid) {
        return Response.json(
            { success: false, error: cfAccess.error ?? 'CF Access verification failed' },
            { status: 403 },
        );
    }

    if (routePath === '/admin/storage/stats' && request.method === 'GET') {
        return handleAdminStorageStats(env);
    }
    if (routePath === '/admin/storage/clear-expired' && request.method === 'POST') {
        return handleAdminClearExpired(env);
    }
    if (routePath === '/admin/storage/clear-cache' && request.method === 'POST') {
        return handleAdminClearCache(env);
    }
    if (routePath === '/admin/storage/export' && request.method === 'GET') {
        return handleAdminExport(env);
    }
    if (routePath === '/admin/storage/vacuum' && request.method === 'POST') {
        return handleAdminVacuum(env);
    }
    if (routePath === '/admin/storage/tables' && request.method === 'GET') {
        return handleAdminListTables(env);
    }
    if (routePath === '/admin/storage/query' && request.method === 'POST') {
        return handleAdminQuery(request, env);
    }

    return Response.json({ success: false, error: 'Unknown admin endpoint' }, { status: 404 });
}

/**
 * Admin Neon Reporting Handlers
 *
 * Thin handler layer over {@link NeonApiService} for database administration
 * and monitoring. All endpoints require Admin tier + admin role.
 *
 *   GET    /admin/neon/project                        — project overview
 *   GET    /admin/neon/branches                       — list branches
 *   GET    /admin/neon/branches/:branchId             — single branch detail
 *   POST   /admin/neon/branches                       — create a branch
 *   DELETE /admin/neon/branches/:branchId             — delete a branch
 *   GET    /admin/neon/endpoints                      — list compute endpoints
 *   GET    /admin/neon/databases/:branchId            — list databases for branch
 *   POST   /admin/neon/query                          — execute SQL via serverless driver
 *
 * ZTA compliance:
 *   - checkRoutePermission() applied on every handler — Admin tier + role required
 *   - Request bodies validated via Zod schemas
 *   - NeonApiError mapped to structured JSON error responses
 *   - NEON_API_KEY is a worker secret; never echoed in responses
 *
 * @see src/services/neonApiService.ts — underlying Neon service
 * @see docs/admin/neon-endpoints.md   — endpoint documentation
 */

import type { AppContext } from '../routes/shared.ts';
import type { Env } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';
import { AdminNeonCreateBranchSchema, AdminNeonQuerySchema } from '../schemas.ts';
import { createNeonApiService, NeonApiError } from '../../src/services/neonApiService.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a NeonApiService from the env bindings.
 * Returns `null` when the required secret is not configured.
 */
function getNeonService(env: Env) {
    if (!env.NEON_API_KEY) return null;
    return createNeonApiService({ apiKey: env.NEON_API_KEY });
}

/**
 * Resolve the project ID from the query-string override or the env default.
 * Returns `null` when neither is available.
 */
function resolveProjectId(c: AppContext): string | null {
    const url = new URL(c.req.url);
    return url.searchParams.get('projectId') ?? c.env.NEON_PROJECT_ID ?? null;
}

/**
 * Map a {@link NeonApiError} to a structured JSON error response.
 * Falls back to 500 for unknown errors.
 */
function handleNeonError(err: unknown): Response {
    if (err instanceof NeonApiError) {
        return JsonResponse.error(err.message, err.status);
    }
    return JsonResponse.serverError(err);
}

// ============================================================================
// GET /admin/neon/project
// ============================================================================

export async function handleAdminNeonGetProject(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/project', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    const projectId = resolveProjectId(c);
    if (!projectId) return JsonResponse.badRequest('projectId is required (query param or NEON_PROJECT_ID env)');

    try {
        const project = await neon.getProject(projectId);
        return JsonResponse.success({ project });
    } catch (err) {
        return handleNeonError(err);
    }
}

// ============================================================================
// GET /admin/neon/branches
// ============================================================================

export async function handleAdminNeonListBranches(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/branches', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    const projectId = resolveProjectId(c);
    if (!projectId) return JsonResponse.badRequest('projectId is required (query param or NEON_PROJECT_ID env)');

    try {
        const branches = await neon.listBranches(projectId);
        return JsonResponse.success({ branches });
    } catch (err) {
        return handleNeonError(err);
    }
}

// ============================================================================
// GET /admin/neon/branches/:branchId
// ============================================================================

export async function handleAdminNeonGetBranch(
    c: AppContext,
    branchId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/branches/*', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    const projectId = resolveProjectId(c);
    if (!projectId) return JsonResponse.badRequest('projectId is required (query param or NEON_PROJECT_ID env)');

    try {
        const branch = await neon.getBranch(projectId, branchId);
        return JsonResponse.success({ branch });
    } catch (err) {
        return handleNeonError(err);
    }
}

// ============================================================================
// POST /admin/neon/branches
// ============================================================================

export async function handleAdminNeonCreateBranch(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/branches', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    const projectId = resolveProjectId(c);
    if (!projectId) return JsonResponse.badRequest('projectId is required (query param or NEON_PROJECT_ID env)');

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = AdminNeonCreateBranchSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }

    try {
        const result = await neon.createBranch(projectId, parsed.data);
        return JsonResponse.success(result, { status: 201 });
    } catch (err) {
        return handleNeonError(err);
    }
}

// ============================================================================
// DELETE /admin/neon/branches/:branchId
// ============================================================================

export async function handleAdminNeonDeleteBranch(
    c: AppContext,
    branchId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/branches/*', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    const projectId = resolveProjectId(c);
    if (!projectId) return JsonResponse.badRequest('projectId is required (query param or NEON_PROJECT_ID env)');

    try {
        const result = await neon.deleteBranch(projectId, branchId);
        return JsonResponse.success(result);
    } catch (err) {
        return handleNeonError(err);
    }
}

// ============================================================================
// GET /admin/neon/endpoints
// ============================================================================

export async function handleAdminNeonListEndpoints(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/endpoints', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    const projectId = resolveProjectId(c);
    if (!projectId) return JsonResponse.badRequest('projectId is required (query param or NEON_PROJECT_ID env)');

    try {
        const endpoints = await neon.listEndpoints(projectId);
        return JsonResponse.success({ endpoints });
    } catch (err) {
        return handleNeonError(err);
    }
}

// ============================================================================
// GET /admin/neon/databases/:branchId
// ============================================================================

export async function handleAdminNeonListDatabases(
    c: AppContext,
    branchId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/databases/*', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    const projectId = resolveProjectId(c);
    if (!projectId) return JsonResponse.badRequest('projectId is required (query param or NEON_PROJECT_ID env)');

    try {
        const databases = await neon.listDatabases(projectId, branchId);
        return JsonResponse.success({ databases });
    } catch (err) {
        return handleNeonError(err);
    }
}

// ============================================================================
// POST /admin/neon/query
// ============================================================================

export async function handleAdminNeonQuery(c: AppContext): Promise<Response> {
    const denied = checkRoutePermission('/admin/neon/query', c.get('authContext'));
    if (denied) return denied;

    const neon = getNeonService(c.env);
    if (!neon) return JsonResponse.serviceUnavailable('NEON_API_KEY is not configured');

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = AdminNeonQuerySchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }

    try {
        const rows = await neon.querySQL(parsed.data.connectionString, parsed.data.sql, parsed.data.params);
        return JsonResponse.success({ rows, rowCount: rows.length });
    } catch (err) {
        return handleNeonError(err);
    }
}

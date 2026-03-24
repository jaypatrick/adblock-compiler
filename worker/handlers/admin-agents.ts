/**
 * Admin Agent Data Handlers
 *
 * Admin-only endpoints for querying and managing agent sessions and audit logs
 * stored in Neon PostgreSQL via Prisma.
 *
 *   GET    /admin/agents/sessions           — paginated list of AgentSession records
 *   GET    /admin/agents/sessions/:id       — single session with its invocations
 *   GET    /admin/agents/audit              — paginated AgentAuditLog records
 *   DELETE /admin/agents/sessions/:id       — terminate/end an active session
 *
 * ZTA compliance:
 *   - checkRoutePermission() applied on every handler (Admin tier + role)
 *   - All queries use Prisma ORM (parameterised) — no raw SQL
 *   - Audit log entry emitted on every admin-terminated session
 *
 * @see worker/utils/route-permissions.ts — /admin/agents/* entries
 * @see worker/lib/prisma.ts              — PrismaClient factory
 * @see prisma/schema.prisma              — AgentSession, AgentInvocation, AgentAuditLog models
 */

import { type Env, type IAuthContext } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';
import { AdminPaginationQuerySchema } from '../schemas.ts';
import { checkRoutePermission } from '../utils/route-permissions.ts';
import { createPrismaClient } from '../lib/prisma.ts';

// ============================================================================
// GET /admin/agents/sessions
// ============================================================================

/**
 * List all AgentSession records (most recent first), paginated.
 * Query params: `?limit=<n>&offset=<n>`
 */
export async function handleAdminListAgentSessions(
    request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/agents/sessions', authContext);
    if (denied) return denied;

    if (!env.HYPERDRIVE?.connectionString) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    const url = new URL(request.url);
    const paginationParsed = AdminPaginationQuerySchema.safeParse({
        limit: url.searchParams.get('limit') ?? undefined,
        offset: url.searchParams.get('offset') ?? undefined,
    });
    if (!paginationParsed.success) {
        return JsonResponse.badRequest(paginationParsed.error.issues[0]?.message ?? 'Invalid pagination params');
    }
    const { limit, offset: skip } = paginationParsed.data;

    try {
        const prisma = createPrismaClient(env.HYPERDRIVE.connectionString);
        const [items, total] = await Promise.all([
            prisma.agentSession.findMany({
                orderBy: { startedAt: 'desc' },
                take: limit,
                skip,
            }),
            prisma.agentSession.count(),
        ]);

        return JsonResponse.success({ items, total, limit, offset: skip });
    } catch (err) {
        console.error('[admin-agents] listSessions error:', err instanceof Error ? err.message : err);
        return JsonResponse.serverError('Failed to list agent sessions');
    }
}

// ============================================================================
// GET /admin/agents/sessions/:sessionId
// ============================================================================

/**
 * Get a single AgentSession by ID, including its nested AgentInvocation records.
 */
export async function handleAdminGetAgentSession(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    sessionId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/agents/sessions/*', authContext);
    if (denied) return denied;

    if (!env.HYPERDRIVE?.connectionString) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    try {
        const prisma = createPrismaClient(env.HYPERDRIVE.connectionString);
        const session = await prisma.agentSession.findUnique({
            where: { id: sessionId },
            include: { invocations: { orderBy: { invokedAt: 'asc' } } },
        });

        if (!session) {
            return JsonResponse.notFound('Agent session not found');
        }

        return JsonResponse.success(session);
    } catch (err) {
        console.error('[admin-agents] getSession error:', err instanceof Error ? err.message : err);
        return JsonResponse.serverError('Failed to get agent session');
    }
}

// ============================================================================
// GET /admin/agents/audit
// ============================================================================

/**
 * List all AgentAuditLog entries (most recent first), paginated.
 * Query params: `?limit=<n>&offset=<n>`
 */
export async function handleAdminListAgentAuditLog(
    request: Request,
    env: Env,
    authContext: IAuthContext,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/agents/audit', authContext);
    if (denied) return denied;

    if (!env.HYPERDRIVE?.connectionString) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    const url = new URL(request.url);
    const paginationParsed = AdminPaginationQuerySchema.safeParse({
        limit: url.searchParams.get('limit') ?? undefined,
        offset: url.searchParams.get('offset') ?? undefined,
    });
    if (!paginationParsed.success) {
        return JsonResponse.badRequest(paginationParsed.error.issues[0]?.message ?? 'Invalid pagination params');
    }
    const { limit, offset: skip } = paginationParsed.data;

    try {
        const prisma = createPrismaClient(env.HYPERDRIVE.connectionString);
        const [items, total] = await Promise.all([
            prisma.agentAuditLog.findMany({
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip,
            }),
            prisma.agentAuditLog.count(),
        ]);

        return JsonResponse.success({ items, total, limit, offset: skip });
    } catch (err) {
        console.error('[admin-agents] listAuditLog error:', err instanceof Error ? err.message : err);
        return JsonResponse.serverError('Failed to list agent audit log');
    }
}

// ============================================================================
// DELETE /admin/agents/sessions/:sessionId
// ============================================================================

/**
 * Terminate an active agent session.
 * Sets `endedAt` to now, computes `durationMs`, sets `closedReason` to
 * `'admin-terminated'`, and writes an `AgentAuditLog` entry.
 */
export async function handleAdminTerminateAgentSession(
    _request: Request,
    env: Env,
    authContext: IAuthContext,
    sessionId: string,
): Promise<Response> {
    const denied = checkRoutePermission('/admin/agents/sessions/*', authContext);
    if (denied) return denied;

    if (!env.HYPERDRIVE?.connectionString) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    try {
        const prisma = createPrismaClient(env.HYPERDRIVE.connectionString);

        // Fetch first to check existence and compute duration
        const session = await prisma.agentSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            return JsonResponse.notFound('Agent session not found');
        }

        const now = new Date();
        const durationMs = now.getTime() - new Date(session.startedAt).getTime();

        const updated = await prisma.agentSession.update({
            where: { id: sessionId },
            data: {
                endedAt: now,
                durationMs,
                closedReason: 'admin-terminated',
            },
        });

        await prisma.agentAuditLog.create({
            data: {
                actorUserId: authContext.userId,
                agentSlug: session.agentSlug,
                instanceId: session.instanceId,
                action: 'admin.terminated',
                status: 'success',
                reason: `Session terminated by admin ${authContext.userId}`,
                metadata: { sessionId },
            },
        });

        return JsonResponse.success(updated);
    } catch (err) {
        console.error('[admin-agents] terminateSession error:', err instanceof Error ? err.message : err);
        return JsonResponse.serverError('Failed to terminate agent session');
    }
}

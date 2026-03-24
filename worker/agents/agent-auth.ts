/**
 * Agent Authentication Middleware
 *
 * Enforces Zero Trust authentication for all `/agents/*` WebSocket upgrade
 * requests. Writes session and audit records to Neon PostgreSQL via Prisma
 * using `ctx.waitUntil()` so DB writes never block the upgrade response.
 *
 * ## Auth model
 * - Admin tier + admin role required (current policy — will be relaxed per
 *   agent scope in a follow-up to support paid tiers).
 * - Anonymous and non-admin requests are rejected with 401/403 before any
 *   Durable Object is touched.
 *
 * ## DB writes
 * - **Successful upgrade** → `AgentSession` record created (fire-and-forget).
 * - **Successful auth**    → `AgentAuditLog` with `action: 'session.started'`.
 * - **Auth denial**        → `AgentAuditLog` with `status: 'denied'`.
 *
 * @see worker/utils/route-permissions.ts — `/agents/*` entries
 * @see worker/lib/prisma.ts — PrismaClient factory
 */

import type { Env } from '../types.ts';
import type { IAuthContext } from '../types.ts';
import { UserTier, isTierSufficient } from '../types.ts';
import { createPrismaClient } from '../lib/prisma.ts';
import { agentNameToBindingKey } from '../agent-routing.ts';

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const AGENT_PATH_RE = /^\/agents\/([^/]+)\/([^/]+)(\/.*)?$/;

/**
 * Extracts the agent slug and instance ID from an `/agents/<slug>/<instanceId>`
 * URL path. Returns `null` when the path does not match.
 */
export function parseAgentPath(
    pathname: string,
): { agentSlug: string; instanceId: string } | null {
    const m = pathname.match(AGENT_PATH_RE);
    if (!m) return null;
    return { agentSlug: m[1]!, instanceId: m[2]! };
}

// ---------------------------------------------------------------------------
// Audit log helpers (fire-and-forget via ctx.waitUntil)
// ---------------------------------------------------------------------------

/**
 * Writes both the `AgentAuditLog` and (optionally) the `AgentSession` row
 * to Neon using a single PrismaClient. Errors are swallowed so a DB write
 * failure never propagates to the request path.
 */
async function writeSessionAndAuditLog(
    env: Env,
    audit: {
        actorUserId?: string | null;
        agentSlug?: string | null;
        instanceId?: string | null;
        action: string;
        status: 'success' | 'denied' | 'error';
        ipAddress?: string | null;
        userAgent?: string | null;
        reason?: string | null;
        metadata?: Record<string, unknown> | null;
    },
    session?: {
        userId: string;
        agentSlug: string;
        agentBindingKey: string;
        instanceId: string;
        transport: string;
        clientIp?: string | null;
        userAgent?: string | null;
        workerRegion?: string | null;
    } | null,
): Promise<void> {
    if (!env.HYPERDRIVE?.connectionString) return;
    try {
        const prisma = createPrismaClient(env.HYPERDRIVE.connectionString);
        const writes: Promise<unknown>[] = [
            prisma.agentAuditLog.create({
                data: {
                    actorUserId: audit.actorUserId ?? null,
                    agentSlug: audit.agentSlug ?? null,
                    instanceId: audit.instanceId ?? null,
                    action: audit.action,
                    status: audit.status,
                    ipAddress: audit.ipAddress ?? null,
                    userAgent: audit.userAgent ?? null,
                    reason: audit.reason ?? null,
                    metadata: audit.metadata ?? undefined,
                },
            }),
        ];
        if (session) {
            writes.push(
                prisma.agentSession.create({
                    data: {
                        userId: session.userId,
                        agentSlug: session.agentSlug,
                        agentBindingKey: session.agentBindingKey,
                        instanceId: session.instanceId,
                        transport: session.transport,
                        clientIp: session.clientIp ?? null,
                        userAgent: session.userAgent ?? null,
                        workerRegion: session.workerRegion ?? null,
                    },
                }),
            );
        }
        await Promise.all(writes);
    } catch (err) {
        console.error('[agent-auth] writeSessionAndAuditLog failed:', err instanceof Error ? err.message : err);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Result of the agent auth check. */
export interface AgentAuthResult {
    /** Whether the request is authorised to proceed to the agent. */
    readonly allowed: boolean;
    /** Ready-to-return error response when `allowed` is false. */
    readonly response?: Response;
}

/**
 * Verifies that the authenticated context meets the admin requirement for
 * agent access. On denial, a `AgentAuditLog` entry is written (fire-and-forget
 * via `ctx.waitUntil`) and a 401/403 `Response` is returned.
 *
 * On successful upgrade, both an `AgentAuditLog` and an `AgentSession` record
 * are written fire-and-forget via a single `ctx.waitUntil` call (one Prisma
 * client, two parallel inserts) to minimise connection churn.
 *
 * @param request     - Incoming fetch request (used for IP / User-Agent extraction)
 * @param env         - Worker environment bindings
 * @param ctx         - Execution context for `waitUntil` (fire-and-forget DB writes)
 * @param authContext - Resolved auth context from the unified auth middleware
 * @returns           - `{ allowed: true }` or `{ allowed: false, response }`
 */
export function verifyAgentAuth(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    authContext: IAuthContext,
): AgentAuthResult {
    const url = new URL(request.url);
    const parsed = parseAgentPath(url.pathname);
    const agentSlug = parsed?.agentSlug ?? null;
    const instanceId = parsed?.instanceId ?? null;
    const clientIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? null;
    const userAgent = request.headers.get('user-agent') ?? null;

    // ── Tier check: admin-only ──────────────────────────────────────────────
    if (!isTierSufficient(authContext.tier, UserTier.Admin)) {
        const isAnon = authContext.tier === UserTier.Anonymous;
        const reason = isAnon ? 'unauthenticated' : 'insufficient-tier';

        ctx.waitUntil(
            writeSessionAndAuditLog(env, {
                actorUserId: authContext.userId,
                agentSlug,
                instanceId,
                action: 'auth.denied',
                status: 'denied',
                ipAddress: clientIp,
                userAgent,
                reason,
            }),
        );

        const body = JSON.stringify({
            success: false,
            error: isAnon ? 'Authentication required' : 'Admin access required for agents',
        });
        return {
            allowed: false,
            response: new Response(body, {
                status: isAnon ? 401 : 403,
                headers: { 'Content-Type': 'application/json' },
            }),
        };
    }

    // ── Role check: admin role required ────────────────────────────────────
    if (authContext.role !== 'admin') {
        ctx.waitUntil(
            writeSessionAndAuditLog(env, {
                actorUserId: authContext.userId,
                agentSlug,
                instanceId,
                action: 'auth.denied',
                status: 'denied',
                ipAddress: clientIp,
                userAgent,
                reason: 'insufficient-role',
            }),
        );

        return {
            allowed: false,
            response: new Response(
                JSON.stringify({ success: false, error: 'Admin role required for agents' }),
                { status: 403, headers: { 'Content-Type': 'application/json' } },
            ),
        };
    }

    // ── userId must be present for an admin — guard against malformed context ─
    if (!authContext.userId) {
        ctx.waitUntil(
            writeSessionAndAuditLog(env, {
                actorUserId: null,
                agentSlug,
                instanceId,
                action: 'auth.denied',
                status: 'error',
                ipAddress: clientIp,
                userAgent,
                reason: 'missing-user-id',
            }),
        );
        return {
            allowed: false,
            response: new Response(
                JSON.stringify({ success: false, error: 'Authentication required' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } },
            ),
        };
    }

    // ── Auth success: write audit log + session record in a single waitUntil ─
    const userId = authContext.userId;
    const agentBindingKey = agentSlug ? agentNameToBindingKey(agentSlug) : '';
    const isWebSocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    const transport = isWebSocket ? 'websocket' : 'sse';

    ctx.waitUntil(
        writeSessionAndAuditLog(
            env,
            {
                actorUserId: userId,
                agentSlug,
                instanceId,
                action: 'session.started',
                status: 'success',
                ipAddress: clientIp,
                userAgent,
            },
            agentSlug && instanceId
                ? {
                    userId,
                    agentSlug,
                    agentBindingKey,
                    instanceId,
                    transport,
                    clientIp,
                    userAgent,
                    workerRegion: (request as Request & { cf?: { colo?: string } }).cf?.colo ?? null,
                }
                : null,
        ),
    );

    return { allowed: true };
}

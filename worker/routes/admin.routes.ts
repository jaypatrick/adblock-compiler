/// <reference types="@cloudflare/workers-types" />

/**
 * Admin routes.
 *
 * Routes:
 *   GET    /admin/auth/config
 *   GET    /admin/users
 *   GET    /admin/users/:id
 *   PATCH  /admin/users/:id
 *   DELETE /admin/users/:id
 *   POST   /admin/users/:id/ban
 *   POST   /admin/users/:id/unban
 *   DELETE /admin/users/:id/sessions
 *   GET    /admin/usage/:userId
 *   ALL    /admin/storage/*
 *   GET    /admin/neon/project
 *   GET    /admin/neon/branches
 *   GET    /admin/neon/branches/:branchId
 *   POST   /admin/neon/branches
 *   DELETE /admin/neon/branches/:branchId
 *   GET    /admin/neon/endpoints
 *   GET    /admin/neon/databases/:branchId
 *   POST   /admin/neon/query
 *   GET    /admin/agents/sessions
 *   GET    /admin/agents/sessions/:sessionId
 *   GET    /admin/agents/audit
 *   DELETE /admin/agents/sessions/:sessionId
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { type AppContext, zodValidationError } from './shared.ts';

import { rateLimitMiddleware } from '../middleware/hono-middleware.ts';
import { verifyCfAccessJwt } from '../middleware/cf-access.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { createPgPool } from '../utils/pg-pool.ts';

import { handleAdminBanUser, handleAdminDeleteUser, handleAdminGetUser, handleAdminListUsers, handleAdminUnbanUser, handleAdminUpdateUser } from '../handlers/admin-users.ts';
import { handleAdminAuthConfig } from '../handlers/auth-config.ts';
import { handleAdminGetUserUsage } from '../handlers/admin-usage.ts';
import {
    handleAdminNeonCreateBranch,
    handleAdminNeonDeleteBranch,
    handleAdminNeonGetBranch,
    handleAdminNeonGetProject,
    handleAdminNeonListBranches,
    handleAdminNeonListDatabases,
    handleAdminNeonListEndpoints,
    handleAdminNeonQuery,
} from '../handlers/admin-neon.ts';
import { handleAdminGetAgentSession, handleAdminListAgentAuditLog, handleAdminListAgentSessions, handleAdminTerminateAgentSession } from '../handlers/admin-agents.ts';

import { AdminBanUserSchema, AdminNeonCreateBranchSchema, AdminNeonQuerySchema, AdminUnbanUserSchema, AdminUpdateUserSchema } from '../schemas.ts';

export const adminRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Admin session revocation handler ─────────────────────────────────────────

/**
 * Admin session revocation handler — revoke all sessions for a specific user.
 *
 * ZTA compliance:
 *  - Requires admin role
 *  - Verifies Cloudflare Access JWT (defense-in-depth)
 *  - Emits `cf_access_denial` security event on CF Access failure
 */
export async function handleAdminRevokeUserSessions(c: AppContext): Promise<Response> {
    const authContext = c.get('authContext');
    if (authContext.role !== 'admin') {
        return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    // Defense-in-depth: verify CF Access JWT when configured
    const cfAccess = await verifyCfAccessJwt(c.req.raw, c.env);
    if (!cfAccess.valid) {
        if (c.env.ANALYTICS_ENGINE) {
            new AnalyticsService(c.env.ANALYTICS_ENGINE).trackSecurityEvent({
                eventType: 'cf_access_denial',
                path: c.req.path,
                method: c.req.method,
                reason: cfAccess.error ?? 'CF Access verification failed',
            });
        }
        return c.json({ success: false, error: cfAccess.error ?? 'CF Access verification failed' }, 403);
    }

    const userId = c.req.param('id')!;
    try {
        if (!c.env.HYPERDRIVE) {
            return c.json({ success: false, error: 'Database not configured' }, 503);
        }
        const pool = createPgPool(c.env.HYPERDRIVE.connectionString);
        const result = await pool.query(
            'DELETE FROM sessions WHERE user_id = $1',
            [userId],
        );
        return c.json({
            success: true,
            message: `Revoked ${result.rowCount ?? 0} session(s) for user ${userId}`,
        });
    } catch (error) {
        // deno-lint-ignore no-console
        console.error('[admin] Session revocation error:', error instanceof Error ? error.message : 'unknown');
        return c.json({ success: false, error: 'Failed to revoke sessions' }, 500);
    }
}

// ── Admin routes ──────────────────────────────────────────────────────────────

adminRoutes.get('/admin/auth/config', (c) => handleAdminAuthConfig(c.req.raw, c.env, c.get('authContext')));

adminRoutes.get('/admin/users', (c) => handleAdminListUsers(c.req.raw, c.env, c.get('authContext')));
adminRoutes.get('/admin/users/:id', (c) => handleAdminGetUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!));
adminRoutes.patch(
    '/admin/users/:id',
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminUpdateUserSchema as any, zodValidationError),
    (c) => handleAdminUpdateUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);
adminRoutes.delete(
    '/admin/users/:id',
    rateLimitMiddleware(),
    (c) => handleAdminDeleteUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);
adminRoutes.post(
    '/admin/users/:id/ban',
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminBanUserSchema as any, zodValidationError),
    (c) => handleAdminBanUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);
adminRoutes.post(
    '/admin/users/:id/unban',
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminUnbanUserSchema as any, zodValidationError),
    (c) => handleAdminUnbanUser(c.req.raw, c.env, c.get('authContext'), c.req.param('id')!),
);

// Admin session revocation — revoke all sessions for a specific user
// Extracted to a named handler for testability and ZTA compliance.
adminRoutes.delete(
    '/admin/users/:id/sessions',
    rateLimitMiddleware(),
    async (c) => handleAdminRevokeUserSessions(c),
);

adminRoutes.get('/admin/usage/:userId', (c) => handleAdminGetUserUsage(c.req.raw, c.env, c.get('authContext'), c.req.param('userId')!));

adminRoutes.all('/admin/storage/*', async (c) => {
    // Permission check already ran in the routes middleware above; this handler
    // only runs when access is granted (admin tier + admin role).
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext'));
});

// ── Admin Neon reporting ─────────────────────────────────────────────────────

adminRoutes.get('/admin/neon/project', (c) => handleAdminNeonGetProject(c.req.raw, c.env, c.get('authContext')));
adminRoutes.get('/admin/neon/branches', (c) => handleAdminNeonListBranches(c.req.raw, c.env, c.get('authContext')));
adminRoutes.get('/admin/neon/branches/:branchId', (c) => handleAdminNeonGetBranch(c.req.raw, c.env, c.get('authContext'), c.req.param('branchId')!));
adminRoutes.post(
    '/admin/neon/branches',
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminNeonCreateBranchSchema as any, zodValidationError),
    (c) => handleAdminNeonCreateBranch(c.req.raw, c.env, c.get('authContext')),
);
adminRoutes.delete('/admin/neon/branches/:branchId', (c) => handleAdminNeonDeleteBranch(c.req.raw, c.env, c.get('authContext'), c.req.param('branchId')!));
adminRoutes.get('/admin/neon/endpoints', (c) => handleAdminNeonListEndpoints(c.req.raw, c.env, c.get('authContext')));
adminRoutes.get('/admin/neon/databases/:branchId', (c) => handleAdminNeonListDatabases(c.req.raw, c.env, c.get('authContext'), c.req.param('branchId')!));
adminRoutes.post(
    '/admin/neon/query',
    // deno-lint-ignore no-explicit-any
    zValidator('json', AdminNeonQuerySchema as any, zodValidationError),
    (c) => handleAdminNeonQuery(c.req.raw, c.env, c.get('authContext')),
);

// ── Admin agent data ──────────────────────────────────────────────────────────

adminRoutes.get('/admin/agents/sessions', (c) => handleAdminListAgentSessions(c.req.raw, c.env, c.get('authContext')));
adminRoutes.get('/admin/agents/sessions/:sessionId', (c) => handleAdminGetAgentSession(c.req.raw, c.env, c.get('authContext'), c.req.param('sessionId')!));
adminRoutes.get('/admin/agents/audit', (c) => handleAdminListAgentAuditLog(c.req.raw, c.env, c.get('authContext')));
adminRoutes.delete(
    '/admin/agents/sessions/:sessionId',
    rateLimitMiddleware(),
    (c) => handleAdminTerminateAgentSession(c.req.raw, c.env, c.get('authContext'), c.req.param('sessionId')!),
);

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
 *   GET    /admin/storage/stats
 *   POST   /admin/storage/clear-expired
 *   POST   /admin/storage/clear-cache
 *   GET    /admin/storage/export
 *   POST   /admin/storage/vacuum
 *   GET    /admin/storage/tables
 *   POST   /admin/storage/query
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
 *   GET    /admin/security/overview
 *   GET    /admin/email/config
 *   POST   /admin/email/test
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

import { rateLimitMiddleware } from '../middleware/hono-middleware.ts';
import { UserTier } from '../types.ts';

export const adminRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Inline schema definitions (from schemas.ts) ──────────────────────────────

const adminPaginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50).describe('Maximum number of results per page'),
    offset: z.coerce.number().int().min(0).default(0).describe('Number of results to skip'),
});

const adminUsageDaysQuerySchema = z.object({
    days: z.coerce.number().int().default(30).describe('Number of days to look back for usage stats'),
});
/**
 * OpenAPI route-level schema for PATCH /admin/users/:id.
 *
 * This schema uses the OpenAPI-extended `z` from `@hono/zod-openapi` so it can
 * be passed to `createRoute()`. It mirrors the authoritative `AdminUpdateUserSchema`
 * in `worker/schemas.ts` — if you change validation constraints, update both.
 * The handler (`worker/handlers/admin-users.ts`) re-validates the body using
 * `AdminUpdateUserSchema` directly, so the handler is the real enforcement layer.
 *
 * NOTE: `AdminUpdateUserSchema` from `worker/schemas.ts` cannot be used here directly
 * because it is built with plain `zod` and lacks the `.openapi()` extension method
 * required by `@hono/zod-openapi`'s `createRoute()`. The two schemas must stay in sync
 * manually until the project standardises on a single zod distribution.
 */
const adminUpdateUserRouteSchema = z.object({
    tier: z.nativeEnum(UserTier).optional().describe('Updated user tier'),
    role: z.string().min(1).max(64).optional().describe('Updated user role'),
}).refine(
    (d) => d.tier !== undefined || d.role !== undefined,
    { message: 'At least one of tier or role is required' },
);

const adminBanUserSchema = z.object({
    reason: z.string().max(500).optional().describe('Reason for banning'),
    expires: z.string().datetime().optional().describe('ISO 8601 expiration timestamp'),
});

const adminUnbanUserSchema = z.object({});

const adminNeonCreateBranchSchema = z.object({
    name: z.string().max(128).optional().describe('Optional branch name (auto-generated if omitted)'),
    parent_id: z.string().max(128).optional().describe('Parent branch ID to fork from (defaults to primary branch)'),
});

const adminNeonQuerySchema = z.object({
    connectionString: z.string().min(1).describe('Full postgres:// connection string'),
    sql: z.string().min(1).describe('SQL statement to execute'),
    params: z.array(z.unknown()).optional().describe('Optional positional parameters ($1, $2, ...)'),
});

const adminQueryRequestSchema = z.object({
    sql: z.string().min(1).describe('SQL query to execute (SELECT only)'),
});

const betterAuthUserPublicSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    tier: z.nativeEnum(UserTier).optional(),
    role: z.string().optional(),
    banned: z.boolean().optional(),
    banReason: z.string().nullable().optional(),
    banExpires: z.date().nullable().optional(),
});

// ── Inline OpenAPI-compatible schemas for admin operations ──────────────────

// Auth config response
const authConfigResponseSchema = z.object({
    success: z.boolean(),
    provider: z.literal('better-auth'),
    socialProviders: z.object({
        github: z.object({ configured: z.boolean() }),
        google: z.object({ configured: z.boolean() }),
    }),
    mfa: z.object({
        enabled: z.boolean(),
    }),
    session: z.object({
        expiresIn: z.number(),
        updateAge: z.number(),
        cookieCacheMaxAge: z.number(),
    }),
    betterAuth: z.object({
        secretConfigured: z.boolean(),
        baseUrl: z.string().nullable(),
    }),
    tiers: z.array(z.object({
        tier: z.string(),
        displayName: z.string(),
        order: z.number(),
        rateLimit: z.number().nullable(),
        description: z.string(),
    })),
    routes: z.array(z.object({
        pattern: z.string(),
        minTier: z.string(),
        requiredRole: z.string().nullable(),
        description: z.string(),
    })),
});

// Storage stats response
const storageStatsResponseSchema = z.object({
    success: z.boolean(),
    stats: z.object({
        storage_entries: z.number().int().nonnegative(),
        filter_cache: z.number().int().nonnegative(),
        compilation_metadata: z.number().int().nonnegative(),
        expired_storage: z.number().int().nonnegative(),
        expired_cache: z.number().int().nonnegative(),
    }),
    timestamp: z.string().datetime().describe('ISO 8601 timestamp of stats snapshot'),
});

// Storage tables response
const tableInfoSchema = z.object({
    name: z.string(),
    type: z.string(),
});

// Storage query response
const storageQueryResponseSchema = z.object({
    success: z.boolean(),
    rows: z.array(z.record(z.string(), z.unknown())),
    rowCount: z.number().int().nonnegative(),
    meta: z.unknown().optional(),
});

// Export response
const exportDataResponseSchema = z.object({
    success: z.boolean(),
    exportedAt: z.string().datetime(),
    storage_entries: z.array(z.unknown()),
    filter_cache: z.array(z.unknown()),
    compilation_metadata: z.array(z.unknown()),
});

// Usage response (admin)
const userUsageResponseSchema = z.object({
    success: z.boolean(),
    userId: z.string(),
    total: z.object({
        count: z.number().int().nonnegative(),
        firstSeen: z.string().datetime(),
        lastSeen: z.string().datetime(),
    }).nullable(),
    days: z.array(z.object({
        date: z.string(),
        count: z.number().int().nonnegative(),
        routes: z.record(z.string(), z.number()),
    })),
    lookbackDays: z.number().int().positive(),
});

// Neon project response
const neonProjectResponseSchema = z.object({
    success: z.boolean(),
    project: z.unknown().describe('Neon project object from Neon API'),
});

// Neon branches response
const neonBranchesResponseSchema = z.object({
    success: z.boolean(),
    branches: z.array(z.unknown()).describe('Array of Neon branch objects'),
});

// Neon single branch response
const neonBranchResponseSchema = z.object({
    success: z.boolean(),
    branch: z.unknown().describe('Neon branch object from Neon API'),
});

// Neon endpoints response
const neonEndpointsResponseSchema = z.object({
    success: z.boolean(),
    endpoints: z.array(z.unknown()).describe('Array of Neon compute endpoint objects'),
});

// Neon databases response
const neonDatabasesResponseSchema = z.object({
    success: z.boolean(),
    databases: z.array(z.unknown()).describe('Array of database objects for the branch'),
});

// Neon query response
const neonQueryResponseSchema = z.object({
    success: z.boolean(),
    rows: z.array(z.record(z.string(), z.unknown())),
    rowCount: z.number().int().nonnegative(),
    duration: z.string(),
});

// Agent session (extended from Prisma model)
const agentSessionSchema = z.object({
    id: z.string().uuid(),
    userId: z.string(),
    providerType: z.string(),
    providerId: z.string().nullable(),
    sessionName: z.string(),
    startedAt: z.date(),
    endedAt: z.date().nullable(),
    endReason: z.string().nullable(),
    totalInvocations: z.number().int().nonnegative(),
    totalInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
}).passthrough();

// Agent invocation (from Prisma model)
const agentInvocationSchema = z.object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    invokedAt: z.date(),
    modelUsed: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    durationMs: z.number().int().nonnegative().nullable(),
}).passthrough();

// Agent audit log (from Prisma model)
const agentAuditLogSchema = z.object({
    id: z.string().uuid(),
    userId: z.string(),
    sessionId: z.string().uuid().nullable(),
    action: z.string(),
    details: z.unknown().nullable(),
    createdAt: z.date(),
}).passthrough();

// ── Admin Auth Config ────────────────────────────────────────────────────────

const adminAuthConfigRoute = createRoute({
    method: 'get',
    path: '/admin/auth/config',
    tags: ['Admin'],
    summary: 'Get auth configuration',
    description:
        'Returns a read-only view of the authentication configuration at runtime, including active provider, social providers, MFA status, session settings, tiers, and route permissions. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'Auth configuration',
            content: {
                'application/json': {
                    schema: authConfigResponseSchema,
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
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

adminRoutes.openapi(adminAuthConfigRoute, async (c) => {
    const { handleAdminAuthConfig } = await import('../handlers/auth-config.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminAuthConfig(c) as any;
});

// ── Admin User Management ─────────────────────────────────────────────────────

const adminListUsersRoute = createRoute({
    method: 'get',
    path: '/admin/users',
    tags: ['Admin'],
    summary: 'List all users',
    description: 'Returns all Better Auth users, paginated and optionally filtered by tier, role, or search query. Admin tier and admin role required.',
    request: {
        query: adminPaginationQuerySchema.extend({
            tier: z.nativeEnum(UserTier).optional().describe('Filter by user tier'),
            role: z.string().optional().describe('Filter by user role'),
            search: z.string().optional().describe('Search by email or name (substring match)'),
        }),
    },
    responses: {
        200: {
            description: 'List of users',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        users: z.array(betterAuthUserPublicSchema),
                        total: z.number().int().nonnegative(),
                        limit: z.number().int().positive(),
                        offset: z.number().int().nonnegative(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid pagination or filter params',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminListUsersRoute, async (c) => {
    const { handleAdminListUsers } = await import('../handlers/admin-users.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminListUsers(c) as any;
});

const adminGetUserRoute = createRoute({
    method: 'get',
    path: '/admin/users/{id}',
    tags: ['Admin'],
    summary: 'Get a single user by ID',
    description: 'Returns a single Better Auth user by their ID. Admin tier and admin role required.',
    request: {
        params: z.object({
            id: z.string().describe('User ID'),
        }),
    },
    responses: {
        200: {
            description: 'User found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        user: betterAuthUserPublicSchema,
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'User not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminGetUserRoute, async (c) => {
    const { handleAdminGetUser } = await import('../handlers/admin-users.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminGetUser(c, c.req.param('id')!) as any;
});

const adminUpdateUserRoute = createRoute({
    method: 'patch',
    path: '/admin/users/{id}',
    tags: ['Admin'],
    summary: 'Update a user',
    description: "Updates a user's tier and/or role. Admin tier and admin role required.",
    request: {
        params: z.object({
            id: z.string().describe('User ID'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: adminUpdateUserRouteSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'User updated successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        user: betterAuthUserPublicSchema,
                    }),
                },
            },
        },
        400: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'User not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.use('/admin/users/:id', rateLimitMiddleware());
adminRoutes.openapi(adminUpdateUserRoute, async (c) => {
    const { handleAdminUpdateUser } = await import('../handlers/admin-users.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminUpdateUser(c, c.req.param('id')!) as any;
});

const adminDeleteUserRoute = createRoute({
    method: 'delete',
    path: '/admin/users/{id}',
    tags: ['Admin'],
    summary: 'Delete a user',
    description: 'Deletes a user and all their sessions. Admin tier and admin role required.',
    request: {
        params: z.object({
            id: z.string().describe('User ID'),
        }),
    },
    responses: {
        200: {
            description: 'User deleted successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'User not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminDeleteUserRoute, async (c) => {
    const { handleAdminDeleteUser } = await import('../handlers/admin-users.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminDeleteUser(c, c.req.param('id')!) as any;
});

const adminBanUserRoute = createRoute({
    method: 'post',
    path: '/admin/users/{id}/ban',
    tags: ['Admin'],
    summary: 'Ban a user',
    description: 'Bans a user with an optional reason and expiration date. Admin tier and admin role required.',
    request: {
        params: z.object({
            id: z.string().describe('User ID'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: adminBanUserSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'User banned successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
        },
        400: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'User not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminBanUserRoute, async (c) => {
    const { handleAdminBanUser } = await import('../handlers/admin-users.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminBanUser(c, c.req.param('id')!) as any;
});

const adminUnbanUserRoute = createRoute({
    method: 'post',
    path: '/admin/users/{id}/unban',
    tags: ['Admin'],
    summary: 'Unban a user',
    description: 'Unbans a previously banned user. Admin tier and admin role required.',
    request: {
        params: z.object({
            id: z.string().describe('User ID'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: adminUnbanUserSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'User unbanned successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
        },
        400: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'User not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.use('/admin/users/:id/unban', rateLimitMiddleware());
adminRoutes.openapi(adminUnbanUserRoute, async (c) => {
    const { handleAdminUnbanUser } = await import('../handlers/admin-users.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminUnbanUser(c, c.req.param('id')!) as any;
});

const adminRevokeUserSessionsRoute = createRoute({
    method: 'delete',
    path: '/admin/users/{id}/sessions',
    tags: ['Admin'],
    summary: 'Revoke all user sessions',
    description: 'Revokes all active sessions for a specific user. Admin tier and admin role required. Also requires Cloudflare Access JWT verification for defense-in-depth.',
    request: {
        params: z.object({
            id: z.string().describe('User ID'),
        }),
    },
    responses: {
        200: {
            description: 'Sessions revoked successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.use('/admin/users/:id/sessions', rateLimitMiddleware());
adminRoutes.openapi(adminRevokeUserSessionsRoute, async (c) => {
    const { handleAdminRevokeUserSessions } = await import('./admin.routes.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminRevokeUserSessions(c) as any;
});

// ── Admin Usage ───────────────────────────────────────────────────────────────

const adminGetUserUsageRoute = createRoute({
    method: 'get',
    path: '/admin/usage/{userId}',
    tags: ['Admin'],
    summary: 'Get user API usage statistics',
    description: 'Returns per-user API usage statistics from KV storage for a specified lookback period. Admin tier and admin role required.',
    request: {
        params: z.object({
            userId: z.string().describe('User ID to get usage for'),
        }),
        query: adminUsageDaysQuerySchema,
    },
    responses: {
        200: {
            description: 'User usage statistics',
            content: {
                'application/json': {
                    schema: userUsageResponseSchema,
                },
            },
        },
        400: {
            description: 'Invalid days parameter',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
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

adminRoutes.openapi(adminGetUserUsageRoute, async (c) => {
    const { handleAdminGetUserUsage } = await import('../handlers/admin-usage.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminGetUserUsage(c, c.req.param('userId')!) as any;
});

// ── Admin Storage ─────────────────────────────────────────────────────────────

const adminStorageStatsRoute = createRoute({
    method: 'get',
    path: '/admin/storage/stats',
    tags: ['Admin'],
    summary: 'Get storage statistics',
    description: 'Returns statistics about storage entries, filter cache, compilation metadata, and expired entries. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'Storage statistics',
            content: {
                'application/json': {
                    schema: storageStatsResponseSchema,
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminStorageStatsRoute, async (c) => {
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    // deno-lint-ignore no-explicit-any
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext')) as any;
});

const adminClearExpiredRoute = createRoute({
    method: 'post',
    path: '/admin/storage/clear-expired',
    tags: ['Admin'],
    summary: 'Clear expired storage entries',
    description: 'Deletes all expired storage entries and filter cache entries. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'Expired entries cleared successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        deleted: z.number().int().nonnegative(),
                        message: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminClearExpiredRoute, async (c) => {
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    // deno-lint-ignore no-explicit-any
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext')) as any;
});

const adminClearCacheRoute = createRoute({
    method: 'post',
    path: '/admin/storage/clear-cache',
    tags: ['Admin'],
    summary: 'Clear all cache entries',
    description: 'Deletes all filter cache entries and cache-related storage entries. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'Cache entries cleared successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        deleted: z.number().int().nonnegative(),
                        message: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminClearCacheRoute, async (c) => {
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    // deno-lint-ignore no-explicit-any
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext')) as any;
});

const adminExportRoute = createRoute({
    method: 'get',
    path: '/admin/storage/export',
    tags: ['Admin'],
    summary: 'Export storage data',
    description:
        'Exports storage entries, filter cache, and compilation metadata as JSON. Limited to 1000 storage entries, 100 filter cache entries, and 100 compilation metadata entries. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'Storage data exported successfully',
            content: {
                'application/json': {
                    schema: exportDataResponseSchema,
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminExportRoute, async (c) => {
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    // deno-lint-ignore no-explicit-any
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext')) as any;
});

const adminVacuumRoute = createRoute({
    method: 'post',
    path: '/admin/storage/vacuum',
    tags: ['Admin'],
    summary: 'Vacuum D1 database',
    description: 'Runs VACUUM on the D1 database to reclaim storage space. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'Database vacuum completed successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'D1 database not configured',
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

adminRoutes.openapi(adminVacuumRoute, async (c) => {
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    // deno-lint-ignore no-explicit-any
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext')) as any;
});

const adminListTablesRoute = createRoute({
    method: 'get',
    path: '/admin/storage/tables',
    tags: ['Admin'],
    summary: 'List database tables',
    description: 'Returns a list of all tables and indexes in the D1 database. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'List of tables and indexes',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        tables: z.array(tableInfoSchema),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'D1 database not configured',
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

adminRoutes.openapi(adminListTablesRoute, async (c) => {
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    // deno-lint-ignore no-explicit-any
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext')) as any;
});

const adminQueryRoute = createRoute({
    method: 'post',
    path: '/admin/storage/query',
    tags: ['Admin'],
    summary: 'Execute read-only SQL query',
    description: 'Executes a read-only SELECT query against the D1 database. Only SELECT queries are allowed, with a maximum of 1000 rows. Admin tier and admin role required.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: adminQueryRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Query executed successfully',
            content: {
                'application/json': {
                    schema: storageQueryResponseSchema,
                },
            },
        },
        400: {
            description: 'Invalid query or validation error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role and Cloudflare Access JWT',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'D1 database not configured',
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

adminRoutes.openapi(adminQueryRoute, async (c) => {
    const { routeAdminStorage } = await import('../handlers/admin.ts');
    // deno-lint-ignore no-explicit-any
    return routeAdminStorage(c.req.path, c.req.raw, c.env, c.get('authContext')) as any;
});

// ── Admin Neon ────────────────────────────────────────────────────────────────

const adminNeonGetProjectRoute = createRoute({
    method: 'get',
    path: '/admin/neon/project',
    tags: ['Admin'],
    summary: 'Get Neon project overview',
    description: 'Returns Neon project information. Requires projectId as query parameter or NEON_PROJECT_ID env variable. Admin tier and admin role required.',
    request: {
        query: z.object({
            projectId: z.string().optional().describe('Neon project ID (overrides NEON_PROJECT_ID env)'),
        }),
    },
    responses: {
        200: {
            description: 'Neon project information',
            content: {
                'application/json': {
                    schema: neonProjectResponseSchema,
                },
            },
        },
        400: {
            description: 'Missing project ID',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonGetProjectRoute, async (c) => {
    const { handleAdminNeonGetProject } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonGetProject(c) as any;
});

const adminNeonListBranchesRoute = createRoute({
    method: 'get',
    path: '/admin/neon/branches',
    tags: ['Admin'],
    summary: 'List Neon branches',
    description: 'Returns all branches for a Neon project. Requires projectId as query parameter or NEON_PROJECT_ID env variable. Admin tier and admin role required.',
    request: {
        query: z.object({
            projectId: z.string().optional().describe('Neon project ID (overrides NEON_PROJECT_ID env)'),
        }),
    },
    responses: {
        200: {
            description: 'List of Neon branches',
            content: {
                'application/json': {
                    schema: neonBranchesResponseSchema,
                },
            },
        },
        400: {
            description: 'Missing project ID',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonListBranchesRoute, async (c) => {
    const { handleAdminNeonListBranches } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonListBranches(c) as any;
});

const adminNeonGetBranchRoute = createRoute({
    method: 'get',
    path: '/admin/neon/branches/{branchId}',
    tags: ['Admin'],
    summary: 'Get Neon branch details',
    description:
        'Returns detailed information about a specific Neon branch. Requires projectId as query parameter or NEON_PROJECT_ID env variable. Admin tier and admin role required.',
    request: {
        params: z.object({
            branchId: z.string().describe('Neon branch ID'),
        }),
        query: z.object({
            projectId: z.string().optional().describe('Neon project ID (overrides NEON_PROJECT_ID env)'),
        }),
    },
    responses: {
        200: {
            description: 'Neon branch details',
            content: {
                'application/json': {
                    schema: neonBranchResponseSchema,
                },
            },
        },
        400: {
            description: 'Missing project ID',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'Branch not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonGetBranchRoute, async (c) => {
    const { handleAdminNeonGetBranch } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonGetBranch(c, c.req.param('branchId')!) as any;
});

const adminNeonCreateBranchRoute = createRoute({
    method: 'post',
    path: '/admin/neon/branches',
    tags: ['Admin'],
    summary: 'Create a Neon branch',
    description: 'Creates a new Neon branch. Requires projectId as query parameter or NEON_PROJECT_ID env variable. Admin tier and admin role required.',
    request: {
        query: z.object({
            projectId: z.string().optional().describe('Neon project ID (overrides NEON_PROJECT_ID env)'),
        }),
        body: {
            content: {
                'application/json': {
                    schema: adminNeonCreateBranchSchema,
                },
            },
        },
    },
    responses: {
        201: {
            description: 'Branch created successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                    }).passthrough(),
                },
            },
        },
        400: {
            description: 'Validation error or missing project ID',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonCreateBranchRoute, async (c) => {
    const { handleAdminNeonCreateBranch } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonCreateBranch(c) as any;
});

const adminNeonDeleteBranchRoute = createRoute({
    method: 'delete',
    path: '/admin/neon/branches/{branchId}',
    tags: ['Admin'],
    summary: 'Delete a Neon branch',
    description: 'Deletes a Neon branch. Requires projectId as query parameter or NEON_PROJECT_ID env variable. Admin tier and admin role required.',
    request: {
        params: z.object({
            branchId: z.string().describe('Neon branch ID'),
        }),
        query: z.object({
            projectId: z.string().optional().describe('Neon project ID (overrides NEON_PROJECT_ID env)'),
        }),
    },
    responses: {
        200: {
            description: 'Branch deleted successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                    }).passthrough(),
                },
            },
        },
        400: {
            description: 'Missing project ID',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'Branch not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonDeleteBranchRoute, async (c) => {
    const { handleAdminNeonDeleteBranch } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonDeleteBranch(c, c.req.param('branchId')!) as any;
});

const adminNeonListEndpointsRoute = createRoute({
    method: 'get',
    path: '/admin/neon/endpoints',
    tags: ['Admin'],
    summary: 'List Neon compute endpoints',
    description: 'Returns all compute endpoints for a Neon project. Requires projectId as query parameter or NEON_PROJECT_ID env variable. Admin tier and admin role required.',
    request: {
        query: z.object({
            projectId: z.string().optional().describe('Neon project ID (overrides NEON_PROJECT_ID env)'),
        }),
    },
    responses: {
        200: {
            description: 'List of Neon endpoints',
            content: {
                'application/json': {
                    schema: neonEndpointsResponseSchema,
                },
            },
        },
        400: {
            description: 'Missing project ID',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonListEndpointsRoute, async (c) => {
    const { handleAdminNeonListEndpoints } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonListEndpoints(c) as any;
});

const adminNeonListDatabasesRoute = createRoute({
    method: 'get',
    path: '/admin/neon/databases/{branchId}',
    tags: ['Admin'],
    summary: 'List databases for a branch',
    description: 'Returns all databases for a specific Neon branch. Requires projectId as query parameter or NEON_PROJECT_ID env variable. Admin tier and admin role required.',
    request: {
        params: z.object({
            branchId: z.string().describe('Neon branch ID'),
        }),
        query: z.object({
            projectId: z.string().optional().describe('Neon project ID (overrides NEON_PROJECT_ID env)'),
        }),
    },
    responses: {
        200: {
            description: 'List of databases for the branch',
            content: {
                'application/json': {
                    schema: neonDatabasesResponseSchema,
                },
            },
        },
        400: {
            description: 'Missing project ID',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonListDatabasesRoute, async (c) => {
    const { handleAdminNeonListDatabases } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonListDatabases(c, c.req.param('branchId')!) as any;
});

const adminNeonQueryRoute = createRoute({
    method: 'post',
    path: '/admin/neon/query',
    tags: ['Admin'],
    summary: 'Execute SQL query via Neon serverless driver',
    description: 'Executes a SQL query against a Neon database using the serverless driver. Admin tier and admin role required.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: adminNeonQuerySchema,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Query executed successfully',
            content: {
                'application/json': {
                    schema: neonQueryResponseSchema,
                },
            },
        },
        400: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'NEON_API_KEY not configured',
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

adminRoutes.openapi(adminNeonQueryRoute, async (c) => {
    const { handleAdminNeonQuery } = await import('../handlers/admin-neon.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminNeonQuery(c) as any;
});

// ── Admin Agent Data ──────────────────────────────────────────────────────────

const adminListAgentSessionsRoute = createRoute({
    method: 'get',
    path: '/admin/agents/sessions',
    tags: ['Admin'],
    summary: 'List agent sessions',
    description: 'Returns all agent sessions, paginated and sorted by most recent first. Admin tier and admin role required.',
    request: {
        query: adminPaginationQuerySchema,
    },
    responses: {
        200: {
            description: 'List of agent sessions',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        items: z.array(agentSessionSchema),
                        total: z.number().int().nonnegative(),
                        limit: z.number().int().positive(),
                        offset: z.number().int().nonnegative(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid pagination params',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminListAgentSessionsRoute, async (c) => {
    const { handleAdminListAgentSessions } = await import('../handlers/admin-agents.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminListAgentSessions(c) as any;
});

const adminGetAgentSessionRoute = createRoute({
    method: 'get',
    path: '/admin/agents/sessions/{sessionId}',
    tags: ['Admin'],
    summary: 'Get agent session details',
    description: 'Returns a single agent session by ID, including all its invocations. Admin tier and admin role required.',
    request: {
        params: z.object({
            sessionId: z.string().uuid().describe('Agent session ID'),
        }),
    },
    responses: {
        200: {
            description: 'Agent session with invocations',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                    }).merge(agentSessionSchema.extend({
                        invocations: z.array(agentInvocationSchema),
                    })),
                },
            },
        },
        400: {
            description: 'Invalid session ID format',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'Agent session not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminGetAgentSessionRoute, async (c) => {
    const { handleAdminGetAgentSession } = await import('../handlers/admin-agents.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminGetAgentSession(c, c.req.param('sessionId')!) as any;
});

const adminListAgentAuditLogRoute = createRoute({
    method: 'get',
    path: '/admin/agents/audit',
    tags: ['Admin'],
    summary: 'List agent audit log',
    description: 'Returns all agent audit log entries, paginated and sorted by most recent first. Admin tier and admin role required.',
    request: {
        query: adminPaginationQuerySchema,
    },
    responses: {
        200: {
            description: 'List of audit log entries',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        items: z.array(agentAuditLogSchema),
                        total: z.number().int().nonnegative(),
                        limit: z.number().int().positive(),
                        offset: z.number().int().nonnegative(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid pagination params',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.openapi(adminListAgentAuditLogRoute, async (c) => {
    const { handleAdminListAgentAuditLog } = await import('../handlers/admin-agents.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminListAgentAuditLog(c) as any;
});

const adminTerminateAgentSessionRoute = createRoute({
    method: 'delete',
    path: '/admin/agents/sessions/{sessionId}',
    tags: ['Admin'],
    summary: 'Terminate an agent session',
    description: 'Terminates an active agent session. Returns 409 if the session is already ended. Admin tier and admin role required.',
    request: {
        params: z.object({
            sessionId: z.string().uuid().describe('Agent session ID'),
        }),
    },
    responses: {
        200: {
            description: 'Agent session terminated successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        message: z.string(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid session ID format',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        403: {
            description: 'Forbidden - requires admin role',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        404: {
            description: 'Agent session not found',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        409: {
            description: 'Session already ended',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
        503: {
            description: 'Database not configured',
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

adminRoutes.use('/admin/agents/sessions/:sessionId', rateLimitMiddleware());
adminRoutes.openapi(adminTerminateAgentSessionRoute, async (c) => {
    const { handleAdminTerminateAgentSession } = await import('../handlers/admin-agents.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminTerminateAgentSession(c, c.req.param('sessionId')!) as any;
});

// ── Security Overview ─────────────────────────────────────────────────────────

const securityOverviewQuerySchema = z.object({
    window: z.enum(['24h', '7d', '30d']).default('24h').describe('Time window for aggregation'),
});

const securityEventTypeCountSchema = z.object({
    event_type: z.string(),
    count: z.number().int().nonnegative(),
});

const topTargetedResourceSchema = z.object({
    resource_type: z.string(),
    count: z.number().int().nonnegative(),
});

const securityOverviewEventSchema = z.object({
    id: z.number().int(),
    actor_id: z.string(),
    action: z.string(),
    resource_type: z.string(),
    resource_id: z.string().nullable(),
    status: z.enum(['failure', 'denied']),
    ip_address: z.string().nullable(),
    created_at: z.string(),
});

const securityOverviewResponseSchema = z.object({
    success: z.literal(true),
    timestamp: z.string().datetime(),
    window: z.enum(['24h', '7d', '30d']),
    total_security_events: z.number().int().nonnegative(),
    by_status: z.object({ denied: z.number().int().nonnegative(), failure: z.number().int().nonnegative() }),
    by_action: z.array(securityEventTypeCountSchema),
    by_resource_type: z.array(topTargetedResourceSchema),
    recent_events: z.array(securityOverviewEventSchema),
    analytics_engine_tracked_events: z.array(z.string()),
    analytics_engine_configured: z.boolean(),
});

const adminSecurityOverviewRoute = createRoute({
    method: 'get',
    path: '/admin/security/overview',
    tags: ['Admin'],
    summary: 'Security Overview',
    description: 'Returns aggregated security event metrics from the admin audit log. ' +
        'Surfaces denied/failed entries by action and resource type. ' +
        'Also reports which event types are actively tracked in Analytics Engine. ' +
        'Admin tier and admin role required.',
    request: {
        query: securityOverviewQuerySchema,
    },
    responses: {
        200: {
            description: 'Security overview metrics',
            content: {
                'application/json': {
                    schema: securityOverviewResponseSchema,
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        403: {
            description: 'Forbidden — admin role required',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        500: {
            description: 'Server error',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

adminRoutes.openapi(adminSecurityOverviewRoute, async (c) => {
    const { handleSecurityOverview } = await import('../handlers/security-overview.ts');
    // deno-lint-ignore no-explicit-any
    return handleSecurityOverview(c.req.raw, c.env) as any;
});

// ── Admin Email routes ────────────────────────────────────────────────────────

/**
 * Email provider configuration status.
 *
 * Returns which email provider is active (`queued`, `cf_email_worker`, or `none`),
 * and whether the `EMAIL_QUEUE` and `SEND_EMAIL` bindings are present.
 *
 * ZTA: Admin tier + admin role required. Implemented via
 * `checkRoutePermission('/admin/email/config', authContext)` in the handler.
 */
const adminEmailConfigRoute = createRoute({
    method: 'get',
    path: '/admin/email/config',
    tags: ['Admin'],
    operationId: 'admin-email-get-config',
    summary: 'Email provider configuration status',
    description: 'Returns which email provider is active (Queue+Workflow, CF Email Workers, or none) and binding presence. Admin tier and admin role required.',
    responses: {
        200: {
            description: 'Email configuration status',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        timestamp: z.string().describe('ISO 8601 timestamp'),
                        provider: z.enum(['queued', 'cf_email_worker', 'none']).describe(
                            'Active email provider: queued = EMAIL_QUEUE→EmailDeliveryWorkflow; cf_email_worker = direct SEND_EMAIL binding; none = no provider',
                        ),
                        email_queue_configured: z.boolean().describe('Whether EMAIL_QUEUE binding is present (durable queue-backed delivery)'),
                        send_email_binding_configured: z.boolean().describe('Whether SEND_EMAIL binding is present'),
                    }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        403: {
            description: 'Forbidden — admin role required',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

adminRoutes.openapi(adminEmailConfigRoute, async (c) => {
    const { handleAdminEmailConfig } = await import('../handlers/admin-email.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminEmailConfig(c as any) as any;
});

/**
 * Send a test email to verify end-to-end delivery.
 *
 * Uses the same `createEmailService` factory as production sends, so the
 * test reflects the actual active provider. Returns 503 when no provider
 * is configured.
 *
 * ZTA: Admin tier + admin role required.
 */
const adminEmailTestRoute = createRoute({
    method: 'post',
    path: '/admin/email/test',
    tags: ['Admin'],
    operationId: 'admin-email-post-test',
    summary: 'Send a test email',
    description:
        'Sends a test transactional email to the specified recipient using the currently configured email provider (CF Email Workers or Queue+Workflow). Returns 503 when no provider is configured. Admin test sends always use direct delivery (bypassing the queue) for immediate synchronous feedback. Admin tier and admin role required.',
    request: {
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: z.object({
                        to: z.string().email().describe('Recipient email address for the test send'),
                        subject: z.string().min(1).max(200).optional().describe('Optional subject override'),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Test email dispatched',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        timestamp: z.string().describe('ISO 8601 timestamp'),
                        message: z.string().describe('Result message'),
                        provider: z.enum(['cf_email_worker']).describe(
                            'Provider used for the test send (always direct — queue is bypassed for admin tests)',
                        ),
                        to: z.string().email().describe('Recipient address'),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid request body',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        401: {
            description: 'Unauthorized',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        403: {
            description: 'Forbidden — admin role required',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        503: {
            description: 'No email provider configured',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

adminRoutes.openapi(adminEmailTestRoute, async (c) => {
    const { handleAdminEmailTest } = await import('../handlers/admin-email.ts');
    // deno-lint-ignore no-explicit-any
    return handleAdminEmailTest(c as any) as any;
});

// ── Admin session revocation handler ─────────────────────────────────────────

/**
 * Admin session revocation handler — revoke all sessions for a specific user.
 *
 * Implementation note: Better Auth's admin plugin does not expose a typed
 * `auth.api.admin.revokeUserSessions()` method callable without a full HTTP
 * request context. Instead this handler constructs an internal Request and
 * dispatches it through `auth.handler()` to invoke the
 * `POST /api/auth/admin/revoke-user-sessions` endpoint. This ensures Better
 * Auth's session cache and KV secondary storage are both properly invalidated.
 *
 * ZTA compliance:
 *  - Requires admin role
 *  - Verifies Cloudflare Access JWT (defense-in-depth)
 *  - Emits `cf_access_denial` security event on CF Access failure
 */
export async function handleAdminRevokeUserSessions(
    c: {
        req: { raw: Request; path: string; method: string; param: (key: string) => string | undefined };
        env: Env;
        get: (key: string) => unknown;
        json: (data: unknown, status?: number) => Response;
    },
): Promise<Response> {
    const { verifyCfAccessJwt } = await import('../middleware/cf-access.ts');
    const { AnalyticsService } = await import('../../src/services/AnalyticsService.ts');
    const { createAuth } = await import('../lib/auth.ts');

    const authContext = c.get('authContext') as { role?: string };
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
        const baseURL = new URL(c.req.raw.url).origin;
        const auth = createAuth(c.env, baseURL);
        const adminHeaders = new Headers(c.req.raw.headers);
        adminHeaders.set('content-type', 'application/json');
        const abortController = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const adminRequest = new Request(
            `${baseURL}/api/auth/admin/revoke-user-sessions`,
            { method: 'POST', headers: adminHeaders, body: JSON.stringify({ userId }), signal: abortController.signal },
        );
        const response = await Promise.race([
            auth.handler(adminRequest),
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    abortController.abort();
                    reject(new DOMException('Session revocation exceeded 10s timeout', 'TimeoutError'));
                }, 10_000);
            }),
        ]).finally(() => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            let errorMsg = 'Failed to revoke sessions';
            try {
                const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
                if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
                    errorMsg = parsed.message;
                } else if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
                    errorMsg = parsed.error;
                }
            } catch {
                /* Better Auth error responses are not always JSON — fall back to the generic message */
            }
            const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
            return c.json({ success: false, error: errorMsg }, status);
        }
        return c.json({ success: true, message: `Sessions revoked for user ${userId}` });
    } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            // 'TimeoutError' is thrown by the Promise.race timeout above.
            // 'AbortError' is emitted by abortController.abort() if the underlying
            // fetch detects the signal cancellation before the explicit reject fires.
            // deno-lint-ignore no-console
            console.error('[admin] Session revocation timed out for user:', userId);
            return c.json({ success: false, error: 'Session revocation timed out' }, 504);
        }
        // deno-lint-ignore no-console
        console.error('[admin] Session revocation error:', error instanceof Error ? error.message : 'unknown');
        return c.json({ success: false, error: 'Failed to revoke sessions' }, 500);
    }
}

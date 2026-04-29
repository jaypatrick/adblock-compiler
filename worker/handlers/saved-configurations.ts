/**
 * Saved Configuration handlers.
 *
 * Allows authenticated users to persist configurations to their Neon account:
 *   GET    /api/configuration/saved         — list user's saved configs
 *   POST   /api/configuration/saved         — save a new config
 *   DELETE /api/configuration/saved/:id     — delete a saved config
 *
 * ## Authentication
 *
 * These endpoints accept Better Auth sessions only. The `auth.userId` field
 * is verified before every DB operation (ZTA).
 *
 * ## Storage
 *
 * Uses Prisma ORM via Hyperdrive for all database operations.
 * The `user_configurations` table schema is defined in `prisma/schema.prisma`.
 *
 * @see worker/routes/configuration.routes.ts — route definitions
 * @see prisma/schema.prisma — UserConfiguration model
 */

import { JsonResponse } from '../utils/response.ts';
import { type IAuthContext } from '../types.ts';
import type { PrismaClientExtended } from '../lib/prisma.ts';

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

export interface SaveConfigBody {
    name: string;
    description?: string;
    config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function requireUserId(authContext: IAuthContext): Response | null {
    if (!authContext.userId) {
        return JsonResponse.forbidden('User identity is not available for this session. Please sign out and sign in again.');
    }
    return null;
}

function isValidSaveBody(body: unknown): body is SaveConfigBody {
    if (!body || typeof body !== 'object') return false;
    const b = body as Record<string, unknown>;
    if (typeof b['name'] !== 'string' || b['name'].trim().length === 0) return false;
    if (b['description'] !== undefined && typeof b['description'] !== 'string') return false;
    if (!b['config'] || typeof b['config'] !== 'object' || Array.isArray(b['config'])) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/configuration/saved — List the authenticated user's saved configurations.
 *
 * Returns up to 50 entries ordered by `updatedAt DESC`.
 * Never returns the `config` JSON blob in the list — only metadata.
 */
export async function handleListSavedConfigurations(
    _request: Request,
    _env: unknown,
    auth: IAuthContext,
    prisma: PrismaClientExtended | null,
): Promise<Response> {
    if (!prisma) return JsonResponse.serviceUnavailable('Database not configured');
    const userGuard = requireUserId(auth);
    if (userGuard) return userGuard;

    const rows = await prisma.userConfiguration.findMany({
        where: { userId: auth.userId! },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
    });

    const configs = rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }));

    return JsonResponse.success({ configs, total: configs.length });
}

/**
 * POST /api/configuration/saved — Save a new configuration.
 *
 * Inserts a new row into `user_configurations` and returns the created record
 * (including the stored `config` JSON).
 *
 * Request body: `{ name: string, description?: string, config: Record<string, unknown> }`
 */
export async function handleSaveConfiguration(
    _request: Request,
    _env: unknown,
    auth: IAuthContext,
    prisma: PrismaClientExtended | null,
    body: unknown,
): Promise<Response> {
    if (!prisma) return JsonResponse.serviceUnavailable('Database not configured');
    const userGuard = requireUserId(auth);
    if (userGuard) return userGuard;

    if (!isValidSaveBody(body)) {
        return JsonResponse.badRequest('Invalid request body — required: name (string), config (object); optional: description (string)');
    }

    const { name, description, config } = body;

    const row = await prisma.userConfiguration.create({
        data: {
            userId: auth.userId!,
            name: name.trim(),
            description: description ?? null,
            config: config as object,
        },
    });

    return JsonResponse.success(
        {
            id: row.id,
            name: row.name,
            description: row.description,
            config: row.config,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        },
        { status: 201 },
    );
}

/**
 * DELETE /api/configuration/saved/:id — Delete a saved configuration.
 *
 * Ownership is verified against `auth.userId`. Returns 404 if the record
 * does not exist or is owned by a different user.
 *
 * Returns HTTP 204 on success with an empty body.
 */
export async function handleDeleteSavedConfiguration(
    _request: Request,
    _env: unknown,
    auth: IAuthContext,
    prisma: PrismaClientExtended | null,
    id: string,
): Promise<Response> {
    if (!prisma) return JsonResponse.serviceUnavailable('Database not configured');
    const userGuard = requireUserId(auth);
    if (userGuard) return userGuard;

    const result = await prisma.userConfiguration.deleteMany({
        where: { id, userId: auth.userId! },
    });

    if (result.count === 0) {
        return JsonResponse.notFound('Saved configuration not found');
    }

    return new Response(null, { status: 204 });
}

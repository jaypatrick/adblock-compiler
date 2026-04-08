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
 * Uses raw pg queries via Hyperdrive (no Prisma client at runtime).
 * The `user_configurations` table schema is defined in `prisma/schema.prisma`.
 *
 * All DB queries use parameterized statements — no string interpolation.
 *
 * @see worker/handlers/api-keys.ts — same PgPool pattern
 * @see worker/routes/configuration.routes.ts — route definitions
 * @see prisma/schema.prisma — UserConfiguration model
 */

import { JsonResponse } from '../utils/response.ts';
import { type IAuthContext } from '../types.ts';
import { type PgPool } from '../utils/pg-pool.ts';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/** Row shape for user_configurations table queries. */
interface UserConfigRow {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    config: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

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
 * Returns up to 50 entries ordered by `updated_at DESC`.
 * Never returns the `config` JSON blob in the list — only metadata.
 */
export async function handleListSavedConfigurations(
    _request: Request,
    _env: unknown,
    auth: IAuthContext,
    pool: PgPool,
): Promise<Response> {
    const userGuard = requireUserId(auth);
    if (userGuard) return userGuard;

    const result = await pool.query<UserConfigRow>(
        `SELECT id, user_id, name, description, created_at, updated_at
         FROM user_configurations
         WHERE user_id = $1
         ORDER BY updated_at DESC
         LIMIT 50`,
        [auth.userId],
    );

    const configs = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
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
    pool: PgPool,
    body: unknown,
): Promise<Response> {
    const userGuard = requireUserId(auth);
    if (userGuard) return userGuard;

    if (!isValidSaveBody(body)) {
        return JsonResponse.badRequest('Invalid request body — required: name (string), config (object); optional: description (string)');
    }

    const { name, description, config } = body;

    const result = await pool.query<UserConfigRow>(
        `INSERT INTO user_configurations (id, user_id, name, description, config, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, now(), now())
         RETURNING id, user_id, name, description, config, created_at, updated_at`,
        [auth.userId, name.trim(), description ?? null, JSON.stringify(config)],
    );

    const row = result.rows[0];
    if (!row) {
        return JsonResponse.serverError('Failed to save configuration');
    }

    return JsonResponse.success(
        {
            id: row.id,
            name: row.name,
            description: row.description,
            config: row.config,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
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
    pool: PgPool,
    id: string,
): Promise<Response> {
    const userGuard = requireUserId(auth);
    if (userGuard) return userGuard;

    const result = await pool.query(
        `DELETE FROM user_configurations
         WHERE id = $1 AND user_id = $2`,
        [id, auth.userId],
    );

    if ((result.rowCount ?? 0) === 0) {
        return JsonResponse.notFound('Saved configuration not found');
    }

    return new Response(null, { status: 204 });
}

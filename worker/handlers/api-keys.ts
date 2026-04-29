/**
 * API Key Management Handlers
 *
 * CRUD operations for user API keys:
 *   - POST   /api/keys       — Create a new API key
 *   - GET    /api/keys       — List the authenticated user's keys
 *   - DELETE /api/keys/:id   — Revoke a key
 *   - PATCH  /api/keys/:id   — Update key name or scopes
 *
 * ## Authentication
 *
 * These endpoints accept Better Auth sessions.  The upstream auth middleware
 * (`authenticateRequestUnified`) resolves credentials and populates
 * {@link IAuthContext}.  Route-level guards in `hono-app.ts` enforce that
 * only interactive session methods (`better-auth`) can manage keys —
 * API-key-on-API-key and anonymous requests are rejected.
 *
 * The `api_keys.user_id` column stores the Better Auth user UUID from the
 * `users` table.
 *
 * Keys are generated with a `abc_` prefix and stored as SHA-256 hashes —
 * the plaintext is returned **only once** on creation.
 *
 * All request/response bodies are Zod-validated via the schemas in
 * `worker/schemas.ts` ({@link CreateApiKeyRequestSchema},
 * {@link UpdateApiKeyRequestSchema}).
 *
 * Uses Prisma ORM via Hyperdrive.
 *
 * @see worker/middleware/auth.ts — authenticateRequestUnified (dual provider)
 * @see worker/hono-app.ts — INTERACTIVE_AUTH_METHODS guard
 * @see worker/schemas.ts — Zod schemas for request/response validation
 */

import { JsonResponse } from '../utils/response.ts';
import { type IAuthContext } from '../types.ts';
import { CreateApiKeyRequestSchema, UpdateApiKeyRequestSchema } from '../schemas.ts';
import type { PrismaClientExtended } from '../lib/prisma.ts';

// ---------------------------------------------------------------------------
// Key generation helpers
// ---------------------------------------------------------------------------

const API_KEY_PREFIX = 'abc_';
const KEY_BYTE_LENGTH = 32;

/**
 * Generate a cryptographically random API key with `abc_` prefix.
 * The raw bytes are base64url-encoded for URL safety.
 */
function generateApiKey(): string {
    const bytes = new Uint8Array(KEY_BYTE_LENGTH);
    crypto.getRandomValues(bytes);
    // base64url encoding (no padding)
    const base64 = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `${API_KEY_PREFIX}${base64}`;
}

/**
 * Hash an API key using SHA-256 (Web Crypto API).
 */
async function hashKey(key: string): Promise<string> {
    const data = new TextEncoder().encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_KEYS_PER_USER = 25;

function requireUserId(authContext: IAuthContext): Response | null {
    if (!authContext.userId) {
        return JsonResponse.forbidden('User identity is not available for this session. Please sign out and sign in again.');
    }
    return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/keys — Create a new API key.
 *
 * The `authContext.userId` is the authenticated Better Auth user ID.
 * The resulting `userId` stored in `api_keys` is the Better Auth user UUID.
 *
 * The plaintext key is returned in the response body **once**. The caller must
 * store it securely; only the SHA-256 hash is persisted.
 *
 * Request body is validated against {@link CreateApiKeyRequestSchema}.
 */
export async function handleCreateApiKey(
    body: unknown,
    authContext: IAuthContext,
    prisma: PrismaClientExtended | null,
): Promise<Response> {
    if (prisma === null) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    const userGuard = requireUserId(authContext);
    if (userGuard) {
        return userGuard;
    }

    const parsed = CreateApiKeyRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { data } = parsed;

    // Validate expiry
    let expiresAt: Date | null = null;
    if (data.expiresInDays !== undefined) {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + data.expiresInDays);
        expiresAt = expiry;
    }

    // Enforce per-user key limit
    const currentCount = await prisma.apiKey.count({
        where: { userId: authContext.userId!, revokedAt: null },
    });
    if (currentCount >= MAX_KEYS_PER_USER) {
        return JsonResponse.badRequest(`Maximum of ${MAX_KEYS_PER_USER} active API keys per user`);
    }

    // Generate key + hash
    const plaintext = generateApiKey();
    const keyHash = await hashKey(plaintext);
    const keyPrefix = plaintext.substring(0, API_KEY_PREFIX.length + 4); // "abc_XXXX"

    const row = await prisma.apiKey.create({
        data: {
            userId: authContext.userId!,
            keyHash,
            keyPrefix,
            name: data.name.trim(),
            // `data.scopes` is guaranteed non-undefined here because
            // `CreateApiKeyRequestSchema` declares `.default([AuthScope.Compile])`
            // in `worker/schemas.ts`, so Zod always fills in the default value.
            scopes: data.scopes,
            rateLimitPerMinute: 60,
            expiresAt: expiresAt,
        },
        select: {
            id: true,
            keyPrefix: true,
            name: true,
            scopes: true,
            rateLimitPerMinute: true,
            expiresAt: true,
            createdAt: true,
        },
    });

    return JsonResponse.success({
        id: row.id,
        key: plaintext, // Plaintext returned only on creation
        keyPrefix: row.keyPrefix,
        name: row.name,
        scopes: row.scopes,
        rateLimitPerMinute: row.rateLimitPerMinute,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
    }, { status: 201 });
}

/**
 * GET /api/keys — List the authenticated user's API keys.
 *
 * Keys are filtered by `authContext.userId` (Better Auth user ID).
 *
 * Returns metadata only (never the key hash or plaintext).
 */
export async function handleListApiKeys(
    authContext: IAuthContext,
    prisma: PrismaClientExtended | null,
): Promise<Response> {
    if (prisma === null) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    const userGuard = requireUserId(authContext);
    if (userGuard) {
        return userGuard;
    }

    const rows = await prisma.apiKey.findMany({
        where: { userId: authContext.userId! },
        orderBy: { createdAt: 'desc' },
    });

    const keys = rows.map((row) => ({
        id: row.id,
        keyPrefix: row.keyPrefix,
        name: row.name,
        scopes: row.scopes,
        rateLimitPerMinute: row.rateLimitPerMinute,
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        isActive: row.revokedAt === null && (row.expiresAt === null || row.expiresAt > new Date()),
    }));

    return JsonResponse.success({ keys, total: keys.length });
}

/**
 * DELETE /api/keys/:id — Revoke an API key (soft-delete).
 *
 * Ownership is verified against `authContext.userId` (Better Auth user ID).
 *
 * Sets `revokedAt` to the current timestamp. The key remains in the
 * database for audit purposes but is no longer valid for authentication.
 */
export async function handleRevokeApiKey(
    keyId: string,
    authContext: IAuthContext,
    prisma: PrismaClientExtended | null,
): Promise<Response> {
    if (prisma === null) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    const userGuard = requireUserId(authContext);
    if (userGuard) {
        return userGuard;
    }

    // Use a single atomic `update` rather than `updateMany`.
    // Prisma's `update` supports non-unique filters in `where` alongside the
    // primary key — throws P2025 if the key doesn't exist, belongs to another
    // user, or is already revoked. All three cases map to a 404 response.
    try {
        await prisma.apiKey.update({
            where: { id: keyId, userId: authContext.userId!, revokedAt: null },
            data: { revokedAt: new Date() },
            select: { id: true },
        });
    } catch (e) {
        if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2025') {
            return JsonResponse.notFound('API key not found or already revoked');
        }
        throw e;
    }

    return JsonResponse.success({ message: 'API key revoked' });
}

/**
 * PATCH /api/keys/:id — Update an API key's name or scopes.
 *
 * Ownership is verified against `authContext.userId` (Better Auth user ID).
 *
 * Request body is validated against {@link UpdateApiKeyRequestSchema}.
 */
export async function handleUpdateApiKey(
    keyId: string,
    body: unknown,
    authContext: IAuthContext,
    prisma: PrismaClientExtended | null,
): Promise<Response> {
    if (prisma === null) {
        return JsonResponse.serviceUnavailable('Database not configured');
    }

    const userGuard = requireUserId(authContext);
    if (userGuard) {
        return userGuard;
    }

    const parsed = UpdateApiKeyRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { data } = parsed;

    // Build update data object
    const updateData: { name?: string; scopes?: string[] } = {};
    if (data.name !== undefined) {
        updateData.name = data.name.trim();
    }
    if (data.scopes !== undefined) {
        updateData.scopes = data.scopes;
    }

    // Use a single atomic `update` rather than `updateMany` + `findFirst`.
    // Prisma's `update` where clause accepts additional (non-unique) filter
    // conditions alongside the primary key; if no row matches all conditions
    // Prisma throws P2025 which we catch and map to a 404.
    try {
        const row = await prisma.apiKey.update({
            where: { id: keyId, userId: authContext.userId!, revokedAt: null },
            data: updateData,
            select: {
                id: true,
                keyPrefix: true,
                name: true,
                scopes: true,
                rateLimitPerMinute: true,
                lastUsedAt: true,
                expiresAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return JsonResponse.success({
            id: row.id,
            keyPrefix: row.keyPrefix,
            name: row.name,
            scopes: row.scopes,
            rateLimitPerMinute: row.rateLimitPerMinute,
            lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
            expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        });
    } catch (e) {
        // P2025 = "An operation failed because it depends on one or more records
        // that were required but not found." — key doesn't exist, belongs to a
        // different user, or is already revoked.
        if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2025') {
            return JsonResponse.notFound('API key not found or already revoked');
        }
        throw e;
    }
}

/**
 * Tests for Saved Configuration Handlers.
 *
 * Covers:
 *   - GET    /api/configuration/saved         (handleListSavedConfigurations)
 *   - POST   /api/configuration/saved         (handleSaveConfiguration)
 *   - DELETE /api/configuration/saved/:id     (handleDeleteSavedConfiguration)
 *
 * Uses an in-memory Prisma mock object (no real database).
 */

import { assertEquals } from '@std/assert';
import { handleDeleteSavedConfiguration, handleListSavedConfigurations, handleSaveConfiguration } from './saved-configurations.ts';
import { UserTier } from '../types.ts';
import type { IAuthContext } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAuthContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user-uuid-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: 'sess_001',
        scopes: ['compile'],
        authMethod: 'better-auth',
        ...overrides,
    };
}

// ============================================================================
// In-memory Prisma mock for saved-configurations handlers
// ============================================================================

interface StoredConfig {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

// deno-lint-ignore no-explicit-any
function createPrismaMock(): any {
    const rows: StoredConfig[] = [
        {
            id: 'cfg-001',
            userId: 'user-uuid-001',
            name: 'My Filter List',
            description: 'A test list',
            config: { name: 'My Filter List', sources: [] },
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
            updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
    ];

    return {
        userConfiguration: {
            async findMany({ where, orderBy, take, select }: {
                where: { userId: string };
                orderBy?: { updatedAt?: string };
                take?: number;
                select?: Record<string, boolean>;
            }) {
                let filtered = rows.filter((r) => r.userId === where.userId);
                if (orderBy?.updatedAt === 'desc') {
                    filtered = filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
                }
                if (take !== undefined) {
                    filtered = filtered.slice(0, take);
                }
                // Return only selected fields if select is provided
                if (select) {
                    return filtered.map((r) => {
                        const out: Record<string, unknown> = {};
                        for (const key of Object.keys(select)) {
                            if (select[key]) out[key] = r[key as keyof StoredConfig];
                        }
                        return out;
                    });
                }
                return filtered;
            },

            async create({ data }: { data: { userId: string; name: string; description?: string | null; config: Record<string, unknown> } }) {
                const now = new Date();
                const row: StoredConfig = {
                    id: `cfg-new-${rows.length + 1}`,
                    userId: data.userId,
                    name: data.name,
                    description: data.description ?? null,
                    config: data.config,
                    createdAt: now,
                    updatedAt: now,
                };
                rows.push(row);
                return row;
            },

            async deleteMany({ where }: { where: { id: string; userId: string } }) {
                const before = rows.length;
                const idx = rows.findIndex((r) => r.id === where.id && r.userId === where.userId);
                if (idx !== -1) rows.splice(idx, 1);
                return { count: rows.length < before ? 1 : 0 };
            },
        },
    };
}

// ============================================================================
// handleListSavedConfigurations
// ============================================================================

Deno.test('handleListSavedConfigurations — returns user configs', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved');

    const response = await handleListSavedConfigurations(request, {}, makeAuthContext(), prisma);

    assertEquals(response.status, 200);
    const body = await response.json() as { success: boolean; configs: unknown[]; total: number };
    assertEquals(body.success, true);
    assertEquals(body.total, 1);
    assertEquals((body.configs as Array<{ id: string }>)[0]?.id, 'cfg-001');
});

Deno.test('handleListSavedConfigurations — 403 when no userId', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved');

    const response = await handleListSavedConfigurations(request, {}, makeAuthContext({ userId: null }), prisma);

    assertEquals(response.status, 403);
});

Deno.test('handleListSavedConfigurations — returns empty list for unknown user', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved');

    const response = await handleListSavedConfigurations(request, {}, makeAuthContext({ userId: 'user-unknown' }), prisma);

    assertEquals(response.status, 200);
    const body = await response.json() as { total: number };
    assertEquals(body.total, 0);
});

Deno.test('handleListSavedConfigurations — returns 503 when prisma is null', async () => {
    const request = new Request('http://localhost/api/configuration/saved');
    const response = await handleListSavedConfigurations(request, {}, makeAuthContext(), null);
    assertEquals(response.status, 503);
});

// ============================================================================
// handleSaveConfiguration
// ============================================================================

Deno.test('handleSaveConfiguration — creates a new config', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });

    const body = {
        name: 'New Config',
        description: 'Created in test',
        config: { name: 'New Config', sources: [] },
    };

    const response = await handleSaveConfiguration(request, {}, makeAuthContext(), prisma, body);

    assertEquals(response.status, 201);
    const result = await response.json() as { success: boolean; id: string; name: string };
    assertEquals(result.success, true);
    assertEquals(result.name, 'New Config');
    assertEquals(typeof result.id, 'string');
});

Deno.test('handleSaveConfiguration — 403 when no userId', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });

    const response = await handleSaveConfiguration(request, {}, makeAuthContext({ userId: null }), prisma, { name: 'Test', config: {} });

    assertEquals(response.status, 403);
});

Deno.test('handleSaveConfiguration — 400 for invalid body', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });

    const response = await handleSaveConfiguration(request, {}, makeAuthContext(), prisma, { name: '' });

    assertEquals(response.status, 400);
});

Deno.test('handleSaveConfiguration — 400 when config is missing', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });

    const response = await handleSaveConfiguration(request, {}, makeAuthContext(), prisma, { name: 'ok' });

    assertEquals(response.status, 400);
});

Deno.test('handleSaveConfiguration — optional description defaults to null', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });
    const body = { name: 'No Desc', config: { name: 'No Desc', sources: [] } };

    const response = await handleSaveConfiguration(request, {}, makeAuthContext(), prisma, body);

    assertEquals(response.status, 201);
    const result = await response.json() as { description: string | null };
    assertEquals(result.description, null);
});

Deno.test('handleSaveConfiguration — returns 503 when prisma is null', async () => {
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });
    const response = await handleSaveConfiguration(request, {}, makeAuthContext(), null, { name: 'Test', config: {} });
    assertEquals(response.status, 503);
});

// ============================================================================
// handleDeleteSavedConfiguration
// ============================================================================

Deno.test('handleDeleteSavedConfiguration — deletes owned config', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved/cfg-001', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, makeAuthContext(), prisma, 'cfg-001');

    assertEquals(response.status, 204);
});

Deno.test('handleDeleteSavedConfiguration — 403 when no userId', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved/cfg-001', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, makeAuthContext({ userId: null }), prisma, 'cfg-001');

    assertEquals(response.status, 403);
});

Deno.test('handleDeleteSavedConfiguration — 404 for non-existent config', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved/cfg-not-found', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, makeAuthContext(), prisma, 'cfg-not-found');

    assertEquals(response.status, 404);
});

Deno.test('handleDeleteSavedConfiguration — 404 when config belongs to different user', async () => {
    const prisma = createPrismaMock();
    const request = new Request('http://localhost/api/configuration/saved/cfg-001', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, makeAuthContext({ userId: 'user-other' }), prisma, 'cfg-001');

    assertEquals(response.status, 404);
});

Deno.test('handleDeleteSavedConfiguration — returns 503 when prisma is null', async () => {
    const request = new Request('http://localhost/api/configuration/saved/cfg-001', { method: 'DELETE' });
    const response = await handleDeleteSavedConfiguration(request, {}, makeAuthContext(), null, 'cfg-001');
    assertEquals(response.status, 503);
});

/**
 * Tests for Saved Configuration Handlers.
 *
 * Covers:
 *   - GET    /api/configuration/saved         (handleListSavedConfigurations)
 *   - POST   /api/configuration/saved         (handleSaveConfiguration)
 *   - DELETE /api/configuration/saved/:id     (handleDeleteSavedConfiguration)
 *
 * Uses in-memory PgPool mock (same pattern as api-keys.test.ts).
 */

import { assertEquals } from '@std/assert';
import { handleDeleteSavedConfiguration, handleListSavedConfigurations, handleSaveConfiguration } from './saved-configurations.ts';
import { UserTier } from '../types.ts';
import type { IAuthContext } from '../types.ts';
import type { PgPool } from '../utils/pg-pool.ts';

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
// In-memory PgPool mock for saved-configurations handlers
// ============================================================================

interface UserConfigRow {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    config: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

function createInMemoryPool(): PgPool {
    const rows: UserConfigRow[] = [
        {
            id: 'cfg-001',
            user_id: 'user-uuid-001',
            name: 'My Filter List',
            description: 'A test list',
            config: { name: 'My Filter List', sources: [] },
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-01T00:00:00.000Z',
        },
    ];

    return {
        async query<T>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
            // SELECT — list
            if (/SELECT[\s\S]*FROM user_configurations[\s\S]*WHERE user_id/.test(text)) {
                const userId = values?.[0] as string;
                const filtered = rows.filter((r) => r.user_id === userId);
                // Return metadata-only columns (no config)
                const result = filtered.map((r) => ({
                    id: r.id,
                    user_id: r.user_id,
                    name: r.name,
                    description: r.description,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                }));
                return { rows: result as T[], rowCount: result.length };
            }

            // INSERT
            if (/INSERT INTO user_configurations/.test(text)) {
                const [userId, name, description, configJson] = values as [string, string, string | null, string];
                const newRow: UserConfigRow = {
                    id: 'cfg-new-001',
                    user_id: userId,
                    name,
                    description,
                    config: JSON.parse(configJson) as Record<string, unknown>,
                    created_at: '2025-06-01T00:00:00.000Z',
                    updated_at: '2025-06-01T00:00:00.000Z',
                };
                rows.push(newRow);
                return { rows: [newRow as unknown as T], rowCount: 1 };
            }

            // DELETE
            if (/DELETE FROM user_configurations/.test(text)) {
                const [id, userId] = values as [string, string];
                const before = rows.length;
                const idx = rows.findIndex((r) => r.id === id && r.user_id === userId);
                if (idx !== -1) rows.splice(idx, 1);
                const deleted = rows.length < before ? 1 : 0;
                return { rows: [] as T[], rowCount: deleted };
            }

            return { rows: [] as T[], rowCount: 0 };
        },
    };
}

// ============================================================================
// handleListSavedConfigurations
// ============================================================================

Deno.test('handleListSavedConfigurations — returns user configs', async () => {
    const auth = makeAuthContext();
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved');

    const response = await handleListSavedConfigurations(request, {}, auth, pool);

    assertEquals(response.status, 200);
    const body = await response.json() as { success: boolean; configs: unknown[]; total: number };
    assertEquals(body.success, true);
    assertEquals(body.total, 1);
    assertEquals((body.configs as Array<{ id: string }>)[0]?.id, 'cfg-001');
});

Deno.test('handleListSavedConfigurations — 403 when no userId', async () => {
    const auth = makeAuthContext({ userId: null });
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved');

    const response = await handleListSavedConfigurations(request, {}, auth, pool);

    assertEquals(response.status, 403);
});

Deno.test('handleListSavedConfigurations — returns empty list for unknown user', async () => {
    const auth = makeAuthContext({ userId: 'user-unknown' });
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved');

    const response = await handleListSavedConfigurations(request, {}, auth, pool);

    assertEquals(response.status, 200);
    const body = await response.json() as { total: number };
    assertEquals(body.total, 0);
});

// ============================================================================
// handleSaveConfiguration
// ============================================================================

Deno.test('handleSaveConfiguration — creates a new config', async () => {
    const auth = makeAuthContext();
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });

    const body = {
        name: 'New Config',
        description: 'Created in test',
        config: { name: 'New Config', sources: [] },
    };

    const response = await handleSaveConfiguration(request, {}, auth, pool, body);

    assertEquals(response.status, 201);
    const result = await response.json() as { success: boolean; id: string; name: string };
    assertEquals(result.success, true);
    assertEquals(result.name, 'New Config');
    assertEquals(typeof result.id, 'string');
});

Deno.test('handleSaveConfiguration — 403 when no userId', async () => {
    const auth = makeAuthContext({ userId: null });
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });
    const body = { name: 'Test', config: {} };

    const response = await handleSaveConfiguration(request, {}, auth, pool, body);

    assertEquals(response.status, 403);
});

Deno.test('handleSaveConfiguration — 400 for invalid body', async () => {
    const auth = makeAuthContext();
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });

    const response = await handleSaveConfiguration(request, {}, auth, pool, { name: '' });

    assertEquals(response.status, 400);
});

Deno.test('handleSaveConfiguration — 400 when config is missing', async () => {
    const auth = makeAuthContext();
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });

    const response = await handleSaveConfiguration(request, {}, auth, pool, { name: 'ok' });

    assertEquals(response.status, 400);
});

Deno.test('handleSaveConfiguration — optional description defaults to null', async () => {
    const auth = makeAuthContext();
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved', { method: 'POST' });
    const body = { name: 'No Desc', config: { name: 'No Desc', sources: [] } };

    const response = await handleSaveConfiguration(request, {}, auth, pool, body);

    assertEquals(response.status, 201);
    const result = await response.json() as { description: string | null };
    assertEquals(result.description, null);
});

// ============================================================================
// handleDeleteSavedConfiguration
// ============================================================================

Deno.test('handleDeleteSavedConfiguration — deletes owned config', async () => {
    const auth = makeAuthContext();
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved/cfg-001', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, auth, pool, 'cfg-001');

    assertEquals(response.status, 204);
});

Deno.test('handleDeleteSavedConfiguration — 403 when no userId', async () => {
    const auth = makeAuthContext({ userId: null });
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved/cfg-001', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, auth, pool, 'cfg-001');

    assertEquals(response.status, 403);
});

Deno.test('handleDeleteSavedConfiguration — 404 for non-existent config', async () => {
    const auth = makeAuthContext();
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved/cfg-not-found', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, auth, pool, 'cfg-not-found');

    assertEquals(response.status, 404);
});

Deno.test('handleDeleteSavedConfiguration — 404 when config belongs to different user', async () => {
    const auth = makeAuthContext({ userId: 'user-other' });
    const pool = createInMemoryPool();
    const request = new Request('http://localhost/api/configuration/saved/cfg-001', { method: 'DELETE' });

    const response = await handleDeleteSavedConfiguration(request, {}, auth, pool, 'cfg-001');

    assertEquals(response.status, 404);
});

/**
 * D1 Cache Sync Utilities
 *
 * Write-through and lazy cache synchronisation from Neon (L2 source of truth)
 * to D1 (L1 edge read-replica).  Every function accepts a Prisma client that
 * has been created via `worker/lib/prisma-d1.ts` (`createD1PrismaClient`).
 *
 * Design principles:
 *   - Cache misses are never fatal – callers fall through to L2.
 *   - All writes are idempotent (upsert semantics).
 *   - Batch operations use Prisma interactive transactions.
 *   - An optional logger (compatible with `IDetailedLogger`) surfaces
 *     diagnostics without coupling to a concrete implementation.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tables that can be synced from Neon → D1. */
const SyncTableSchema = z.enum([
    'storageEntry',
    'filterCache',
    'compilationMetadata',
    'sourceSnapshot',
    'sourceHealth',
    'sourceAttempt',
    'user',
]);

export type SyncTable = z.infer<typeof SyncTableSchema>;

/** Zod schema for the sync configuration object. */
export const D1CacheSyncConfigSchema = z.object({
    /** Tables to sync from Neon → D1 */
    syncTables: z.array(SyncTableSchema).default([
        'filterCache',
        'compilationMetadata',
        'user',
    ]),
    /** Max age in seconds before a D1 cached record is considered stale. */
    maxAge: z.number().int().nonnegative().default(300), // 5 minutes
    /** Whether to sync on write (write-through) or on read (lazy). */
    strategy: z.enum(['write-through', 'lazy']).default('write-through'),
});

export type D1CacheSyncConfig = z.infer<typeof D1CacheSyncConfigSchema>;

// ---------------------------------------------------------------------------
// Logger interface (mirrors project convention – all methods optional)
// ---------------------------------------------------------------------------

export interface ICacheSyncLogger {
    debug?(message: string): void;
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
}

/** A no-op logger used when the caller does not provide one. */
const NOOP_LOGGER: ICacheSyncLogger = {};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal contract for a D1-backed Prisma client.
 *
 * We intentionally keep this loose (`any`) so the module stays decoupled
 * from a specific generated client.  In practice the caller passes the
 * client returned by `createD1PrismaClient()`.
 */
// deno-lint-ignore no-explicit-any
export type D1PrismaClient = any;

/** Result of a sync / invalidate operation. */
export interface CacheSyncResult {
    success: boolean;
    table: string;
    id: string;
    error?: string;
}

/** Result of a batch sync operation. */
export interface BatchSyncResult {
    success: boolean;
    table: string;
    total: number;
    synced: number;
    failed: number;
    errors: string[];
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Write a single record to D1 cache (upsert).
 *
 * Uses `prisma.<table>.upsert` so the call is idempotent: it creates the
 * record if it does not exist, or updates it if it does.
 */
export async function syncRecord(
    table: SyncTable,
    id: string,
    data: Record<string, unknown>,
    d1Prisma: D1PrismaClient,
    logger: ICacheSyncLogger = NOOP_LOGGER,
): Promise<CacheSyncResult> {
    try {
        const delegate = d1Prisma[table];
        if (!delegate) {
            throw new Error(`Unknown table "${table}" on D1 Prisma client`);
        }

        // Build the update & create payloads from the provided data, always
        // including the id so the record can be uniquely identified.
        const createPayload = { ...data, id };
        const updatePayload = { ...data };

        await delegate.upsert({
            where: { id },
            update: updatePayload,
            create: createPayload,
        });

        logger.debug?.(`[d1-cache-sync] synced ${table}/${id}`);
        return { success: true, table, id };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error?.(`[d1-cache-sync] syncRecord failed for ${table}/${id}: ${message}`);
        return { success: false, table, id, error: message };
    }
}

/**
 * Remove a stale record from D1 cache.
 *
 * Returns success even if the record did not exist (idempotent delete).
 */
export async function invalidateRecord(
    table: SyncTable,
    id: string,
    d1Prisma: D1PrismaClient,
    logger: ICacheSyncLogger = NOOP_LOGGER,
): Promise<CacheSyncResult> {
    try {
        const delegate = d1Prisma[table];
        if (!delegate) {
            throw new Error(`Unknown table "${table}" on D1 Prisma client`);
        }

        await delegate.delete({ where: { id } }).catch((err: unknown) => {
            // Prisma throws P2025 (record not found) when deleting a
            // non-existent row.  That is perfectly fine for cache invalidation.
            const code = (err as { code?: string })?.code;
            if (code === 'P2025') {
                logger.debug?.(`[d1-cache-sync] ${table}/${id} already absent – nothing to invalidate`);
                return;
            }
            throw err;
        });

        logger.debug?.(`[d1-cache-sync] invalidated ${table}/${id}`);
        return { success: true, table, id };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error?.(`[d1-cache-sync] invalidateRecord failed for ${table}/${id}: ${message}`);
        return { success: false, table, id, error: message };
    }
}

/**
 * Check whether a D1 cached record is older than `maxAge` seconds.
 *
 * Looks up the record's `updatedAt` (preferred) or `createdAt` field and
 * compares it to `Date.now()`.  Returns `true` when the record is stale or
 * missing (a cache miss is always "stale").
 */
export async function isCacheStale(
    table: SyncTable,
    id: string,
    d1Prisma: D1PrismaClient,
    maxAge: number,
    logger: ICacheSyncLogger = NOOP_LOGGER,
): Promise<boolean> {
    try {
        const delegate = d1Prisma[table];
        if (!delegate) {
            throw new Error(`Unknown table "${table}" on D1 Prisma client`);
        }

        const record = await delegate.findUnique({
            where: { id },
            select: { updatedAt: true, createdAt: true },
        });

        if (!record) {
            logger.debug?.(`[d1-cache-sync] ${table}/${id} not in D1 – treating as stale`);
            return true;
        }

        const timestamp = record.updatedAt ?? record.createdAt;
        if (!timestamp) {
            // No timestamp field on this model — treat as stale to be safe.
            logger.warn?.(`[d1-cache-sync] ${table}/${id} has no timestamp field – treating as stale`);
            return true;
        }

        const ageMs = Date.now() - new Date(timestamp).getTime();
        const stale = ageMs > maxAge * 1_000;

        logger.debug?.(
            `[d1-cache-sync] ${table}/${id} age=${Math.round(ageMs / 1_000)}s maxAge=${maxAge}s stale=${stale}`,
        );
        return stale;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn?.(`[d1-cache-sync] isCacheStale check failed for ${table}/${id}: ${message}`);
        // On error, assume stale so the caller re-fetches from L2.
        return true;
    }
}

/**
 * Batch-write multiple records to D1 using a Prisma interactive transaction.
 *
 * Each record is upserted inside a single transaction so either all succeed
 * or none do.  If the transaction fails, individual records are retried
 * outside the transaction so partial progress is still possible.
 */
export async function syncBatch(
    table: SyncTable,
    records: Array<{ id: string; data: Record<string, unknown> }>,
    d1Prisma: D1PrismaClient,
    logger: ICacheSyncLogger = NOOP_LOGGER,
): Promise<BatchSyncResult> {
    if (records.length === 0) {
        return { success: true, table, total: 0, synced: 0, failed: 0, errors: [] };
    }

    const errors: string[] = [];
    let synced = 0;

    try {
        // Attempt a single transaction for the entire batch.
        await d1Prisma.$transaction(async (tx: D1PrismaClient) => {
            const delegate = tx[table];
            if (!delegate) {
                throw new Error(`Unknown table "${table}" on D1 Prisma client`);
            }

            for (const { id, data } of records) {
                await delegate.upsert({
                    where: { id },
                    update: { ...data },
                    create: { ...data, id },
                });
                synced++;
            }
        });

        logger.info?.(
            `[d1-cache-sync] batch synced ${synced}/${records.length} records to ${table}`,
        );

        return { success: true, table, total: records.length, synced, failed: 0, errors };
    } catch (txErr: unknown) {
        // Transaction failed — fall back to individual upserts.
        const txMessage = txErr instanceof Error ? txErr.message : String(txErr);
        logger.warn?.(
            `[d1-cache-sync] batch transaction failed for ${table}: ${txMessage} – retrying individually`,
        );

        synced = 0;
        for (const { id, data } of records) {
            const result = await syncRecord(table, id, data, d1Prisma, logger);
            if (result.success) {
                synced++;
            } else {
                errors.push(result.error ?? `Unknown error for ${id}`);
            }
        }

        const failed = records.length - synced;
        const success = failed === 0;

        logger.info?.(
            `[d1-cache-sync] batch individual fallback: ${synced}/${records.length} synced, ${failed} failed`,
        );

        return { success, table, total: records.length, synced, failed, errors };
    }
}

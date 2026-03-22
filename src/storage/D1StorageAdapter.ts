/**
 * Cloudflare D1 Storage Adapter (Prisma ORM)
 *
 * {@link IStorageAdapter} implementation backed by Cloudflare D1 using Prisma
 * ORM with the {@link https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1 | @prisma/adapter-d1}
 * driver adapter.
 *
 * ## Architecture
 *
 * ```
 * D1StorageAdapter -> PrismaClient -> PrismaD1 adapter -> Cloudflare D1 (SQLite)
 * ```
 *
 * All CRUD operations use Prisma's type-safe query builder against the D1
 * schema defined in `prisma/schema.d1.prisma`. A raw `D1Database` binding is
 * kept for D1-specific operations (`dump()`, `batch()`) that have no Prisma
 * equivalent.
 *
 * ## Usage
 *
 * ```typescript
 * import { createD1Storage } from './D1StorageAdapter.ts';
 *
 * export default {
 *     async fetch(request: Request, env: Env) {
 *         const storage = createD1Storage(env);
 *         await storage.open();
 *         const entry = await storage.get<string>(['cache', 'key']);
 *         return new Response(JSON.stringify(entry));
 *     },
 * };
 * ```
 *
 * @module D1StorageAdapter
 */

import type { IStorageAdapter } from './IStorageAdapter.ts';
import type {
    CacheEntry,
    CompilationMetadata,
    QueryOptions,
    StorageEntry,
    StorageStats,
} from './types.ts';
import { PrismaClient } from '../../prisma/generated-d1/client.ts';
import { PrismaD1 } from '@prisma/adapter-d1';

// =============================================================================
// D1 type interfaces
// =============================================================================
// Minimal D1 bindings matching @cloudflare/workers-types.
// Kept here to avoid a hard dependency on @cloudflare/workers-types at the
// src/ layer. Only used for D1-specific methods (dump, batch, raw exec).

/** Minimal Cloudflare D1 prepared-statement interface. */
interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run<T = unknown>(): Promise<D1Result<T>>;
    all<T = unknown>(): Promise<D1Result<T>>;
    raw<T = unknown>(): Promise<T[]>;
}

/** Result from a D1 run/all/first operation. */
interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta: {
        duration: number;
        changes: number;
        last_row_id: number;
        served_by?: string;
    };
}

/** Result from a D1 `exec()` operation. */
interface D1ExecResult {
    count: number;
    duration: number;
}

/** Minimal Cloudflare D1 database binding interface. */
interface D1Database {
    prepare(query: string): D1PreparedStatement;
    dump(): Promise<ArrayBuffer>;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for the D1 storage adapter.
 *
 * **Note:** The legacy `tablePrefix` option is no longer supported -- Prisma
 * manages table names via `@@map()` directives in `schema.d1.prisma`.
 */
export interface D1StorageConfig {
    /** Default TTL for cache entries in milliseconds (default: 3 600 000 = 1 h). */
    defaultTtlMs?: number;
    /** Enable verbose query logging via the adapter's logger. */
    enableLogging?: boolean;
}

/** Optional structured logger accepted by the adapter. */
export interface ID1Logger {
    debug?(message: string): void;
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Serialises a multi-segment key into a single `/`-delimited path string.
 *
 * @param key - Array of path segments (e.g. `['cache', 'filters', 'easylist']`)
 * @returns Joined string (e.g. `'cache/filters/easylist'`)
 */
function serializeKey(key: string[]): string {
    return key.join('/');
}

// =============================================================================
// D1 Storage Adapter
// =============================================================================

/**
 * Cloudflare D1 storage adapter using Prisma ORM.
 *
 * Replaces raw D1 SQL with Prisma's type-safe query builder while retaining
 * the raw `D1Database` binding for D1-specific operations (dump, batch, raw
 * query).
 *
 * Implements the full {@link IStorageAdapter} contract:
 *
 * | Method                    | Prisma model            |
 * | ------------------------- | ----------------------- |
 * | `set / get / delete`      | `storageEntry`          |
 * | `list`                    | `storageEntry.findMany` |
 * | `cacheFilterList`         | `filterCache`           |
 * | `getCachedFilterList`     | `filterCache`           |
 * | `storeCompilationMetadata`| `compilationMetadata`   |
 * | `getCompilationHistory`   | `compilationMetadata`   |
 * | `clearExpired / clearCache`| both tables            |
 * | `getStats`                | `storageEntry` (+ raw)  |
 */
export class D1StorageAdapter implements IStorageAdapter {
    /** Prisma client bound to Cloudflare D1. */
    private readonly prisma: InstanceType<typeof PrismaClient>;
    /** Raw D1 binding for dump / batch / exec operations. */
    private readonly d1: D1Database;
    /** Normalised configuration with defaults applied. */
    private readonly config: Required<Pick<D1StorageConfig, 'defaultTtlMs' | 'enableLogging'>>;
    /** Optional structured logger. */
    private readonly logger?: ID1Logger;
    /** Open/closed lifecycle flag. */
    private _isOpen = false;

    /**
     * Creates a new D1StorageAdapter.
     *
     * A PrismaClient is instantiated immediately using the supplied D1 binding.
     * Call {@link open} before issuing any queries.
     *
     * @param db     - Cloudflare D1 database binding (typically `env.DB`)
     * @param config - Optional adapter configuration
     * @param logger - Optional structured logger
     */
    constructor(db: D1Database, config?: D1StorageConfig, logger?: ID1Logger) {
        this.d1 = db;
        this.config = {
            defaultTtlMs: config?.defaultTtlMs ?? 3_600_000,
            enableLogging: config?.enableLogging ?? false,
        };
        this.logger = logger;

        // Create PrismaClient with D1 adapter.
        // deno-lint-ignore no-explicit-any
        const adapter = new PrismaD1(db as any);
        this.prisma = new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
    }

    // =========================================================================
    // Internal utilities
    // =========================================================================

    /**
     * Emits a log message through the adapter's logger.
     *
     * @param level   - Severity level
     * @param message - Human-readable log line
     */
    private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
        if (!this.config.enableLogging && level === 'debug') return;
        this.logger?.[level]?.(message);
    }

    /**
     * Guards against use of the adapter before {@link open} is called.
     *
     * @throws {Error} If the adapter has not been opened
     */
    private ensureOpen(): void {
        if (!this._isOpen) {
            throw new Error('D1StorageAdapter is not open. Call open() first.');
        }
    }

    /**
     * Computes the expiry `Date` for a given TTL.
     *
     * Falls back to {@link D1StorageConfig.defaultTtlMs} when no explicit TTL
     * is provided. Returns `null` when both the explicit TTL and the default
     * are zero / undefined.
     *
     * @param ttlMs - Explicit TTL in milliseconds (overrides default)
     * @returns Absolute expiry `Date`, or `null` for no expiry
     */
    private computeExpiry(ttlMs?: number): Date | null {
        const ttl = ttlMs ?? this.config.defaultTtlMs;
        if (!ttl || ttl <= 0) return null;
        return new Date(Date.now() + ttl);
    }

    // =========================================================================
    // Lifecycle (IStorageAdapter)
    // =========================================================================

    /**
     * Opens the adapter for use.
     *
     * D1 bindings are always available within a Cloudflare Worker request, so
     * this method simply marks the adapter as open without a network round-trip.
     */
    async open(): Promise<void> {
        if (this._isOpen) return;
        this._isOpen = true;
        this.log('debug', 'D1 storage adapter opened');
    }

    /**
     * Closes the adapter and disconnects the Prisma client.
     *
     * Safe to call multiple times -- subsequent calls are no-ops.
     */
    async close(): Promise<void> {
        if (!this._isOpen) return;
        try {
            await this.prisma.$disconnect();
        } catch {
            // Swallow disconnect errors -- D1 bindings don't truly disconnect.
        }
        this._isOpen = false;
        this.log('debug', 'D1 storage adapter closed');
    }

    /**
     * Returns whether the adapter is open and ready for queries.
     *
     * @returns `true` after {@link open} and before {@link close}
     */
    isOpen(): boolean {
        return this._isOpen;
    }

    // =========================================================================
    // Key-value CRUD (IStorageAdapter)
    // =========================================================================

    /**
     * Stores a value under the given key with optional TTL.
     *
     * Uses Prisma `upsert` so existing entries are updated in-place (the
     * original CUID is preserved).
     *
     * @typeParam T - Serialisable value type
     * @param key   - Multi-segment storage key
     * @param value - Value to store (JSON-serialised internally)
     * @param ttlMs - Optional TTL override in milliseconds
     * @returns `true` on success, `false` on failure
     */
    async set<T>(key: string[], value: T, ttlMs?: number): Promise<boolean> {
        this.ensureOpen();
        try {
            const serializedKey = serializeKey(key);
            const expiresAt = this.computeExpiry(ttlMs);
            const data = JSON.stringify(value);

            await this.prisma.storageEntry.upsert({
                where: { key: serializedKey },
                update: {
                    data,
                    expiresAt,
                },
                create: {
                    key: serializedKey,
                    data,
                    expiresAt,
                },
            });

            this.log('debug', 'SET ' + serializedKey);
            return true;
        } catch (error) {
            this.log('error', 'Failed to set key [' + key.join('/') + ']: ' + (error instanceof Error ? error.message : String(error)));
            return false;
        }
    }

    /**
     * Retrieves a value by key.
     *
     * Returns `null` when the key does not exist **or** when its entry has
     * expired. Expired entries are lazily deleted on access.
     *
     * @typeParam T - Expected deserialised value type
     * @param key - Multi-segment storage key
     * @returns A {@link StorageEntry} containing the deserialised value, or `null`
     */
    async get<T>(key: string[]): Promise<StorageEntry<T> | null> {
        this.ensureOpen();
        try {
            const serializedKey = serializeKey(key);

            const entry = await this.prisma.storageEntry.findUnique({
                where: { key: serializedKey },
            });

            if (!entry) return null;

            // Lazy expiry: if the entry has expired, delete it and return null.
            if (entry.expiresAt && entry.expiresAt < new Date()) {
                await this.prisma.storageEntry.delete({
                    where: { key: serializedKey },
                }).catch(() => {
                    // Ignore deletion errors -- entry may have been concurrently removed.
                });
                this.log('debug', 'GET ' + serializedKey + ' -- expired, deleted');
                return null;
            }

            this.log('debug', 'GET ' + serializedKey);
            return {
                data: JSON.parse(entry.data) as T,
                createdAt: entry.createdAt.getTime(),
                updatedAt: entry.updatedAt.getTime(),
                expiresAt: entry.expiresAt?.getTime(),
                tags: entry.tags ? JSON.parse(entry.tags) as string[] : undefined,
            };
        } catch (error) {
            this.log('error', 'Failed to get key [' + key.join('/') + ']: ' + (error instanceof Error ? error.message : String(error)));
            return null;
        }
    }

    /**
     * Deletes a value by key.
     *
     * @param key - Multi-segment storage key
     * @returns `true` if an entry was deleted, `false` otherwise
     */
    async delete(key: string[]): Promise<boolean> {
        this.ensureOpen();
        try {
            const serializedKey = serializeKey(key);

            const result = await this.prisma.storageEntry.deleteMany({
                where: { key: serializedKey },
            });

            this.log('debug', 'DELETE ' + serializedKey + ' -- ' + result.count + ' removed');
            return result.count > 0;
        } catch (error) {
            this.log('error', 'Failed to delete key [' + key.join('/') + ']: ' + (error instanceof Error ? error.message : String(error)));
            return false;
        }
    }

    /**
     * Lists storage entries matching optional query criteria.
     *
     * Non-expired entries are returned ordered by key. Expired entries are
     * automatically excluded from results (but not deleted -- use
     * {@link clearExpired} for that).
     *
     * @typeParam T - Expected deserialised value type
     * @param options - Filtering/pagination options (prefix, limit, reverse)
     * @returns Array of matching {@link StorageEntry} objects
     */
    async list<T>(options?: QueryOptions): Promise<Array<{ key: string[]; value: StorageEntry<T> }>> {
        this.ensureOpen();
        try {
            const now = new Date();

            // Build the where clause.
            // deno-lint-ignore no-explicit-any
            const where: any = {
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } },
                ],
            };

            if (options?.prefix) {
                where.key = { startsWith: serializeKey(options.prefix) + '/' };
            }

            const entries = await this.prisma.storageEntry.findMany({
                where,
                orderBy: { key: options?.reverse ? 'desc' : 'asc' },
                ...(options?.limit != null && { take: options.limit }),
            });

            this.log('debug', 'LIST -- ' + entries.length + ' entries');
            return entries.map((entry) => ({
                key: entry.key.split('/'),
                value: {
                    data: JSON.parse(entry.data) as T,
                    createdAt: entry.createdAt.getTime(),
                    updatedAt: entry.updatedAt.getTime(),
                    expiresAt: entry.expiresAt?.getTime(),
                    tags: entry.tags ? JSON.parse(entry.tags) as string[] : undefined,
                },
            }));
        } catch (error) {
            this.log('error', 'Failed to list entries: ' + (error instanceof Error ? error.message : String(error)));
            return [];
        }
    }

    // =========================================================================
    // Expiry & statistics (IStorageAdapter)
    // =========================================================================

    /**
     * Deletes all expired entries from both `storage_entries` and `filter_cache`.
     *
     * @returns Number of rows removed across both tables
     */
    async clearExpired(): Promise<number> {
        this.ensureOpen();
        try {
            const now = new Date();

            const [storageResult, cacheResult] = await this.prisma.$transaction([
                this.prisma.storageEntry.deleteMany({
                    where: { expiresAt: { lt: now } },
                }),
                this.prisma.filterCache.deleteMany({
                    where: { expiresAt: { lt: now } },
                }),
            ]);

            const total = storageResult.count + cacheResult.count;
            this.log('debug', 'clearExpired -- ' + total + ' removed');
            return total;
        } catch (error) {
            this.log('error', 'Failed to clear expired entries: ' + (error instanceof Error ? error.message : String(error)));
            return 0;
        }
    }

    /**
     * Returns aggregate statistics for the storage layer.
     *
     * Runs three queries in parallel:
     * 1. Total entry count
     * 2. Expired (but not yet deleted) entry count
     * 3. Estimated storage size via `SUM(LENGTH(data))` (raw SQL -- no Prisma
     *    equivalent for `LENGTH` aggregation)
     *
     * @returns A {@link StorageStats} snapshot
     */
    async getStats(): Promise<StorageStats> {
        this.ensureOpen();
        try {
            const now = new Date();

            const [entryCount, expiredCount, sizeResult] = await Promise.all([
                this.prisma.storageEntry.count(),
                this.prisma.storageEntry.count({
                    where: { expiresAt: { lt: now } },
                }),
                // Raw SQL for SUM(LENGTH(data)) -- Prisma cannot aggregate string lengths.
                // deno-lint-ignore no-explicit-any
                this.prisma.$queryRawUnsafe('SELECT SUM(LENGTH(data)) as size FROM storage_entries') as Promise<any>,
            ]);

            return {
                entryCount,
                expiredCount,
                // queryRawUnsafe returns an array of row objects.
                sizeEstimate: Number(sizeResult?.[0]?.size ?? 0),
            };
        } catch (error) {
            this.log('error', 'Failed to get stats: ' + (error instanceof Error ? error.message : String(error)));
            return { entryCount: 0, expiredCount: 0, sizeEstimate: 0 };
        }
    }

    // =========================================================================
    // Filter-list cache (IStorageAdapter)
    // =========================================================================

    /**
     * Stores (or replaces) a cached filter list by source URL.
     *
     * Uses Prisma `upsert` so the original row ID is preserved on update.
     *
     * @param source  - Canonical source URL (unique key)
     * @param content - Array of filter rules
     * @param hash    - Content hash for integrity verification
     * @param etag    - Optional ETag from the upstream HTTP response
     * @param ttlMs   - Optional TTL override in milliseconds
     * @returns `true` on success, `false` on failure
     */
    async cacheFilterList(
        source: string,
        content: string[],
        hash: string,
        etag?: string,
        ttlMs?: number,
    ): Promise<boolean> {
        this.ensureOpen();
        try {
            const expiresAt = this.computeExpiry(ttlMs);
            const data = JSON.stringify(content);

            await this.prisma.filterCache.upsert({
                where: { source },
                update: {
                    content: data,
                    hash,
                    etag: etag ?? null,
                    expiresAt,
                },
                create: {
                    source,
                    content: data,
                    hash,
                    etag: etag ?? null,
                    expiresAt,
                },
            });

            this.log('debug', 'cacheFilterList ' + source);
            return true;
        } catch (error) {
            this.log('error', 'Failed to cache filter list [' + source + ']: ' + (error instanceof Error ? error.message : String(error)));
            return false;
        }
    }

    /**
     * Retrieves a cached filter list by source URL.
     *
     * Returns `null` when no cache entry exists or when the entry has expired.
     * Expired entries are lazily deleted on access.
     *
     * @param source - Canonical source URL (unique key)
     * @returns A {@link CacheEntry} or `null`
     */
    async getCachedFilterList(source: string): Promise<CacheEntry | null> {
        this.ensureOpen();
        try {
            const entry = await this.prisma.filterCache.findUnique({
                where: { source },
            });

            if (!entry) return null;

            // Lazy expiry.
            if (entry.expiresAt && entry.expiresAt < new Date()) {
                await this.prisma.filterCache.delete({
                    where: { source },
                }).catch(() => {
                    // Ignore -- may have been concurrently removed.
                });
                this.log('debug', 'getCachedFilterList ' + source + ' -- expired, deleted');
                return null;
            }

            this.log('debug', 'getCachedFilterList ' + source);
            return {
                source: entry.source,
                content: JSON.parse(entry.content) as string[],
                hash: entry.hash,
                etag: entry.etag ?? undefined,
            };
        } catch (error) {
            this.log('error', 'Failed to get cached filter list [' + source + ']: ' + (error instanceof Error ? error.message : String(error)));
            return null;
        }
    }

    // =========================================================================
    // Compilation metadata (IStorageAdapter)
    // =========================================================================

    /**
     * Records metadata for a compilation run.
     *
     * @param metadata - Compilation metadata to store
     * @returns `true` on success, `false` on failure
     */
    async storeCompilationMetadata(metadata: CompilationMetadata): Promise<boolean> {
        this.ensureOpen();
        try {
            await this.prisma.compilationMetadata.create({
                data: {
                    configName: metadata.configName,
                    sourceCount: metadata.sourceCount,
                    ruleCount: metadata.ruleCount,
                    duration: metadata.duration,
                    outputPath: metadata.outputPath ?? null,
                },
            });

            this.log('debug', 'storeCompilationMetadata ' + metadata.configName);
            return true;
        } catch (error) {
            this.log('error', 'Failed to store compilation metadata: ' + (error instanceof Error ? error.message : String(error)));
            return false;
        }
    }

    /**
     * Retrieves the most recent compilation runs for a given config name.
     *
     * Results are ordered by timestamp descending (most recent first).
     *
     * @param configName - Compilation config name
     * @param limit      - Maximum number of records (default: 10)
     * @returns Array of {@link CompilationMetadata} records
     */
    async getCompilationHistory(
        configName: string,
        limit = 10,
    ): Promise<CompilationMetadata[]> {
        this.ensureOpen();
        try {
            const entries = await this.prisma.compilationMetadata.findMany({
                where: { configName },
                orderBy: { timestamp: 'desc' },
                take: limit,
            });

            this.log('debug', 'getCompilationHistory ' + configName + ' -- ' + entries.length + ' records');
            return entries.map((entry) => ({
                configName: entry.configName,
                timestamp: entry.timestamp.getTime(),
                sourceCount: entry.sourceCount,
                ruleCount: entry.ruleCount,
                duration: entry.duration,
                outputPath: entry.outputPath ?? undefined,
            }));
        } catch (error) {
            this.log('error', 'Failed to get compilation history [' + configName + ']: ' + (error instanceof Error ? error.message : String(error)));
            return [];
        }
    }

    // =========================================================================
    // Cache management (IStorageAdapter)
    // =========================================================================

    /**
     * Clears all cached data from both `storage_entries` (keys prefixed with
     * `cache/`) and the entire `filter_cache` table.
     *
     * Runs both deletes inside a Prisma `$transaction` for atomicity.
     *
     * @returns Total number of rows deleted
     */
    async clearCache(): Promise<number> {
        this.ensureOpen();
        try {
            const [storageResult, cacheResult] = await this.prisma.$transaction([
                this.prisma.storageEntry.deleteMany({
                    where: { key: { startsWith: 'cache/' } },
                }),
                this.prisma.filterCache.deleteMany(),
            ]);

            const total = storageResult.count + cacheResult.count;
            this.log('debug', 'clearCache -- ' + total + ' removed');
            return total;
        } catch (error) {
            this.log('error', 'Failed to clear cache: ' + (error instanceof Error ? error.message : String(error)));
            return 0;
        }
    }

    // =========================================================================
    // D1-specific operations (not part of IStorageAdapter)
    // =========================================================================

    /**
     * Executes an arbitrary SQL query against D1.
     *
     * **Caution:** This bypasses Prisma and talks directly to D1. Use only
     * for queries that cannot be expressed via the Prisma query builder.
     *
     * @typeParam T - Expected row type
     * @param sql    - SQL statement string
     * @param params - Positional bind parameters
     * @returns Array of result rows
     */
    async rawQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        this.ensureOpen();
        try {
            const stmt = this.d1.prepare(sql);
            const bound = params.length > 0 ? stmt.bind(...params) : stmt;
            const result = await bound.all<T>();
            return result.results;
        } catch (error) {
            this.log('error', 'rawQuery failed: ' + (error instanceof Error ? error.message : String(error)));
            return [];
        }
    }

    /**
     * Executes multiple SQL statements in a single D1 batch.
     *
     * D1's native `batch()` API guarantees all statements are executed inside
     * a single transaction. This has no direct Prisma equivalent.
     *
     * @param statements - Array of `{ sql, params }` objects
     * @returns Array of D1 result objects
     */
    async batchExecute(
        statements: Array<{ sql: string; params?: unknown[] }>,
    ): Promise<D1Result[]> {
        this.ensureOpen();
        try {
            const prepared = statements.map((s) => {
                const stmt = this.d1.prepare(s.sql);
                return s.params?.length ? stmt.bind(...s.params) : stmt;
            });
            return await this.d1.batch(prepared);
        } catch (error) {
            this.log('error', 'batchExecute failed: ' + (error instanceof Error ? error.message : String(error)));
            return [];
        }
    }

    /**
     * Returns the raw D1 database dump as an `ArrayBuffer`.
     *
     * This is a D1-specific operation with no Prisma equivalent.
     *
     * @returns The database dump binary data
     */
    async getDatabaseDump(): Promise<ArrayBuffer> {
        this.ensureOpen();
        return this.d1.dump();
    }

    /**
     * Provides direct access to the underlying Prisma client.
     *
     * Useful for one-off queries that require the full Prisma API surface
     * (e.g. complex aggregations, raw tagged-template queries).
     *
     * @returns The D1-bound PrismaClient instance
     */
    getPrismaClient(): InstanceType<typeof PrismaClient> {
        return this.prisma;
    }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Convenience factory that creates a D1StorageAdapter from a Cloudflare
 * Worker environment object.
 *
 * @param env    - Worker environment containing a `DB` D1 binding
 * @param config - Optional adapter configuration
 * @param logger - Optional structured logger
 * @returns A ready-to-use (but not yet opened) D1StorageAdapter
 *
 * @example
 * ```typescript
 * const storage = createD1Storage(env, { defaultTtlMs: 7_200_000 });
 * await storage.open();
 * ```
 */
export function createD1Storage(
    env: { DB: D1Database },
    config?: D1StorageConfig,
    logger?: ID1Logger,
): D1StorageAdapter {
    return new D1StorageAdapter(env.DB, config, logger);
}

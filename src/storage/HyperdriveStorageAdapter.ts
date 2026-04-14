/**
 * Cloudflare Hyperdrive Storage Adapter (Prisma)
 *
 * Type-safe storage backend for PostgreSQL via Cloudflare Hyperdrive,
 * powered by Prisma ORM.  All raw SQL has been replaced with Prisma
 * queries for compile-time type safety, auto-completion, and migration
 * support.
 *
 * This is the L2 (source of truth) storage tier:
 *   L0: KV (hot cache, edge)
 *   L1: D1 (SQLite, edge read replica)
 *   L2: Hyperdrive -> PostgreSQL via Prisma (this adapter)
 *   L3: R2 (blob storage)
 *
 * @module
 */

import type { PrismaClient } from '../../prisma/generated/client.ts';
import { Prisma } from '../../prisma/generated/client.ts';
import type { IStorageAdapter } from './IStorageAdapter.ts';
import type { CacheEntry, CompilationMetadata, QueryOptions, StorageEntry, StorageStats } from './types.ts';
import type {
    CreateApiKey,
    CreateCompilationEvent,
    CreateCompiledOutput,
    CreateFilterListVersion,
    CreateFilterSource,
    CreateSession,
    CreateSourceChangeEvent,
    CreateSourceHealthSnapshot,
    CreateUser,
} from './schemas.ts';
import {
    CreateApiKeySchema,
    CreateCompilationEventSchema,
    CreateCompiledOutputSchema,
    CreateFilterListVersionSchema,
    CreateFilterSourceSchema,
    CreateSessionSchema,
    CreateSourceChangeEventSchema,
    CreateSourceHealthSnapshotSchema,
    CreateUserSchema,
} from './schemas.ts';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

/**
 * Cloudflare Hyperdrive binding type.
 * Matches the Hyperdrive interface from `@cloudflare/workers-types`.
 */
export interface HyperdriveBinding {
    connectionString: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

/**
 * Factory function that creates a {@link PrismaClient} from a Hyperdrive
 * connection string.  Injected to decouple the adapter from the concrete
 * Prisma instantiation logic (e.g. `@prisma/adapter-pg`).
 */
export type PrismaClientFactory = (connectionString: string) => PrismaClient;

/**
 * Configuration options for {@link HyperdriveStorageAdapter}.
 */
export interface HyperdriveStorageConfig {
    /** Default TTL for cache entries in milliseconds (default: 3 600 000 = 1 h). */
    defaultTtlMs?: number;
    /** Enable query logging (default: false). */
    enableLogging?: boolean;
}

/**
 * Zod schema for validating {@link HyperdriveStorageConfig} at startup.
 */
export const HyperdriveStorageConfigSchema = z.object({
    defaultTtlMs: z.number().int().positive().optional().default(3_600_000),
    enableLogging: z.boolean().optional().default(false),
});

/**
 * Logger interface accepted by {@link HyperdriveStorageAdapter}.
 * All methods are optional so plain `console` is a valid logger.
 */
export interface IHyperdriveLogger {
    debug?(message: string): void;
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
}

// ============================================================================
// Legacy Type Aliases (kept for backward-compatible re-exports)
// ============================================================================

/**
 * @deprecated Use {@link PrismaClientFactory} instead.
 * Retained so that `index.ts` re-exports continue to compile.
 */
export type PgPoolFactory = PrismaClientFactory;

// ============================================================================
// Key Serialisation Helpers
// ============================================================================

/** Serializes a key array (`['a','b']`) to a slash-separated string (`'a/b'`). */
function serializeKey(key: string[]): string {
    return key.join('/');
}

/** Deserializes a slash-separated string back to an array. */
function deserializeKey(key: string): string[] {
    return key.split('/');
}

// ============================================================================
// Adapter Implementation
// ============================================================================

/**
 * Hyperdrive-backed PostgreSQL storage adapter using Prisma ORM.
 *
 * Implements {@link IStorageAdapter} for backward compatibility with existing
 * storage consumers (KV-style operations, filter caching, compilation metadata).
 *
 * Also provides domain-specific methods for the relational models:
 * users, API keys, sessions, filter sources, compiled outputs, etc.
 *
 * @example
 * ```typescript
 * import { createPrismaClient } from '../../worker/lib/prisma.ts';
 *
 * const adapter = new HyperdriveStorageAdapter(
 *     env.HYPERDRIVE,
 *     (cs) => createPrismaClient(cs),
 *     { enableLogging: true },
 *     console,
 * );
 * await adapter.open();
 * const user = await adapter.createUser({ email: 'dev@example.com' });
 * ```
 */
export class HyperdriveStorageAdapter implements IStorageAdapter {
    private prisma: PrismaClient | null = null;
    private readonly hyperdrive: HyperdriveBinding;
    private readonly createPrismaClient: PrismaClientFactory;
    private readonly config: Required<HyperdriveStorageConfig>;
    private readonly logger?: IHyperdriveLogger;
    private _isOpen = false;

    /**
     * Creates a new {@link HyperdriveStorageAdapter}.
     *
     * The adapter connects to PostgreSQL through Cloudflare Hyperdrive using
     * Prisma ORM as the query layer.  The Prisma client is created lazily via
     * the supplied factory when {@link open} is called.
     *
     * @param hyperdrive         - Cloudflare Hyperdrive binding (`env.HYPERDRIVE`).
     * @param createPrismaClient - Factory that turns a connection string into a
     *                             {@link PrismaClient}.
     * @param config             - Optional adapter configuration.
     * @param logger             - Optional logger (all methods optional).
     * @throws {z.ZodError} If `config` fails {@link HyperdriveStorageConfigSchema} validation.
     */
    constructor(
        hyperdrive: HyperdriveBinding,
        createPrismaClient: PrismaClientFactory,
        config?: HyperdriveStorageConfig,
        logger?: IHyperdriveLogger,
    ) {
        this.hyperdrive = hyperdrive;
        this.createPrismaClient = createPrismaClient;
        const parsed = HyperdriveStorageConfigSchema.parse(config ?? {});
        this.config = {
            defaultTtlMs: parsed.defaultTtlMs,
            enableLogging: parsed.enableLogging,
        };
        this.logger = logger;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Opens a Prisma connection via Hyperdrive.
     *
     * @throws {Error} If the Hyperdrive binding is missing or the initial
     *                 connectivity check (`SELECT 1`) fails.
     */
    async open(): Promise<void> {
        if (this._isOpen && this.prisma) {
            this.log('warn', 'Hyperdrive Prisma storage already open');
            return;
        }
        this.prisma = this.createPrismaClient(this.hyperdrive.connectionString);
        // Prisma with driver adapters connects lazily on first query,
        // but we issue a trivial read to fail-fast.
        // deno-lint-ignore no-explicit-any
        await (this.prisma as any).$queryRaw`SELECT 1`;
        this._isOpen = true;
        this.log('info', `Hyperdrive Prisma storage opened (host=${this.hyperdrive.host})`);
    }

    /** Disconnects the Prisma client. */
    async close(): Promise<void> {
        if (this.prisma) {
            // deno-lint-ignore no-explicit-any
            await (this.prisma as any).$disconnect();
            this.prisma = null;
            this._isOpen = false;
            this.log('info', 'Hyperdrive Prisma storage closed');
        }
    }

    /** Returns `true` when the Prisma client is connected. */
    isOpen(): boolean {
        return this._isOpen && this.prisma !== null;
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /** Conditionally logs a message at the given level. */
    private log(level: keyof IHyperdriveLogger, message: string): void {
        if (!this.config.enableLogging || !this.logger) return;
        this.logger[level]?.(message);
    }

    /** Returns the live PrismaClient or throws. */
    private ensureOpen(): PrismaClient {
        if (!this.prisma || !this._isOpen) {
            throw new Error('Storage not initialized. Call open() first.');
        }
        return this.prisma;
    }

    // ========================================================================
    // IStorageAdapter - Core Key-Value Operations
    // ========================================================================

    /**
     * Stores a value with the given composite key.
     *
     * @param key   - Composite key segments (e.g. `['cache','filter','easylist']`).
     * @param value - JSON-serializable value to store.
     * @param ttlMs - Optional TTL in milliseconds.
     * @returns `true` on success, `false` on error.
     */
    async set<T>(key: string[], value: T, ttlMs?: number): Promise<boolean> {
        const prisma = this.ensureOpen();
        const serializedKey = serializeKey(key);
        const now = new Date();
        const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;

        try {
            await prisma.storageEntry.upsert({
                where: { key: serializedKey },
                update: {
                    data: JSON.stringify(value),
                    updatedAt: now,
                    expiresAt,
                },
                create: {
                    key: serializedKey,
                    data: JSON.stringify(value),
                    createdAt: now,
                    updatedAt: now,
                    expiresAt,
                },
            });
            this.log('debug', `SET ${serializedKey}`);
            return true;
        } catch (error) {
            this.log('error', `SET failed for ${serializedKey}: ${error}`);
            return false;
        }
    }

    /**
     * Retrieves a value by composite key.
     *
     * @param key - Composite key segments.
     * @returns The stored entry, or `null` if not found / expired.
     */
    async get<T>(key: string[]): Promise<StorageEntry<T> | null> {
        const prisma = this.ensureOpen();
        const serializedKey = serializeKey(key);

        try {
            const row = await prisma.storageEntry.findUnique({
                where: { key: serializedKey },
            });
            if (!row) return null;

            // Check expiry
            if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
                await prisma.storageEntry.delete({ where: { key: serializedKey } }).catch(() => {});
                return null;
            }

            return {
                data: JSON.parse(row.data) as T,
                createdAt: new Date(row.createdAt).getTime(),
                updatedAt: new Date(row.updatedAt).getTime(),
                expiresAt: row.expiresAt ? new Date(row.expiresAt).getTime() : undefined,
            };
        } catch (error) {
            this.log('error', `GET failed for ${serializedKey}: ${error}`);
            return null;
        }
    }

    /**
     * Deletes an entry by composite key.
     *
     * @param key - Composite key segments.
     * @returns `true` if the operation completed (idempotent).
     */
    async delete(key: string[]): Promise<boolean> {
        const prisma = this.ensureOpen();
        const serializedKey = serializeKey(key);

        try {
            await prisma.storageEntry.delete({ where: { key: serializedKey } });
            this.log('debug', `DELETE ${serializedKey}`);
            return true;
        } catch {
            // Prisma throws P2025 when the record doesn't exist — still idempotent.
            return true;
        }
    }

    /**
     * Lists entries matching the query options.
     *
     * Supports filtering by prefix, pagination, and ordering.
     * Expired entries are automatically excluded.
     *
     * @param options - Query options including prefix, limit, start, end, reverse.
     * @returns Array of `{ key, value }` pairs.
     */
    async list<T>(options: QueryOptions = {}): Promise<Array<{ key: string[]; value: StorageEntry<T> }>> {
        const prisma = this.ensureOpen();

        try {
            // deno-lint-ignore no-explicit-any
            const conditions: any[] = [
                { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            ];

            if (options.prefix) {
                conditions.push({ key: { startsWith: serializeKey(options.prefix) } });
            }
            if (options.start) {
                conditions.push({ key: { gte: serializeKey(options.start) } });
            }
            if (options.end) {
                conditions.push({ key: { lte: serializeKey(options.end) } });
            }

            const rows = await prisma.storageEntry.findMany({
                where: { AND: conditions },
                take: options.limit,
                orderBy: { key: options.reverse ? 'desc' : 'asc' },
            });

            return rows.map((row) => ({
                key: deserializeKey(row.key),
                value: {
                    data: JSON.parse(row.data) as T,
                    createdAt: new Date(row.createdAt).getTime(),
                    updatedAt: new Date(row.updatedAt).getTime(),
                    expiresAt: row.expiresAt ? new Date(row.expiresAt).getTime() : undefined,
                },
            }));
        } catch (error) {
            this.log('error', `LIST failed: ${error}`);
            return [];
        }
    }

    // ========================================================================
    // IStorageAdapter - Maintenance
    // ========================================================================

    /**
     * Removes expired entries from `storage_entries` and `filter_cache`.
     *
     * @returns Total number of rows deleted.
     */
    async clearExpired(): Promise<number> {
        const prisma = this.ensureOpen();
        const now = new Date();

        try {
            const [storageResult, cacheResult] = await Promise.all([
                prisma.storageEntry.deleteMany({
                    where: { expiresAt: { lt: now } },
                }),
                prisma.filterCache.deleteMany({
                    where: { expiresAt: { lt: now } },
                }),
            ]);
            const total = storageResult.count + cacheResult.count;
            if (total > 0) this.log('debug', `Cleared ${total} expired entries`);
            return total;
        } catch (error) {
            this.log('error', `clearExpired failed: ${error}`);
            return 0;
        }
    }

    /**
     * Returns aggregate statistics about stored data.
     *
     * @returns Statistics including entry counts. `sizeBytes` is always 0
     *          (Prisma does not expose table size; callers can use `rawQuery`).
     */
    async getStats(): Promise<StorageStats> {
        const prisma = this.ensureOpen();

        try {
            const [entryCount, expiredCount] = await Promise.all([
                prisma.storageEntry.count(),
                prisma.storageEntry.count({
                    where: { expiresAt: { lt: new Date() } },
                }),
            ]);

            return {
                entryCount,
                expiredCount,
                sizeEstimate: 0,
            };
        } catch (error) {
            this.log('error', `getStats failed: ${error}`);
            return { entryCount: 0, expiredCount: 0, sizeEstimate: 0 };
        }
    }

    // ========================================================================
    // IStorageAdapter - Filter Caching
    // ========================================================================

    /**
     * Upserts a cached filter list identified by its source URL.
     *
     * The `content` array (one rule per element) is JSON-serialized for storage
     * in the `filter_cache.content` TEXT column and deserialized back on read.
     *
     * @param source  - Source URL (unique key).
     * @param content - Array of filter rules.
     * @param hash    - SHA-256 content hash.
     * @param etag    - Optional HTTP ETag.
     * @param ttlMs   - Optional TTL in milliseconds (defaults to config value).
     * @returns `true` on success, `false` on error.
     */
    async cacheFilterList(
        source: string,
        content: string[],
        hash: string,
        etag?: string,
        ttlMs?: number,
    ): Promise<boolean> {
        const prisma = this.ensureOpen();
        const now = new Date();
        const effectiveTtl = ttlMs ?? this.config.defaultTtlMs;
        const expiresAt = new Date(Date.now() + effectiveTtl);

        try {
            await prisma.filterCache.upsert({
                where: { source },
                update: {
                    content: JSON.stringify(content),
                    hash,
                    etag: etag ?? null,
                    updatedAt: now,
                    expiresAt,
                },
                create: {
                    source,
                    content: JSON.stringify(content),
                    hash,
                    etag: etag ?? null,
                    createdAt: now,
                    updatedAt: now,
                    expiresAt,
                },
            });
            this.log('debug', `Cached filter list: ${source}`);
            return true;
        } catch (error) {
            this.log('error', `cacheFilterList failed for ${source}: ${error}`);
            return false;
        }
    }

    /**
     * Retrieves a cached filter list by source URL.
     *
     * @param source - Source URL.
     * @returns The cache entry, or `null` if not found / expired.
     */
    async getCachedFilterList(source: string): Promise<CacheEntry | null> {
        const prisma = this.ensureOpen();

        try {
            const row = await prisma.filterCache.findUnique({ where: { source } });
            if (!row) return null;

            // Honour expiry
            if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
                this.log('debug', `Filter cache for ${source} has expired`);
                await prisma.filterCache.delete({ where: { source } }).catch(() => {});
                return null;
            }

            return {
                source: row.source,
                content: JSON.parse(row.content) as string[],
                hash: row.hash,
                etag: row.etag ?? undefined,
            };
        } catch (error) {
            this.log('error', `getCachedFilterList failed for ${source}: ${error}`);
            return null;
        }
    }

    // ========================================================================
    // IStorageAdapter - Compilation Metadata
    // ========================================================================

    /**
     * Stores compilation metadata.
     *
     * @param metadata - Compilation run details.
     * @returns `true` on success, `false` on error.
     */
    async storeCompilationMetadata(metadata: CompilationMetadata): Promise<boolean> {
        const prisma = this.ensureOpen();

        try {
            await prisma.compilationMetadata.create({
                data: {
                    configName: metadata.configName,
                    timestamp: new Date(metadata.timestamp),
                    sourceCount: metadata.sourceCount,
                    ruleCount: metadata.ruleCount,
                    duration: metadata.duration,
                    outputPath: metadata.outputPath ?? null,
                },
            });
            this.log('debug', `Stored compilation metadata for ${metadata.configName}`);
            return true;
        } catch (error) {
            this.log('error', `storeCompilationMetadata failed: ${error}`);
            return false;
        }
    }

    /**
     * Returns compilation history, ordered newest-first.
     *
     * @param configName - Config name to filter by.
     * @param limit      - Max rows (default 10).
     * @returns Array of {@link CompilationMetadata}.
     */
    async getCompilationHistory(configName: string, limit = 10): Promise<CompilationMetadata[]> {
        const prisma = this.ensureOpen();

        try {
            const rows = await prisma.compilationMetadata.findMany({
                where: { configName },
                orderBy: { timestamp: 'desc' },
                take: limit,
            });

            return rows.map((row) => ({
                configName: row.configName,
                timestamp: row.timestamp.getTime(),
                sourceCount: row.sourceCount,
                ruleCount: row.ruleCount,
                duration: row.duration,
                outputPath: row.outputPath ?? undefined,
            }));
        } catch (error) {
            this.log('error', `getCompilationHistory failed: ${error}`);
            return [];
        }
    }

    // ========================================================================
    // IStorageAdapter - Cache Management
    // ========================================================================

    /**
     * Clears all cached data — both `cache/*` storage entries and all filter
     * cache rows.
     *
     * @returns Total number of entries deleted.
     */
    async clearCache(): Promise<number> {
        const prisma = this.ensureOpen();

        try {
            const [storageResult, cacheResult] = await Promise.all([
                prisma.storageEntry.deleteMany({
                    where: { key: { startsWith: 'cache/' } },
                }),
                prisma.filterCache.deleteMany(),
            ]);
            const total = storageResult.count + cacheResult.count;
            this.log('info', `Cleared ${total} cache entries`);
            return total;
        } catch (error) {
            this.log('error', `clearCache failed: ${error}`);
            return 0;
        }
    }

    // ========================================================================
    // Domain Methods - Users
    // ========================================================================

    /**
     * Creates a new user.
     *
     * @param data - Validated by {@link CreateUserSchema}.
     * @returns The new user's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations (e.g. duplicate email).
     */
    async createUser(data: CreateUser): Promise<{ id: string }> {
        const validated = CreateUserSchema.parse(data);
        const prisma = this.ensureOpen();
        const user = await prisma.user.create({
            data: {
                email: validated.email,
                displayName: validated.displayName ?? null,
                role: validated.role,
            },
            select: { id: true },
        });
        return { id: user.id };
    }

    /**
     * Looks up a user by email.
     *
     * @param email - The email address to search for.
     * @returns `{ id, email, role }` or `null` if not found.
     * @throws {Error} If the adapter is not open.
     */
    async getUserByEmail(email: string): Promise<{ id: string; email: string; role: string } | null> {
        const prisma = this.ensureOpen();
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, role: true },
        });
        if (!user || !user.email) return null;
        return { id: user.id, email: user.email, role: user.role };
    }

    // ========================================================================
    // Domain Methods - API Keys
    // ========================================================================

    /**
     * Creates a new API key record.
     *
     * Generates a `keyHash` and `keyPrefix` from a random UUID internally,
     * matching the behaviour of the original raw-SQL implementation.
     *
     * @param data - Validated by {@link CreateApiKeySchema}.
     * @returns The new API key's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations.
     */
    async createApiKey(data: CreateApiKey): Promise<{ id: string }> {
        const validated = CreateApiKeySchema.parse(data);
        const prisma = this.ensureOpen();

        // Generate key material (same logic as the original raw-SQL adapter)
        const rawKey = crypto.randomUUID();
        const keyHash = rawKey;
        const keyPrefix = rawKey.slice(0, 8);

        const apiKey = await prisma.apiKey.create({
            data: {
                userId: validated.userId,
                name: validated.name,
                keyHash,
                keyPrefix,
                scopes: validated.scopes,
                rateLimitPerMinute: validated.rateLimitPerMinute,
                expiresAt: validated.expiresAt ?? null,
            },
            select: { id: true },
        });
        return { id: apiKey.id };
    }

    // ========================================================================
    // Domain Methods - Sessions
    // ========================================================================

    /**
     * Creates a new session.
     *
     * @param data - Validated by {@link CreateSessionSchema}.
     * @returns The new session's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations.
     */
    async createSession(data: CreateSession): Promise<{ id: string }> {
        const validated = CreateSessionSchema.parse(data);
        const prisma = this.ensureOpen();

        const session = await prisma.session.create({
            data: {
                userId: validated.userId,
                token: validated.token ?? crypto.randomUUID(),
                ipAddress: validated.ipAddress ?? null,
                userAgent: validated.userAgent ?? null,
                expiresAt: validated.expiresAt,
            },
            select: { id: true },
        });
        return { id: session.id };
    }

    // ========================================================================
    // Domain Methods - Filter Sources
    // ========================================================================

    /**
     * Creates a new filter source.
     *
     * @param data - Validated by {@link CreateFilterSourceSchema}.
     * @returns The new source's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations (e.g. duplicate URL).
     */
    async createFilterSource(data: CreateFilterSource): Promise<{ id: string }> {
        const validated = CreateFilterSourceSchema.parse(data);
        const prisma = this.ensureOpen();
        const source = await prisma.filterSource.create({
            data: {
                url: validated.url,
                name: validated.name,
                description: validated.description ?? null,
                homepage: validated.homepage ?? null,
                license: validated.license ?? null,
                isPublic: validated.isPublic,
                ownerUserId: validated.ownerUserId ?? null,
                refreshIntervalSeconds: validated.refreshIntervalSeconds,
            },
            select: { id: true },
        });
        return { id: source.id };
    }

    /**
     * Lists filter sources.
     *
     * @param publicOnly - When `true`, only public sources are returned.
     * @returns Array of `{ id, url, name, isPublic }`.
     * @throws {Error} If the adapter is not open.
     */
    async listFilterSources(
        publicOnly?: boolean,
    ): Promise<Array<{ id: string; url: string; name: string; isPublic: boolean }>> {
        const prisma = this.ensureOpen();
        const rows = await prisma.filterSource.findMany({
            where: publicOnly ? { isPublic: true } : undefined,
            select: { id: true, url: true, name: true, isPublic: true },
            orderBy: { name: 'asc' },
        });
        return rows;
    }

    // ========================================================================
    // Domain Methods - Filter List Versions
    // ========================================================================

    /**
     * Creates a new filter list version.
     *
     * @param data - Validated by {@link CreateFilterListVersionSchema}.
     * @returns The new version's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations.
     */
    async createFilterListVersion(data: CreateFilterListVersion): Promise<{ id: string }> {
        const validated = CreateFilterListVersionSchema.parse(data);
        const prisma = this.ensureOpen();
        const version = await prisma.filterListVersion.create({
            data: {
                sourceId: validated.sourceId,
                contentHash: validated.contentHash,
                ruleCount: validated.ruleCount,
                etag: validated.etag ?? null,
                r2Key: validated.r2Key,
                expiresAt: validated.expiresAt ?? null,
                isCurrent: validated.isCurrent,
            },
            select: { id: true },
        });
        return { id: version.id };
    }

    // ========================================================================
    // Domain Methods - Compiled Outputs
    // ========================================================================

    /**
     * Creates a new compiled output record.
     *
     * @param data - Validated by {@link CreateCompiledOutputSchema}.
     * @returns The new output's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations.
     */
    async createCompiledOutput(data: CreateCompiledOutput): Promise<{ id: string }> {
        const validated = CreateCompiledOutputSchema.parse(data);
        const prisma = this.ensureOpen();
        const output = await prisma.compiledOutput.create({
            data: {
                configHash: validated.configHash,
                configName: validated.configName,
                configSnapshot: validated.configSnapshot as unknown as Prisma.InputJsonValue,
                ruleCount: validated.ruleCount,
                sourceCount: validated.sourceCount,
                durationMs: validated.durationMs,
                r2Key: validated.r2Key,
                ownerUserId: validated.ownerUserId ?? null,
                expiresAt: validated.expiresAt ?? null,
            },
            select: { id: true },
        });
        return { id: output.id };
    }

    /**
     * Finds a compiled output by its config hash.
     *
     * @param configHash - Unique hash of the compilation configuration.
     * @returns `{ id, r2Key, ruleCount }` or `null`.
     * @throws {Error} If the adapter is not open.
     */
    async getCompiledOutputByHash(
        configHash: string,
    ): Promise<{ id: string; r2Key: string; ruleCount: number } | null> {
        const prisma = this.ensureOpen();
        const row = await prisma.compiledOutput.findUnique({
            where: { configHash },
            select: { id: true, r2Key: true, ruleCount: true },
        });
        return row;
    }

    // ========================================================================
    // Domain Methods - Compilation Events
    // ========================================================================

    /**
     * Records a compilation event (append-only audit log).
     *
     * @param data - Validated by {@link CreateCompilationEventSchema}.
     * @returns The new event's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations.
     */
    async createCompilationEvent(data: CreateCompilationEvent): Promise<{ id: string }> {
        const validated = CreateCompilationEventSchema.parse(data);
        const prisma = this.ensureOpen();
        const event = await prisma.compilationEvent.create({
            data: {
                compiledOutputId: validated.compiledOutputId ?? null,
                userId: validated.userId ?? null,
                apiKeyId: validated.apiKeyId ?? null,
                requestSource: validated.requestSource,
                workerRegion: validated.workerRegion ?? null,
                durationMs: validated.durationMs,
                cacheHit: validated.cacheHit,
                errorMessage: validated.errorMessage ?? null,
            },
            select: { id: true },
        });
        return { id: event.id };
    }

    // ========================================================================
    // Domain Methods - Source Health Tracking
    // ========================================================================

    /**
     * Creates a source health snapshot.
     *
     * @param data - Validated by {@link CreateSourceHealthSnapshotSchema}.
     * @returns The new snapshot's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations.
     */
    async createSourceHealthSnapshot(data: CreateSourceHealthSnapshot): Promise<{ id: string }> {
        const validated = CreateSourceHealthSnapshotSchema.parse(data);
        const prisma = this.ensureOpen();
        const snapshot = await prisma.sourceHealthSnapshot.create({
            data: {
                sourceId: validated.sourceId,
                status: validated.status,
                totalAttempts: validated.totalAttempts,
                successfulAttempts: validated.successfulAttempts,
                failedAttempts: validated.failedAttempts,
                consecutiveFailures: validated.consecutiveFailures,
                avgDurationMs: validated.avgDurationMs,
                avgRuleCount: validated.avgRuleCount,
            },
            select: { id: true },
        });
        return { id: snapshot.id };
    }

    /**
     * Records a source change event.
     *
     * @param data - Validated by {@link CreateSourceChangeEventSchema}.
     * @returns The new event's `id`.
     * @throws {z.ZodError} If `data` fails schema validation.
     * @throws {Error} On database constraint violations.
     */
    async createSourceChangeEvent(data: CreateSourceChangeEvent): Promise<{ id: string }> {
        const validated = CreateSourceChangeEventSchema.parse(data);
        const prisma = this.ensureOpen();
        const event = await prisma.sourceChangeEvent.create({
            data: {
                sourceId: validated.sourceId,
                previousVersionId: validated.previousVersionId ?? null,
                newVersionId: validated.newVersionId,
                ruleCountDelta: validated.ruleCountDelta,
                contentHashChanged: validated.contentHashChanged,
            },
            select: { id: true },
        });
        return { id: event.id };
    }

    // ========================================================================
    // PostgreSQL-Specific Utility Methods
    // ========================================================================

    /**
     * Executes a raw SQL query against PostgreSQL via Hyperdrive.
     * Use with caution -- prefer the typed Prisma methods above.
     *
     * @param sql    - Raw SQL string.
     * @param params - Bind parameters.
     * @returns Array of rows.
     * @throws {Error} If the adapter is not open or the query fails.
     */
    async rawQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
        const prisma = this.ensureOpen();
        // deno-lint-ignore no-explicit-any
        const rows = await (prisma as any).$queryRawUnsafe(sql, ...(params ?? []));
        return rows as T[];
    }

    /**
     * Health check -- verifies connectivity to PostgreSQL via Hyperdrive.
     *
     * @returns `{ ok, latencyMs }`.
     * @throws {Error} If the adapter is not open (via {@link ensureOpen}).
     */
    async healthCheck(): Promise<{ ok: boolean; latencyMs: number }> {
        const prisma = this.ensureOpen();
        const start = Date.now();
        try {
            // deno-lint-ignore no-explicit-any
            await (prisma as any).$queryRaw`SELECT 1`;
            return { ok: true, latencyMs: Date.now() - start };
        } catch {
            return { ok: false, latencyMs: Date.now() - start };
        }
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a Hyperdrive storage adapter from a Cloudflare Worker environment.
 *
 * @param hyperdrive         - Cloudflare Hyperdrive binding.
 * @param createPrismaClient - Factory to build a PrismaClient from a connection string.
 * @param config             - Optional adapter configuration.
 * @param logger             - Optional logger.
 * @returns A new {@link HyperdriveStorageAdapter} (not yet open -- call `.open()`).
 *
 * @example
 * ```typescript
 * import { createPrismaClient } from '../../worker/lib/prisma.ts';
 *
 * const storage = createHyperdriveStorage(
 *     env.HYPERDRIVE,
 *     (cs) => createPrismaClient(cs),
 * );
 * await storage.open();
 * ```
 */
export function createHyperdriveStorage(
    hyperdrive: HyperdriveBinding,
    createPrismaClient: PrismaClientFactory,
    config?: HyperdriveStorageConfig,
    logger?: IHyperdriveLogger,
): HyperdriveStorageAdapter {
    return new HyperdriveStorageAdapter(hyperdrive, createPrismaClient, config, logger);
}

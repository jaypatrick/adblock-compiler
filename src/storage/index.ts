/**
 * Storage module exports
 */

// Core storage types
export type { CacheEntry, CompilationMetadata, QueryOptions, StorageEntry, StorageStats } from './types.ts';

// Health monitoring
export { HealthStatus, type SourceAttempt, type SourceHealthMetrics, SourceHealthMonitor } from './SourceHealthMonitor.ts';

// Change detection
export { type ChangeDetectionResult, ChangeDetector, type ChangeSummary, type SourceSnapshot } from './ChangeDetector.ts';

// Caching downloader
export { CachingDownloader, type CachingOptions, type DownloadResult } from './CachingDownloader.ts';

// Storage abstraction layer
export type { IStorageAdapter, StorageAdapterConfig, StorageAdapterFactory, StorageAdapterType } from './IStorageAdapter.ts';

/**
 * @deprecated Use {@link HyperdriveStorageAdapter} instead — it uses Prisma
 * natively and is the canonical storage backend.
 */
export { PrismaStorageAdapter } from './PrismaStorageAdapter.ts';

// Cloudflare D1 storage adapter (for edge deployments)
export { createD1Storage, D1StorageAdapter, type D1StorageConfig } from './D1StorageAdapter.ts';

// Cloudflare Hyperdrive storage adapter (for PostgreSQL via Prisma)
export {
    createHyperdriveStorage,
    type HyperdriveBinding,
    HyperdriveStorageAdapter,
    type HyperdriveStorageConfig,
    HyperdriveStorageConfigSchema,
    type IHyperdriveLogger,
    /** @deprecated Use PrismaClientFactory instead. */
    type PgPoolFactory,
    type PrismaClientFactory,
} from './HyperdriveStorageAdapter.ts';

// D1 cache sync utilities (Neon → D1 write-through / lazy sync)
export {
    type BatchSyncResult,
    type CacheSyncResult,
    type D1CacheSyncConfig,
    D1CacheSyncConfigSchema,
    type ICacheSyncLogger,
    invalidateRecord,
    isCacheStale,
    syncBatch,
    syncRecord,
    type SyncTable,
} from './d1-cache-sync.ts';

// Zod validation schemas for database models
export {
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

export type {
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

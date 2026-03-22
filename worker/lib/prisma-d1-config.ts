/**
 * Zod validation schema for D1 PrismaClient configuration.
 *
 * Separated from prisma-d1.ts so tests can import validation logic
 * without loading PrismaClient (which requires the Cloudflare Workers runtime).
 *
 * @module prisma-d1-config
 */

import { z } from 'zod';

/**
 * Schema for validating D1 storage adapter configuration.
 *
 * Ensures configuration values are within acceptable ranges before
 * initialising the PrismaClient → D1 adapter pipeline.
 *
 * @example
 * ```typescript
 * const cfg = D1StorageConfigSchema.parse({
 *     defaultTtlMs: 7_200_000,  // 2 hours
 *     enableLogging: true,
 * });
 * ```
 */
export const D1StorageConfigSchema = z.object({
    /** Default TTL for cache entries in milliseconds (min 0 = no expiry). */
    defaultTtlMs: z.number().int().min(0).default(3_600_000),

    /** Enable verbose query logging via the adapter's logger. */
    enableLogging: z.boolean().default(false),
});

/** Validated D1 storage adapter configuration. */
export type D1StorageConfig = z.infer<typeof D1StorageConfigSchema>;

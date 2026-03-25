/**
 * Zod validation schema for PrismaClient configuration.
 *
 * Separated from prisma.ts so tests can import validation logic
 * without loading PrismaClient (which requires Node-compatible env access).
 */

import { z } from 'zod';

/**
 * Schema for validating Hyperdrive connection string configuration.
 * Accepts both the canonical postgresql:// and the postgres:// alias.
 *
 * Cloudflare Hyperdrive returns postgres:// from its .connectionString property
 * (the scheme field in the Hyperdrive config is "postgres"), while local dev
 * and direct Neon URLs use postgresql://. Both are valid PostgreSQL DSNs and
 * are accepted by @prisma/adapter-pg.
 */
export const PrismaClientConfigSchema = z.object({
    connectionString: z
        .string()
        .url()
        .refine(
            (s) => s.startsWith('postgresql://') || s.startsWith('postgres://'),
            { message: 'Connection string must start with postgresql:// or postgres://' },
        ),
});

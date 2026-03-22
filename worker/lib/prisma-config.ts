/**
 * Zod validation schema for PrismaClient configuration.
 *
 * Separated from prisma.ts so tests can import validation logic
 * without loading PrismaClient (which requires Node-compatible env access).
 */

import { z } from 'zod';

/**
 * Schema for validating Hyperdrive connection string configuration.
 * Ensures the connection string is a valid PostgreSQL URL.
 */
export const PrismaClientConfigSchema = z.object({
    connectionString: z.string().url().startsWith('postgresql://'),
});

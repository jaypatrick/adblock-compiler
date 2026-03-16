/**
 * Prisma D1 Client Factory
 *
 * Creates a Prisma client bound to a Cloudflare D1 database instance.
 * Uses @prisma/adapter-d1 (Prisma 7+) for edge-compatible access.
 *
 * Usage:
 *   const prisma = getPrismaD1(env.DB);
 *   const user = await prisma.localAuthUser.findUnique({ where: { identifier } });
 *
 * The factory caches one client per D1 binding reference so repeated calls
 * within the same Worker request reuse the same instance (no extra overhead).
 *
 * When env.DB is null/undefined (unbound in development or missing config),
 * the factory throws a descriptive error so callers can handle it gracefully.
 */

import { PrismaD1 } from '@prisma/adapter-d1';
import { PrismaClient } from '../../prisma/generated-d1/client.ts';

export type PrismaD1Client = InstanceType<typeof PrismaClient>;

// Module-level cache: D1 binding → PrismaClient instance.
// A new Worker invocation gets a fresh module scope, so this stays bounded.
const clientCache = new WeakMap<D1Database, PrismaD1Client>();

/**
 * Returns a Prisma client for the given D1 binding.
 * Throws if db is null/undefined.
 */
export function getPrismaD1(db: D1Database | null | undefined): PrismaD1Client {
    if (!db) {
        throw new Error('D1 database binding (env.DB) is not configured.');
    }

    const cached = clientCache.get(db);
    if (cached) return cached;

    const adapter = new PrismaD1(db);
    const client = new PrismaClient({ adapter }) as unknown as PrismaD1Client;
    clientCache.set(db, client);
    return client;
}

/**
 * Prisma D1 Client Factory
 *
 * Creates a PrismaClient connected to Cloudflare D1 via {@link https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1 | @prisma/adapter-d1}.
 *
 * Unlike Hyperdrive (PostgreSQL), D1 is a bound resource — no connection
 * string is needed. The Cloudflare runtime provides a `D1Database` binding
 * that the adapter proxies through Prisma's query engine.
 *
 * @see https://developers.cloudflare.com/d1/
 * @see https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1
 *
 * @module prisma-d1
 */

import { PrismaClient } from '../../prisma/generated-d1/client.ts';
import { PrismaD1 } from '@prisma/adapter-d1';
import { D1StorageConfigSchema as _D1StorageConfigSchema } from './prisma-d1-config.ts';

export { D1StorageConfigSchema } from './prisma-d1-config.ts';
export type { D1StorageConfig } from './prisma-d1-config.ts';

/**
 * Creates a PrismaClient connected to Cloudflare D1.
 *
 * D1 bindings are always available within a Worker request — there is no
 * connection pooling step. Creating a new PrismaClient per request is safe
 * and expected.
 *
 * @param d1Database - The D1 database binding from `env.DB`
 * @returns A configured PrismaClient instance backed by D1
 * @throws {Error} If the D1 database binding is falsy
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker fetch handler:
 * const prisma = createD1PrismaClient(env.DB);
 * const entries = await prisma.storageEntry.findMany();
 * ```
 */
export function createD1PrismaClient(
    // Accept any D1-compatible binding — the PrismaD1 adapter handles validation
    // deno-lint-ignore no-explicit-any
    d1Database: any,
): InstanceType<typeof PrismaClient> {
    if (!d1Database) {
        throw new Error('D1 database binding is required. Ensure env.DB is configured in wrangler.toml.');
    }

    const adapter = new PrismaD1(d1Database);
    return new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
}

/**
 * Prisma PostgreSQL Client Factory (Hyperdrive)
 *
 * Creates a PrismaClient connected to Neon PostgreSQL via Cloudflare Hyperdrive.
 *
 * Hyperdrive IS the connection pool — it proxies connections locally,
 * so creating a new PrismaClient per request connects to a local proxy socket,
 * not directly to PostgreSQL. This makes per-request instantiation safe.
 *
 * @see https://developers.cloudflare.com/hyperdrive/
 * @see https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections#external-connection-poolers
 */

import { PrismaClient } from '../../prisma/generated/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClientConfigSchema } from './prisma-config.ts';

export { PrismaClientConfigSchema } from './prisma-config.ts';

/**
 * Creates a PrismaClient connected to Neon PostgreSQL via Hyperdrive.
 *
 * Hyperdrive IS the connection pool — it proxies connections locally,
 * so creating a new PrismaClient per request connects to a local proxy socket,
 * not directly to PostgreSQL. This makes per-request instantiation safe.
 *
 * @param hyperdriveConnectionString - The connection string from `env.HYPERDRIVE.connectionString`
 * @returns A configured PrismaClient instance
 * @throws {z.ZodError} If the connection string is invalid
 *
 * @example
 * ```typescript
 * const prisma = createPrismaClient(c.env.HYPERDRIVE!.connectionString);
 * const user = await prisma.user.findUnique({ where: { id } });
 * ```
 */
export function createPrismaClient(hyperdriveConnectionString: string): InstanceType<typeof PrismaClient> {
    PrismaClientConfigSchema.parse({ connectionString: hyperdriveConnectionString });

    const adapter = new PrismaPg({ connectionString: hyperdriveConnectionString });
    return new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
}

/**
 * Mutable indirection object used by handlers that need `createPrismaClient`
 * to be stubbable in unit tests.
 *
 * ES module namespace exports are non-configurable, so `@std/testing/mock`
 * `stub()` cannot replace them directly. Handlers should call
 * `_internals.createPrismaClient(...)` and tests can stub the property on
 * this plain object.
 *
 * @example
 * ```typescript
 * // In production handler:
 * import { _internals } from '../lib/prisma.ts';
 * const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
 *
 * // In test:
 * import { _internals } from '../lib/prisma.ts';
 * const s = stub(_internals, 'createPrismaClient', () => mockClient);
 * ```
 */
export const _internals = { createPrismaClient };

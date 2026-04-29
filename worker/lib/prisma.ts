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
 * UUID regex used to detect non-UUID IDs that PostgreSQL would reject.
 *
 * PostgreSQL's `uuid` type requires the canonical 8-4-4-4-12 hex format.
 * Better Auth 1.5.x may generate opaque alphanumeric IDs (e.g.
 * `NqEqNgrxWWaQnyBqb9SLtbGG0ODl2TK2`) that fail this check.
 *
 * Exported so unit tests can assert detection behaviour without a database connection.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Creates a PrismaClient connected to Neon PostgreSQL via Hyperdrive.
 *
 * Hyperdrive IS the connection pool — it proxies connections locally,
 * so creating a new PrismaClient per request connects to a local proxy socket,
 * not directly to PostgreSQL. This makes per-request instantiation safe.
 *
 * The returned client includes a query extension that intercepts every `create`
 * operation and replaces any non-UUID `data.id` with `crypto.randomUUID()`.
 * This is necessary because Better Auth 1.5.x does not reliably call
 * `advanced.generateId` before passing IDs to the Prisma adapter, causing
 * PostgreSQL to reject them with "invalid input syntax for type uuid".
 *
 * @param hyperdriveConnectionString - The connection string from `env.HYPERDRIVE.connectionString`
 * @returns A configured PrismaClient instance with UUID enforcement extension
 * @throws {z.ZodError} If the connection string is invalid
 *
 * @example
 * ```typescript
 * const prisma = createPrismaClient(c.env.HYPERDRIVE!.connectionString);
 * const user = await prisma.user.findUnique({ where: { id } });
 * ```
 */
export function createPrismaClient(hyperdriveConnectionString: string) {
    PrismaClientConfigSchema.parse({ connectionString: hyperdriveConnectionString });

    const adapter = new PrismaPg({ connectionString: hyperdriveConnectionString });
    const prisma = new PrismaClient({ adapter });

    // Better Auth 1.5.x does not reliably call advanced.generateId before
    // passing IDs to Prisma. All model id columns are @db.Uuid in PostgreSQL,
    // so any non-UUID string causes "invalid input syntax for type uuid".
    // This extension intercepts every create operation and replaces non-UUID
    // ids with crypto.randomUUID() before the query reaches the database.
    return prisma.$extends({
        query: {
            $allModels: {
                async create({ args, query }) {
                    if (
                        args.data &&
                        typeof args.data === 'object' &&
                        'id' in args.data &&
                        typeof args.data.id === 'string' &&
                        !UUID_REGEX.test(args.data.id)
                    ) {
                        (args.data as Record<string, unknown>).id = crypto.randomUUID();
                    }
                    return query(args);
                },
            },
        },
    });
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

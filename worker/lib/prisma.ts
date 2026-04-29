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
 * Applies UUID enforcement to a Prisma `create` operation's data argument.
 *
 * If `data` contains an `id` property that is a non-empty string but does NOT
 * satisfy {@link UUID_REGEX}, it is replaced with `crypto.randomUUID()`.
 *
 * **Mutates** `data` in place — Prisma's `$extends` callback passes `args.data`
 * by reference and expects modifications to be made directly on the object.
 *
 * Extracted from the `$extends` callback so the enforcement logic can be
 * unit-tested without a database connection.
 *
 * @internal exported for testing only
 */
export function _enforceUuidOnCreateData(data: Record<string, unknown>): void {
    if ('id' in data && typeof data.id === 'string' && data.id.length > 0 && !UUID_REGEX.test(data.id)) {
        data.id = crypto.randomUUID();
    }
}

/**
 * Prisma model names managed by Better Auth.
 *
 * Better Auth 1.5.x passes opaque IDs (e.g. `NqEqNgrxWWaQnyBqb9SLtbGG0ODl2TK2`)
 * to these models before the Prisma adapter can apply `advanced.generateId`.
 * All other models generate their own IDs (UUID or cuid) via Prisma's
 * `@default()` expression and are not affected by the UUID enforcement extension.
 */
const BETTER_AUTH_MODELS = new Set(['User', 'Session', 'Account', 'Verification', 'TwoFactor', 'Organization', 'Member']);

/**
 * Builds the `$extends` query extension that enforces UUID ids on Better Auth
 * models, and returns the extended client.
 *
 * Extracted as a separate function so {@link PrismaClientExtended} can be
 * derived from its return type without creating a circular reference through
 * {@link createPrismaClient}.
 *
 * @internal
 */
function _buildUuidExtension(prisma: PrismaClient) {
    // Better Auth 1.5.x does not reliably call advanced.generateId before
    // passing IDs to Prisma. The Better Auth tables (User, Session, Account,
    // Verification, TwoFactor, Organization, Member) use @db.Uuid id columns,
    // so any non-UUID string causes "invalid input syntax for type uuid".
    // This extension intercepts create operations on those models only and
    // replaces non-UUID ids with crypto.randomUUID() before the query reaches
    // the database. Other models (e.g. StorageEntry, FilterCache,
    // CompilationMetadata) use @default(cuid()) and are not affected.
    return prisma.$extends({
        query: {
            $allModels: {
                async create({ model, args, query }) {
                    if (BETTER_AUTH_MODELS.has(model) && args.data && typeof args.data === 'object') {
                        _enforceUuidOnCreateData(args.data as Record<string, unknown>);
                    }
                    return query(args);
                },
            },
        },
    });
}

/**
 * The type of the extended PrismaClient returned by {@link createPrismaClient}.
 *
 * Derived from {@link _buildUuidExtension} rather than from
 * `ReturnType<typeof createPrismaClient>` to avoid a circular type reference.
 * Import this type alias wherever the extended client type is needed.
 *
 * @example
 * ```typescript
 * import type { PrismaClientExtended } from '../lib/prisma.ts';
 *
 * interface Variables {
 *     prisma?: PrismaClientExtended;
 * }
 * ```
 */
export type PrismaClientExtended = ReturnType<typeof _buildUuidExtension>;

/**
 * Creates a PrismaClient connected to Neon PostgreSQL via Hyperdrive.
 *
 * Hyperdrive IS the connection pool — it proxies connections locally,
 * so creating a new PrismaClient per request connects to a local proxy socket,
 * not directly to PostgreSQL. This makes per-request instantiation safe.
 *
 * The returned client includes a query extension that intercepts `create`
 * operations on Better Auth models and replaces any non-UUID `data.id` with
 * `crypto.randomUUID()`. This is necessary because Better Auth 1.5.x does not
 * reliably call `advanced.generateId` before passing IDs to the Prisma adapter,
 * causing PostgreSQL to reject them with "invalid input syntax for type uuid".
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
export function createPrismaClient(hyperdriveConnectionString: string): PrismaClientExtended {
    PrismaClientConfigSchema.parse({ connectionString: hyperdriveConnectionString });

    const adapter = new PrismaPg({ connectionString: hyperdriveConnectionString });
    const prisma = new PrismaClient({ adapter });
    return _buildUuidExtension(prisma);
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

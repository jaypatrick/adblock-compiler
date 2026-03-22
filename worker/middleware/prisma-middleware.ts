/**
 * Prisma Request-Scoped Middleware
 *
 * Creates a request-scoped PrismaClient via Hyperdrive and stores it in
 * the Hono context so downstream handlers can access it without creating
 * duplicate clients.
 *
 * ## Why request-scoped?
 * Cloudflare Workers do not have a persistent process — each request gets
 * fresh bindings. Hyperdrive IS the connection pool, so creating a
 * PrismaClient per request connects to a local proxy socket (not directly
 * to PostgreSQL). This middleware centralises that creation so multiple
 * route handlers share the same instance within a single request.
 *
 * ## Usage
 * ```typescript
 * import { prismaMiddleware } from './middleware/prisma-middleware.ts';
 *
 * app.use('/api/*', prismaMiddleware());
 *
 * app.get('/api/users', (c) => {
 *     const prisma = c.get('prisma');
 *     const users = await prisma.user.findMany();
 *     return c.json(users);
 * });
 * ```
 *
 * @see worker/lib/prisma.ts — PrismaClient factory
 * @see https://developers.cloudflare.com/hyperdrive/
 */

import { createMiddleware } from 'hono/factory';
import type { Env } from '../types.ts';
import { createPrismaClient } from '../lib/prisma.ts';
import type { PrismaClient } from '../../prisma/generated/client.ts';

// ============================================================================
// Hono context augmentation
// ============================================================================

/**
 * Variables stored in the Hono context by prismaMiddleware.
 * Merge into your app's Variables type to enable `c.get('prisma')`.
 */
export interface PrismaVariables {
    prisma: InstanceType<typeof PrismaClient>;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Hono middleware that creates a request-scoped PrismaClient via Hyperdrive.
 *
 * The client is stored in the Hono context under `'prisma'` and can be
 * retrieved by downstream handlers via `c.get('prisma')`.
 *
 * Requires `env.HYPERDRIVE` to be bound in wrangler.toml.
 *
 * @returns Hono middleware handler
 */
export function prismaMiddleware() {
    return createMiddleware<{ Bindings: Env; Variables: PrismaVariables }>(async (c, next) => {
        if (!c.env.HYPERDRIVE) {
            throw new Error('HYPERDRIVE binding is not configured');
        }
        const prisma = createPrismaClient(c.env.HYPERDRIVE.connectionString);
        c.set('prisma', prisma);
        await next();
    });
}

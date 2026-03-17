/**
 * PostgreSQL pool factory for Cloudflare Workers (Hyperdrive).
 *
 * Creates a lazily-initialised `pg` Pool connected via a Hyperdrive connection
 * string. The `pg` module is imported dynamically at first use so that it does
 * not affect cold-start parse time on routes that do not require a database.
 */

/**
 * Minimal pg Pool interface used by the Worker.
 */
export interface PgPool {
    query<T = Record<string, unknown>>(
        text: string,
        values?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * Creates a lazily-initialised PostgreSQL pool from a Hyperdrive connection string.
 *
 * @param connectionString - Hyperdrive connection string from `env.HYPERDRIVE.connectionString`
 * @returns A `PgPool` whose first `query()` call initialises the underlying `pg.Pool`.
 */
export function createPgPool(connectionString: string): PgPool {
    let pool: unknown = null;

    const ensurePool = async (): Promise<PgPool> => {
        if (!pool) {
            // Dynamic import of pg module - using variable to prevent esbuild static analysis
            // since pg is a Node.js module provided by the Workers runtime via Hyperdrive
            try {
                const moduleName = 'pg';
                const { Pool } = await import(/* @vite-ignore */ moduleName);
                pool = new Pool({ connectionString });
            } catch (error) {
                throw new Error(
                    `Failed to initialize PostgreSQL pool: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        return pool as PgPool;
    };

    return {
        async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
            const p = await ensurePool();
            return p.query(text, values) as Promise<{ rows: T[]; rowCount: number | null }>;
        },
    };
}

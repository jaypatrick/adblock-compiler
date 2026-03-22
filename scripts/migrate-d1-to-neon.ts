#!/usr/bin/env -S deno run -A
/**
 * @module migrate-d1-to-neon
 * One-time migration script: Cloudflare D1 → Neon PostgreSQL.
 *
 * Reads every migratable table from D1 via {@link CloudflareApiService}, transforms
 * rows to match the PostgreSQL schema, and batch-inserts into Neon via
 * {@link NeonApiService}. Idempotent — uses `ON CONFLICT DO NOTHING`.
 *
 * Usage:
 *   deno run -A scripts/migrate-d1-to-neon.ts              # live migration
 *   deno run -A scripts/migrate-d1-to-neon.ts --dry-run     # preview only
 *   deno run -A scripts/migrate-d1-to-neon.ts --verify-only  # compare counts
 *
 * Required env vars (or .env / .dev.vars):
 *   CF_API_TOKEN            Cloudflare API token (D1 read access)
 *   CF_ACCOUNT_ID           Cloudflare account ID
 *   D1_DATABASE_ID          Source D1 database UUID
 *   NEON_API_KEY            Neon admin API key
 *   NEON_CONNECTION_STRING   Target PostgreSQL connection string
 */

import { z } from 'zod';
import { CloudflareApiService } from '../src/services/cloudflareApiService.ts';
import { createNeonApiService } from '../src/services/neonApiService.ts';
import type { NeonApiService } from '../src/services/neonApiService.ts';
import type { D1QueryResult } from '../src/services/cloudflareApiService.ts';
import Cloudflare from 'cloudflare';

// ─── Configuration Schema ────────────────────────────────────────────────────

export const MigrationConfigSchema = z.object({
    cfApiToken: z.string().min(1, 'CF_API_TOKEN is required'),
    cfAccountId: z.string().min(1, 'CF_ACCOUNT_ID is required'),
    d1DatabaseId: z.string().min(1, 'D1_DATABASE_ID is required'),
    neonApiKey: z.string().min(1, 'NEON_API_KEY is required'),
    neonConnectionString: z.string().min(1, 'NEON_CONNECTION_STRING is required'),
    dryRun: z.boolean().default(false),
    verifyOnly: z.boolean().default(false),
    batchSize: z.number().int().positive().default(100),
});
export type MigrationConfig = z.infer<typeof MigrationConfigSchema>;

// ─── Logger ──────────────────────────────────────────────────────────────────

export interface MigrationLogger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

const consoleLogger: MigrationLogger = {
    info: (msg: string) => console.log(`[migrate] ${msg}`),
    warn: (msg: string) => console.warn(`[migrate] ⚠️  ${msg}`),
    error: (msg: string) => console.error(`[migrate] ❌ ${msg}`),
};

// ─── Row types (D1 source) ───────────────────────────────────────────────────

/** Generic row from D1 — untyped record. */
export type D1Row = Record<string, unknown>;

// ─── Table Definitions ───────────────────────────────────────────────────────

/**
 * Defines how a single D1 table maps to a PostgreSQL table.
 * - `d1Table`: SQL table name in D1
 * - `pgTable`: SQL table name in Neon (from Prisma @@map)
 * - `d1Query`: SELECT query to extract rows from D1
 * - `pgConflictColumn`: column name for ON CONFLICT DO NOTHING
 * - `transform`: optional function to transform a D1 row → PG row
 */
export interface TableDefinition {
    d1Table: string;
    pgTable: string;
    d1Query: string;
    pgConflictColumn: string;
    transform?: (row: D1Row) => D1Row;
}

/**
 * All tables to migrate, in dependency order (parents before children).
 * Each entry declares the D1 source query, PG target, and optional transform.
 */
export const TABLE_DEFINITIONS: TableDefinition[] = [
    {
        d1Table: 'users',
        pgTable: 'users',
        d1Query: 'SELECT * FROM users',
        pgConflictColumn: 'id',
    },
    {
        d1Table: 'api_keys',
        pgTable: 'api_keys',
        d1Query: 'SELECT * FROM api_keys',
        pgConflictColumn: 'id',
        transform: (row: D1Row): D1Row => {
            // D1 may store scopes as a comma-separated string; PG uses a text array.
            if (typeof row.scopes === 'string') {
                return { ...row, scopes: `{${row.scopes}}` };
            }
            return row;
        },
    },
    {
        d1Table: 'sessions',
        pgTable: 'sessions',
        d1Query: 'SELECT * FROM sessions',
        pgConflictColumn: 'id',
    },
    {
        d1Table: 'filter_sources',
        pgTable: 'filter_sources',
        d1Query: 'SELECT * FROM filter_sources',
        pgConflictColumn: 'id',
    },
    {
        d1Table: 'compiled_outputs',
        pgTable: 'compiled_outputs',
        d1Query: 'SELECT * FROM compiled_outputs',
        pgConflictColumn: 'id',
        transform: (row: D1Row): D1Row => {
            // D1 stores config_snapshot as a JSON string; PG JSONB expects an object.
            if (typeof row.config_snapshot === 'string') {
                try {
                    return { ...row, config_snapshot: JSON.parse(row.config_snapshot as string) };
                } catch {
                    // Leave as-is if parsing fails — the INSERT will surface the error.
                    return row;
                }
            }
            return row;
        },
    },
    {
        d1Table: 'compilation_events',
        pgTable: 'compilation_events',
        d1Query: 'SELECT * FROM compilation_events',
        pgConflictColumn: 'id',
        transform: (row: D1Row): D1Row => {
            // D1 stores booleans as 0/1; PG expects true/false.
            if (row.cache_hit !== undefined) {
                return { ...row, cache_hit: Boolean(row.cache_hit) };
            }
            return row;
        },
    },
    {
        d1Table: 'storage_entries',
        pgTable: 'storage_entries',
        d1Query: 'SELECT * FROM storage_entries',
        pgConflictColumn: 'id',
    },
    {
        d1Table: 'filter_cache',
        pgTable: 'filter_cache',
        d1Query: 'SELECT * FROM filter_cache',
        pgConflictColumn: 'id',
    },
    {
        d1Table: 'compilation_metadata',
        pgTable: 'compilation_metadata',
        d1Query: 'SELECT * FROM compilation_metadata',
        pgConflictColumn: 'id',
    },
];

// ─── Batch Helpers ───────────────────────────────────────────────────────────

/** Split an array into chunks of `size`. */
export function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

/**
 * Build a parameterized INSERT ... ON CONFLICT DO NOTHING statement.
 * Returns `{ sql, params }` ready for `NeonApiService.querySQL()`.
 */
export function buildBatchInsert(
    tableName: string,
    rows: D1Row[],
    conflictColumn: string,
): { sql: string; params: unknown[] } {
    if (rows.length === 0) {
        return { sql: '', params: [] };
    }

    const columns = Object.keys(rows[0]);
    const params: unknown[] = [];
    const valueClauses: string[] = [];

    for (const row of rows) {
        const placeholders: string[] = [];
        for (const col of columns) {
            params.push(row[col] ?? null);
            placeholders.push(`$${params.length}`);
        }
        valueClauses.push(`(${placeholders.join(', ')})`);
    }

    const quotedColumns = columns.map((c) => `"${c}"`).join(', ');
    const sql = `INSERT INTO "${tableName}" (${quotedColumns}) VALUES ${valueClauses.join(', ')} ON CONFLICT ("${conflictColumn}") DO NOTHING`;

    return { sql, params };
}

// ─── Core Migration Logic ────────────────────────────────────────────────────

export interface MigrationResult {
    table: string;
    d1Count: number;
    pgInserted: number;
    skipped: number;
    durationMs: number;
    errors: string[];
}

/**
 * Migrate a single table from D1 → Neon.
 */
export async function migrateTable(
    def: TableDefinition,
    cfService: CloudflareApiService,
    neonService: NeonApiService,
    config: MigrationConfig,
    logger: MigrationLogger = consoleLogger,
): Promise<MigrationResult> {
    const start = performance.now();
    const result: MigrationResult = {
        table: def.d1Table,
        d1Count: 0,
        pgInserted: 0,
        skipped: 0,
        durationMs: 0,
        errors: [],
    };

    try {
        // 1. Read from D1
        logger.info(`Reading ${def.d1Table} from D1...`);
        let d1Result: D1QueryResult<D1Row>;
        try {
            d1Result = await cfService.queryD1<D1Row>(
                config.cfAccountId,
                config.d1DatabaseId,
                def.d1Query,
            );
        } catch (err) {
            // Table may not exist in D1 — treat as empty
            logger.warn(`Table ${def.d1Table} not found in D1 or query failed: ${err}`);
            result.durationMs = Math.round(performance.now() - start);
            return result;
        }

        const rows = d1Result.result ?? [];
        result.d1Count = rows.length;
        logger.info(`  → ${rows.length} rows in D1`);

        if (rows.length === 0) {
            result.durationMs = Math.round(performance.now() - start);
            return result;
        }

        // 2. Transform
        const transformed = def.transform ? rows.map(def.transform) : rows;

        // 3. Dry-run — just report
        if (config.dryRun) {
            logger.info(`  → [DRY RUN] Would insert ${transformed.length} rows into ${def.pgTable}`);
            result.pgInserted = 0;
            result.durationMs = Math.round(performance.now() - start);
            return result;
        }

        // 4. Batch insert into Neon
        const batches = chunkArray(transformed, config.batchSize);
        logger.info(`  → Inserting ${transformed.length} rows in ${batches.length} batch(es)...`);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const { sql, params } = buildBatchInsert(def.pgTable, batch, def.pgConflictColumn);

            if (!sql) continue;

            try {
                await neonService.querySQL(config.neonConnectionString, sql, params);
                result.pgInserted += batch.length;
            } catch (err) {
                const msg = `Batch ${i + 1}/${batches.length} for ${def.pgTable} failed: ${err}`;
                logger.error(msg);
                result.errors.push(msg);
            }
        }

        logger.info(`  → Inserted ${result.pgInserted}/${transformed.length} rows`);
        result.skipped = transformed.length - result.pgInserted;
    } catch (err) {
        result.errors.push(`Unexpected error migrating ${def.d1Table}: ${err}`);
        logger.error(result.errors[result.errors.length - 1]);
    }

    result.durationMs = Math.round(performance.now() - start);
    return result;
}

/**
 * Verify row counts between D1 and Neon for all tables.
 */
export async function verifyMigration(
    cfService: CloudflareApiService,
    neonService: NeonApiService,
    config: MigrationConfig,
    logger: MigrationLogger = consoleLogger,
): Promise<void> {
    logger.info('═══ Verifying migration row counts ═══');

    for (const def of TABLE_DEFINITIONS) {
        let d1Count = 0;
        let pgCount = 0;

        try {
            const d1Result = await cfService.queryD1<{ count: number }>(
                config.cfAccountId,
                config.d1DatabaseId,
                `SELECT COUNT(*) as count FROM ${def.d1Table}`,
            );
            d1Count = d1Result.result[0]?.count ?? 0;
        } catch {
            logger.warn(`  ${def.d1Table}: D1 table not found or query failed`);
        }

        try {
            const pgResult = await neonService.querySQL<{ count: string }>(
                config.neonConnectionString,
                `SELECT COUNT(*) as count FROM "${def.pgTable}"`,
            );
            pgCount = parseInt(pgResult[0]?.count ?? '0', 10);
        } catch {
            logger.warn(`  ${def.pgTable}: Neon table not found or query failed`);
        }

        const status = d1Count === pgCount ? '✅' : '⚠️';
        logger.info(`  ${status} ${def.d1Table}: D1=${d1Count}  Neon=${pgCount}`);
    }
}

/**
 * Run the full migration for all tables.
 */
export async function runMigration(
    config: MigrationConfig,
    logger: MigrationLogger = consoleLogger,
): Promise<MigrationResult[]> {
    logger.info('═══ D1 → Neon PostgreSQL Migration ═══');
    logger.info(`Mode: ${config.dryRun ? 'DRY RUN' : config.verifyOnly ? 'VERIFY ONLY' : 'LIVE'}`);
    logger.info(`Batch size: ${config.batchSize}`);

    // Initialize services
    const cfClient = new Cloudflare({ apiToken: config.cfApiToken });
    const cfService = new CloudflareApiService(cfClient, {
        info: (msg: string) => logger.info(`  [CF] ${msg}`),
        warn: (msg: string) => logger.warn(`  [CF] ${msg}`),
        error: (msg: string) => logger.error(`  [CF] ${msg}`),
    });

    const neonService = createNeonApiService({ apiKey: config.neonApiKey }, {
        info: (msg: string) => logger.info(`  [Neon] ${msg}`),
        warn: (msg: string) => logger.warn(`  [Neon] ${msg}`),
        error: (msg: string) => logger.error(`  [Neon] ${msg}`),
    });

    // Verify-only mode
    if (config.verifyOnly) {
        await verifyMigration(cfService, neonService, config, logger);
        return [];
    }

    // Migrate each table in order
    const results: MigrationResult[] = [];
    const overallStart = performance.now();

    for (const def of TABLE_DEFINITIONS) {
        const result = await migrateTable(def, cfService, neonService, config, logger);
        results.push(result);
    }

    // Summary
    const overallMs = Math.round(performance.now() - overallStart);
    const totalD1 = results.reduce((sum, r) => sum + r.d1Count, 0);
    const totalPg = results.reduce((sum, r) => sum + r.pgInserted, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    logger.info('');
    logger.info('═══ Migration Summary ═══');
    logger.info(`Total D1 rows:     ${totalD1}`);
    logger.info(`Total PG inserted: ${totalPg}`);
    logger.info(`Total errors:      ${totalErrors}`);
    logger.info(`Duration:          ${overallMs}ms`);

    if (totalErrors > 0) {
        logger.warn('Some batches failed — re-run the script to retry (idempotent via ON CONFLICT DO NOTHING).');
    }

    return results;
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

if (import.meta.main) {
    const args = new Set(Deno.args);
    const dryRun = args.has('--dry-run');
    const verifyOnly = args.has('--verify-only');

    const configResult = MigrationConfigSchema.safeParse({
        cfApiToken: Deno.env.get('CF_API_TOKEN'),
        cfAccountId: Deno.env.get('CF_ACCOUNT_ID'),
        d1DatabaseId: Deno.env.get('D1_DATABASE_ID'),
        neonApiKey: Deno.env.get('NEON_API_KEY'),
        neonConnectionString: Deno.env.get('NEON_CONNECTION_STRING'),
        dryRun,
        verifyOnly,
    });

    if (!configResult.success) {
        console.error('❌ Invalid configuration:');
        for (const issue of configResult.error.issues) {
            console.error(`   ${issue.path.join('.')}: ${issue.message}`);
        }
        Deno.exit(1);
    }

    const results = await runMigration(configResult.data);
    const hasErrors = results.some((r) => r.errors.length > 0);
    Deno.exit(hasErrors ? 1 : 0);
}

import process from 'node:process';
import { defineConfig } from 'prisma/config';

// Prefer DIRECT_DATABASE_URL for migrations (bypasses connection pooling).
// Fall back to DATABASE_URL. Set these in .env.local (see .env.example).
// Run `cp .env.example .env.local` and fill in your connection strings.
// Use || (not ??) so that empty/whitespace-only values are treated as unset.
const datasourceUrl = process.env.DIRECT_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();

// Only validate when running against the Postgres schema (not the D1 schema).
// Commands like `prisma generate --schema=prisma/schema.d1.prisma` do not
// require a Postgres datasource URL and must not be blocked by this check.
const isD1Schema = process.argv.some(
    (arg, i) => arg === '--schema' && process.argv[i + 1]?.endsWith('schema.d1.prisma'),
);

if (!datasourceUrl && !isD1Schema) {
    throw new Error(
        'Database URL is not configured.\n' +
            '  Set DIRECT_DATABASE_URL or DATABASE_URL in .env.local\n' +
            '  → cp .env.example .env.local   # then fill in your Neon connection string\n' +
            '  → See docs/database-setup/neon-setup.md for details',
    );
}

export default defineConfig({
    schema: './prisma/schema.prisma',
    migrations: {
        path: './prisma/migrations',
    },
    datasource: {
        url: datasourceUrl,
    },
});

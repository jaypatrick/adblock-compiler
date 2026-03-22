import process from 'node:process';
import { defineConfig } from 'prisma/config';

// Prefer DIRECT_DATABASE_URL for migrations (bypasses connection pooling).
// Fall back to DATABASE_URL. Set these in .env.local (see .env.example).
// Run `cp .env.example .env.local` and fill in your connection strings.
// Use || (not ??) so that empty/whitespace-only values are treated as unset.
const datasourceUrl = process.env.DIRECT_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();

if (!datasourceUrl) {
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

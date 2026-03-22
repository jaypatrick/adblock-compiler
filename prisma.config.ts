import process from 'node:process';
import { defineConfig } from 'prisma/config';

// Prefer DIRECT_DATABASE_URL for migrations (bypasses connection pooling).
// Fall back to DATABASE_URL. Set these in .env.local (see .env.example).
// Run `cp .env.example .env.local` and fill in your connection strings.
// Use || (not ??) so that empty/whitespace-only values are treated as unset.
const datasourceUrl =
    process.env.DIRECT_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim();

export default defineConfig({
    schema: './prisma/schema.prisma',
    migrations: {
        path: './prisma/migrations',
    },
    datasource: {
        url: datasourceUrl,
    },
});

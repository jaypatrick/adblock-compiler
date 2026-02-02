import { defineConfig } from 'prisma/config';

export default defineConfig({
    schema: './schema.prisma',
    migrations: {
        path: './migrations',
    },
    datasource: {
        // Default to PostgreSQL connection
        // Override with DATABASE_URL environment variable
        url: process.env.DIRECT_DATABASE_URL ?? 'postgresql://adblock:adblock@localhost:5432/adblock',
    },
});

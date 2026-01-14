import type { Config } from '@prisma/client';

const config: Config = {
    datasourceUrl: Deno.env.get('DATABASE_URL') || 'file:./dev.db',
};

export default config;

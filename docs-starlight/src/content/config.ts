import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob } from 'astro/loaders';

// Load docs directly from the shared ../docs/ tree (no file copying).
// The glob base is resolved relative to this package root (docs-starlight/).
export const collections = {
    docs: defineCollection({
        loader: glob({ pattern: '**/*.{md,mdx}', base: '../../docs' }),
        schema: docsSchema(),
    }),
};

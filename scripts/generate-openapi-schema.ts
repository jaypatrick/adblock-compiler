#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --sloppy-imports

/**
 * Generate OpenAPI schema from the Hono app's OpenAPIHono registry.
 *
 * Writes the generated spec (JSON) to docs/api/cloudflare-openapi.json
 * and also writes docs/api/cloudflare-openapi-generated.yaml from the same source.
 *
 * Usage: deno task generate:schema
 */

import { stringify } from '@std/yaml';
import { app } from '../worker/hono-app.ts';

const OPENAPI_INFO = {
    openapi: '3.0.0' as const,
    info: {
        title: 'Adblock Compiler API',
        version: '2.0.0',
        description:
            'Compiler-as-a-Service for adblock filter lists. Transform, optimize, and combine filter lists from multiple sources with real-time progress tracking.',
        license: {
            name: 'GPL-3.0',
            url: 'https://github.com/jaypatrick/adblock-compiler/blob/master/LICENSE',
        },
        contact: {
            name: 'Jayson Knight',
            url: 'https://github.com/jaypatrick/adblock-compiler',
        },
    },
    servers: [
        {
            url: 'https://adblock-compiler.jayson-knight.workers.dev',
            description: 'Production server',
        },
    ],
};

// Make a request to the app to get the generated OpenAPI spec.
// The /api/openapi.json endpoint is unauthenticated and public.
const request = new Request('http://localhost/api/openapi.json');
const ctx = {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
} as ExecutionContext;

// Minimal env to satisfy the middleware (no auth secrets configured → uses anonymous context)
// deno-lint-ignore no-explicit-any
const env: any = {
    COMPILER_VERSION: '2.0.0',
    COMPILATION_CACHE: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [] }),
        getWithMetadata: async () => ({ value: null, metadata: null }),
    },
    RATE_LIMIT: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [] }),
        getWithMetadata: async () => ({ value: null, metadata: null }),
    },
    METRICS: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [] }),
        getWithMetadata: async () => ({ value: null, metadata: null }),
    },
};

const response = await app.fetch(request, env, ctx);

if (!response.ok) {
    console.error(`❌ Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
    const body = await response.text();
    console.error(body);
    Deno.exit(1);
}

// deno-lint-ignore no-explicit-any
const spec: any = await response.json();

// Merge in the canonical info block (the endpoint serves whatever OpenAPIHono
// has registered; we overlay the authoritative metadata here).
const fullSpec = { ...OPENAPI_INFO, ...spec, info: OPENAPI_INFO.info, servers: OPENAPI_INFO.servers };

// Write JSON output
const jsonPath = './docs/api/cloudflare-openapi.json';
await Deno.writeTextFile(jsonPath, JSON.stringify(fullSpec, null, 2));
console.log(`✅ Written OpenAPI JSON to ${jsonPath}`);

// Write YAML output (append header comment)
const yamlContent = `# Auto-generated OpenAPI schema from Hono OpenAPIHono registry\n# Run 'deno task generate:schema' to regenerate\n# DO NOT EDIT DIRECTLY\n\n${stringify(fullSpec)}`;
const yamlPath = './docs/api/cloudflare-openapi-generated.yaml';
await Deno.writeTextFile(yamlPath, yamlContent);
console.log(`✅ Written OpenAPI YAML to ${yamlPath}`);

console.log(`\nℹ️  The full handcrafted spec is at docs/api/cloudflare-schema.yaml`);
console.log(`   To replace it with the generated spec, run:`);
console.log(`   cp ${yamlPath} docs/api/cloudflare-schema.yaml`);

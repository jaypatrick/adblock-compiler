#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Cloudflare API Shield Schema Generator
 *
 * Generates a Cloudflare-compatible schema from the OpenAPI specification.
 * Filters out localhost servers and removes non-standard x-* extensions.
 */

import { parse, stringify } from '@std/yaml';
import { existsSync } from '@std/fs';

const OPENAPI_PATH = './docs/api/openapi.yaml';
const OUTPUT_PATH = './docs/api/cloudflare-schema.yaml';

interface OpenAPIInfo {
    title: string;
    version: string;
    description?: string;
    license?: {
        name: string;
        url?: string;
    };
    contact?: {
        name?: string;
        url?: string;
        email?: string;
    };
}

interface OpenAPIServer {
    url: string;
    description?: string;
}

interface OpenAPISpec {
    openapi: string;
    info: OpenAPIInfo;
    servers?: OpenAPIServer[];
    paths: Record<string, any>;
    components?: {
        schemas?: Record<string, any>;
        securitySchemes?: Record<string, any>;
        [key: string]: any;
    };
    tags?: Array<{
        name: string;
        description?: string;
    }>;
    [key: string]: any;
}

async function generateCloudflareSchema(): Promise<void> {
    console.log('🚀 Generating Cloudflare API Shield schema...\n');

    // Check if source file exists
    if (!existsSync(OPENAPI_PATH)) {
        console.error(`❌ OpenAPI file not found: ${OPENAPI_PATH}`);
        Deno.exit(1);
    }

    // Read and parse OpenAPI spec
    let spec: OpenAPISpec;
    try {
        const content = await Deno.readTextFile(OPENAPI_PATH);
        spec = parse(content) as OpenAPISpec;
        console.log('✅ Loaded OpenAPI specification');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to parse OpenAPI file: ${errorMessage}`);
        Deno.exit(1);
    }

    // Filter servers - remove localhost entries
    if (spec.servers && spec.servers.length > 0) {
        const originalCount = spec.servers.length;
        spec.servers = spec.servers.filter((server) => {
            return !server.url.startsWith('http://localhost');
        });
        const filteredCount = originalCount - spec.servers.length;
        console.log(`✅ Filtered servers: kept ${spec.servers.length}, removed ${filteredCount} localhost server(s)`);
    }

    // Remove x-* extensions from path operations
    let extensionsRemoved = 0;
    const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

    for (const [_path, pathItem] of Object.entries(spec.paths)) {
        for (const method of httpMethods) {
            if (pathItem[method]) {
                const operation = pathItem[method];
                const extensionKeys = Object.keys(operation).filter((key) => key.startsWith('x-'));

                for (const key of extensionKeys) {
                    delete operation[key];
                    extensionsRemoved++;
                }
            }
        }
    }

    if (extensionsRemoved > 0) {
        console.log(`✅ Removed ${extensionsRemoved} x-* extension(s) from operations`);
    } else {
        console.log('✅ No x-* extensions found in operations');
    }

    // Add header comment
    const header = `# Auto-generated Cloudflare API Shield Schema
# Generated from docs/api/openapi.yaml
# Run 'deno task schema:cloudflare' to regenerate
# DO NOT EDIT DIRECTLY

`;

    // Convert back to YAML
    try {
        const yamlContent = stringify(spec, {
            indent: 4,
            lineWidth: 120,
            sortKeys: false,
        });
        const outputContent = header + yamlContent;
        await Deno.writeTextFile(OUTPUT_PATH, outputContent);
        console.log(`✅ Generated Cloudflare schema: ${OUTPUT_PATH}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to write output file: ${errorMessage}`);
        Deno.exit(1);
    }

    console.log('\n🎉 Cloudflare schema generation complete!\n');
}

if (import.meta.main) {
    try {
        await generateCloudflareSchema();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Unexpected error: ${errorMessage}`);
        Deno.exit(1);
    }
}

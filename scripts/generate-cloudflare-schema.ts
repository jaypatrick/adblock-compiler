#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Cloudflare API Shield Schema Generator
 *
 * Generates a Cloudflare-compatible schema from the OpenAPI specification.
 * Filters out localhost servers and removes non-standard x-* extensions.
 */

import { parse, stringify } from '@std/yaml';
import { existsSync } from '@std/fs';
import { findInvalid2xx, HTTP_METHODS, inject2xxStubs } from './schema-2xx-helpers.ts';

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

/**
 * Walk the spec and return every local JSON-pointer `$ref` (starting with `#/`)
 * that cannot be resolved within the document.
 *
 * @param spec - The parsed OpenAPI spec object.
 * @returns An array of unresolved ref strings.
 */
function validateLocalRefs(spec: OpenAPISpec): string[] {
    const unresolvedRefs: string[] = [];
    const seen = new Set<string>();

    function resolvePointer(pointer: string): boolean {
        // pointer = "#/components/responses/ForbiddenError"
        // Per RFC 6901 §3, each segment must be unescaped: ~1 → / then ~0 → ~
        const segments = pointer.slice(2).split('/').map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
        let current: unknown = spec;
        for (const segment of segments) {
            if (current == null || typeof current !== 'object') {
                return false;
            }
            current = (current as Record<string, unknown>)[segment];
        }
        return current !== undefined;
    }

    function walk(node: unknown): void {
        if (node == null || typeof node !== 'object') {
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) {
                walk(item);
            }
            return;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key === '$ref' && typeof value === 'string' && value.startsWith('#/')) {
                if (!seen.has(value)) {
                    seen.add(value);
                    if (!resolvePointer(value)) {
                        unresolvedRefs.push(value);
                    }
                }
            } else {
                walk(value);
            }
        }
    }

    walk(spec);
    return unresolvedRefs;
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

    for (const [_path, pathItem] of Object.entries(spec.paths)) {
        for (const method of HTTP_METHODS) {
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

    // Inject stub 2xx responses for operations that are missing them.
    // Cloudflare API Shield ignores operations without a 2xx response, causing those
    // endpoints to not appear in the dashboard. We patch the generated schema so every
    // operation has at least a stub 200 response, and we print a summary so operators
    // know which endpoints need to be fixed in the upstream openapi.yaml.
    const patchedOps = inject2xxStubs(spec, HTTP_METHODS);
    if (patchedOps.length > 0) {
        console.log(
            `\n⚠️  Patched ${patchedOps.length} operation(s) with stub 2xx response or schema (fix upstream openapi.yaml):`,
        );
        for (const op of patchedOps) {
            console.log(`   • ${op}`);
        }
    } else {
        console.log('✅ All operations have valid 2xx responses');
    }

    // Post-patch validation: fail loudly if any operation is still missing a valid 2xx
    // with application/json schema.  Guards against regressions in the patch logic itself.
    const stillMissing = findInvalid2xx(spec, HTTP_METHODS);
    if (stillMissing.length > 0) {
        console.error(`\n❌ ${stillMissing.length} operation(s) still missing a valid 2xx response after patching:`);
        for (const op of stillMissing) {
            console.error(`   • ${op}`);
        }
        Deno.exit(1);
    }

    // Validate all local $refs resolve within the document
    const unresolvedRefs = validateLocalRefs(spec);
    if (unresolvedRefs.length > 0) {
        console.error('❌ Unresolved local $ref(s) found in OpenAPI spec:');
        for (const ref of unresolvedRefs) {
            console.error(`   ${ref}`);
        }
        console.error('Fix the missing definitions before regenerating the schema.');
        Deno.exit(1);
    }
    console.log('✅ All local $refs resolve correctly');

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

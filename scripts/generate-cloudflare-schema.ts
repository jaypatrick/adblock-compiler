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

// ---------------------------------------------------------------------------
// 2xx response helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether an operation's responses map contains at least one 2xx code.
 *
 * @param responses - The `responses` object from an OpenAPI operation.
 * @returns `true` if any key parses to an integer in [200, 299].
 */
function has2xxResponse(responses: Record<string, unknown> | undefined): boolean {
    if (!responses) {
        return false;
    }
    return Object.keys(responses).some((code) => {
        const num = parseInt(code, 10);
        return num >= 200 && num < 300;
    });
}

/**
 * Walk all operations in `spec.paths` and inject a minimal stub 200 response
 * wherever a 2xx response is absent.  When a 2xx response exists but its
 * `application/json` media type is missing `content` or `schema`, fill that
 * in too so Cloudflare API Shield can parse and display the endpoint.
 *
 * @param spec       - The (mutated in-place) OpenAPI specification object.
 * @param methods    - HTTP method names to inspect.
 * @returns A list of human-readable strings describing each patched operation.
 */
function inject2xxStubs(spec: OpenAPISpec, methods: string[]): string[] {
    const patched: string[] = [];
    const STUB_RESPONSE = {
        description: 'OK',
        content: { 'application/json': { schema: { type: 'object' } } },
    };

    for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const method of methods) {
            // deno-lint-ignore no-explicit-any
            const operation: Record<string, any> | undefined = pathItem[method];
            if (!operation) {
                continue;
            }

            // deno-lint-ignore no-explicit-any
            const responses: Record<string, any> = operation.responses ?? {};

            if (!has2xxResponse(responses)) {
                // No 2xx at all — inject a stub 200.
                operation.responses = { ...responses, '200': STUB_RESPONSE };
                patched.push(`${method.toUpperCase()} ${path} (injected stub 200)`);
                continue;
            }

            // A 2xx exists.  Check that its application/json entry has a schema.
            for (const [code, response] of Object.entries(responses)) {
                const num = parseInt(code, 10);
                if (num < 200 || num >= 300) {
                    continue;
                }
                // deno-lint-ignore no-explicit-any
                const resp = response as Record<string, any>;
                if (!resp.content) {
                    resp.content = { 'application/json': { schema: { type: 'object' } } };
                    patched.push(`${method.toUpperCase()} ${path} (injected content into ${code})`);
                } else if (resp.content['application/json'] && !resp.content['application/json'].schema) {
                    resp.content['application/json'].schema = { type: 'object' };
                    patched.push(`${method.toUpperCase()} ${path} (injected schema into ${code})`);
                }
                break; // Only patch the first 2xx response.
            }
        }
    }

    return patched;
}

/**
 * Return a list of `"METHOD /path"` strings for every operation that still
 * lacks a 2xx response.  Used as a post-patch sanity check.
 *
 * @param spec    - The OpenAPI specification object to inspect.
 * @param methods - HTTP method names to inspect.
 * @returns An array of operation identifiers missing a 2xx response.
 */
function findMissing2xx(spec: OpenAPISpec, methods: string[]): string[] {
    const missing: string[] = [];
    for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const method of methods) {
            // deno-lint-ignore no-explicit-any
            const operation: Record<string, any> | undefined = pathItem[method];
            if (!operation) {
                continue;
            }
            if (!has2xxResponse(operation.responses)) {
                missing.push(`${method.toUpperCase()} ${path}`);
            }
        }
    }
    return missing;
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

    // Inject stub 2xx responses for operations that are missing them.
    // Cloudflare API Shield ignores operations without a 2xx response, causing those
    // endpoints to not appear in the dashboard. We patch the generated schema so every
    // operation has at least a stub 200 response, and we print a summary so operators
    // know which endpoints need to be fixed in the upstream openapi.yaml.
    const patchedOps = inject2xxStubs(spec, httpMethods);
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

    // Post-patch validation: fail loudly if any operation is still missing a 2xx response.
    const stillMissing = findMissing2xx(spec, httpMethods);
    if (stillMissing.length > 0) {
        console.error(`\n❌ ${stillMissing.length} operation(s) still missing a 2xx response after patching:`);
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

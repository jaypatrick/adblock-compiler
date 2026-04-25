#!/usr/bin/env -S deno run --allow-read

/**
 * @module check-schema-2xx
 * CI guard: fail if any operation in cloudflare-schema.yaml is missing a 2xx response.
 *
 * Cloudflare API Shield silently ignores operations that have no 2xx response, which
 * causes those endpoints to disappear from the dashboard endpoint list.  This script
 * reads the already-generated cloudflare-schema.yaml (produced by
 * `deno task schema:cloudflare` / `deno task schema:sync`) and exits with a non-zero
 * status if any operation still lacks a success response, giving CI a hard failure
 * with an actionable message.
 *
 * Usage:
 *   deno task schema:check:2xx
 *
 * The schema must be regenerated before running this check:
 *   deno task schema:cloudflare && deno task schema:check:2xx
 */

import { parse } from '@std/yaml';
import { existsSync } from '@std/fs';

const SCHEMA_PATH = './docs/api/cloudflare-schema.yaml';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

interface OpenAPISpec {
    // deno-lint-ignore no-explicit-any
    paths: Record<string, Record<string, any>>;
    [key: string]: unknown;
}

/**
 * Return `true` if the responses map contains at least one HTTP 2xx status code.
 *
 * @param responses - The `responses` object from an OpenAPI operation.
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
 * Collect every `"METHOD /path"` string where the operation has no 2xx response.
 *
 * @param spec - Parsed OpenAPI specification.
 */
function collectMissing2xx(spec: OpenAPISpec): string[] {
    const missing: string[] = [];
    for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const method of HTTP_METHODS) {
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

async function main(): Promise<void> {
    console.log('🔍 Checking cloudflare-schema.yaml for missing 2xx responses...\n');

    if (!existsSync(SCHEMA_PATH)) {
        console.error(`❌ Schema file not found: ${SCHEMA_PATH}`);
        console.error('   Run "deno task schema:cloudflare" to generate it first.');
        Deno.exit(1);
    }

    let spec: OpenAPISpec;
    try {
        const content = await Deno.readTextFile(SCHEMA_PATH);
        spec = parse(content) as OpenAPISpec;
    } catch (err) {
        console.error(`❌ Failed to parse ${SCHEMA_PATH}: ${err instanceof Error ? err.message : String(err)}`);
        Deno.exit(1);
    }

    if (!spec.paths || Object.keys(spec.paths).length === 0) {
        console.error(`❌ No paths found in ${SCHEMA_PATH}`);
        Deno.exit(1);
    }

    const missing = collectMissing2xx(spec);

    if (missing.length === 0) {
        const pathCount = Object.keys(spec.paths).length;
        console.log(`✅ All operations in ${SCHEMA_PATH} have a valid 2xx response.`);
        console.log(`   Checked ${pathCount} path(s).`);
        return;
    }

    console.error(`❌ ${missing.length} operation(s) in ${SCHEMA_PATH} are missing a 2xx response.`);
    console.error('   Cloudflare API Shield will ignore these endpoints.\n');
    console.error('   Affected operations:');
    for (const op of missing) {
        console.error(`     • ${op}`);
    }
    console.error('');
    console.error('   Fix: add a 2xx response to each operation in docs/api/openapi.yaml,');
    console.error('   then re-run "deno task schema:cloudflare" to regenerate the schema.');
    console.error('   The generator will also auto-inject stub responses; commit the result.');
    Deno.exit(1);
}

if (import.meta.main) {
    await main();
}

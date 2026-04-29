#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * @module sync-api-assets
 * Full API asset sync pipeline.
 *
 * Run this any time openapi.yaml changes:
 *   1. Regenerate cloudflare-schema.yaml from openapi.yaml
 *      (same logic as deno task schema:cloudflare)
 *   2. Validate openapi.yaml
 *      (same logic as deno task openapi:validate)
 *   3. Upload cloudflare-schema.yaml to Cloudflare API Shield via CloudflareApiService
 *      (same logic as deno task schema:upload, with --skip-if-unchanged by default)
 *   4. Regenerate Postman collection
 *      (same logic as deno task postman:collection)
 *
 * Required env vars (for upload step):
 *   CLOUDFLARE_ZONE_ID           — 32-char hex zone ID
 *   CLOUDFLARE_API_SHIELD_TOKEN  — API Gateway: Edit scoped token
 *
 * Flags:
 *   --dry-run            Simulate all steps without writing files or calling APIs.
 *   --skip-upload        Skip the Cloudflare API Shield upload (generate + validate only).
 *   --skip-if-unchanged  Skip upload if the local schema hash matches the live schema.
 *                        Enabled by default (pass --no-skip-if-unchanged to force upload).
 */

import { parseArgs } from '@std/cli/parse-args';
import { existsSync } from '@std/fs';
import { parse, stringify } from '@std/yaml';
import { z } from 'zod';
import { createCloudflareApiService } from '../src/services/cloudflareApiService.ts';
import type { ApiShieldOperation, ApiShieldOperationInput, ApiShieldSchema } from '../src/services/cloudflareApiService.ts';
import { findInvalid2xx, HTTP_METHODS, inject2xxStubs } from './schema-2xx-helpers.ts';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const OPENAPI_PATH = './docs/api/openapi.yaml';
const CLOUDFLARE_SCHEMA_PATH = './docs/api/cloudflare-schema.yaml';
const COLLECTION_OUTPUT_PATH = './docs/postman/postman-collection.json';
const ENVIRONMENT_LOCAL_OUTPUT_PATH = './docs/postman/postman-environment-local.json';
const ENVIRONMENT_PROD_OUTPUT_PATH = './docs/postman/postman-environment-prod.json';
/** Legacy alias — same content as the local environment. Keeps existing CI/Newman commands working. */
const ENVIRONMENT_OUTPUT_PATH = './docs/postman/postman-environment.json';
const SCHEMA_NAME = 'adblock-compiler-openapi';

// ---------------------------------------------------------------------------
// Env schema (upload step only)
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
    CLOUDFLARE_ZONE_ID: z
        .string({ error: 'CLOUDFLARE_ZONE_ID environment variable is required' })
        .regex(/^[a-f0-9]{32}$/i, 'CLOUDFLARE_ZONE_ID must be a 32-character hex string'),
    CLOUDFLARE_API_SHIELD_TOKEN: z
        .string({ error: 'CLOUDFLARE_API_SHIELD_TOKEN environment variable is required' })
        .min(1, 'CLOUDFLARE_API_SHIELD_TOKEN must not be empty'),
});

// ---------------------------------------------------------------------------
// OpenAPI type stubs (shared by generate and validate steps)
// ---------------------------------------------------------------------------

interface OpenAPIServer {
    url: string;
    description?: string;
}

interface OpenAPIInfo {
    title: string;
    version: string;
    description?: string;
    license?: { name: string; url?: string };
    contact?: { name?: string; url?: string; email?: string };
}

// deno-lint-ignore no-explicit-any
interface OpenAPISpec {
    openapi: string;
    info: OpenAPIInfo;
    servers?: OpenAPIServer[];
    // deno-lint-ignore no-explicit-any
    paths: Record<string, any>;
    components?: {
        // deno-lint-ignore no-explicit-any
        schemas?: Record<string, any>;
        // deno-lint-ignore no-explicit-any
        securitySchemes?: Record<string, any>;
        // deno-lint-ignore no-explicit-any
        [key: string]: any;
    };
    tags?: Array<{ name: string; description?: string }>;
    // deno-lint-ignore no-explicit-any
    [key: string]: any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a hex-encoded SHA-256 digest of a UTF-8 string.
 */
async function sha256Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Walk the spec and return every local JSON-pointer $ref that cannot be resolved.
 */
function validateLocalRefs(spec: OpenAPISpec): string[] {
    const unresolvedRefs: string[] = [];
    const seen = new Set<string>();

    function resolvePointer(pointer: string): boolean {
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
// Step 1: Generate Cloudflare schema
// ---------------------------------------------------------------------------

async function stepGenerateCloudflareSchema(dryRun: boolean): Promise<void> {
    console.log('\n─── Step 1: Generate Cloudflare schema ────────────────────\n');

    if (!existsSync(OPENAPI_PATH)) {
        throw new Error(`OpenAPI file not found: ${OPENAPI_PATH}`);
    }

    const content = await Deno.readTextFile(OPENAPI_PATH);
    const spec = parse(content) as OpenAPISpec;
    console.log('✅ Loaded OpenAPI specification');

    // Filter out localhost servers
    if (spec.servers && spec.servers.length > 0) {
        const originalCount = spec.servers.length;
        spec.servers = spec.servers.filter((server) => !server.url.startsWith('http://localhost'));
        const removed = originalCount - spec.servers.length;
        console.log(`✅ Filtered servers: kept ${spec.servers.length}, removed ${removed} localhost server(s)`);
    }

    // Remove x-* extensions from operations
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
    console.log(extensionsRemoved > 0 ? `✅ Removed ${extensionsRemoved} x-* extension(s)` : '✅ No x-* extensions found');

    // Inject stub 2xx responses for operations that are missing them.
    // Cloudflare API Shield ignores operations without a 2xx response, causing those
    // endpoints to not appear in the dashboard. We patch the generated schema so every
    // operation has at least a stub 200 response, and print a summary so operators know
    // which endpoints need to be fixed in the upstream openapi.yaml.
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
        const list = stillMissing.map((op) => `  • ${op}`).join('\n');
        throw new Error(
            `[CI FAIL] ${stillMissing.length} operation(s) still missing a valid 2xx response after patching.\n` +
                `Fix these in openapi.yaml or extend the patch logic:\n${list}`,
        );
    }

    // Validate local $refs
    const unresolvedRefs = validateLocalRefs(spec);
    if (unresolvedRefs.length > 0) {
        throw new Error(`Unresolved $ref(s):\n${unresolvedRefs.map((r) => `  ${r}`).join('\n')}`);
    }
    console.log('✅ All local $refs resolve correctly');

    if (dryRun) {
        console.log('🔍 Dry-run: would write', CLOUDFLARE_SCHEMA_PATH);
        return;
    }

    const header =
        `# Auto-generated Cloudflare API Shield Schema\n# Generated from docs/api/openapi.yaml\n# Run 'deno task schema:cloudflare' to regenerate\n# DO NOT EDIT DIRECTLY\n\n`;
    const yamlContent = stringify(spec, { indent: 4, lineWidth: 120, sortKeys: false });
    await Deno.writeTextFile(CLOUDFLARE_SCHEMA_PATH, header + yamlContent);
    console.log(`✅ Generated: ${CLOUDFLARE_SCHEMA_PATH}`);
}

// ---------------------------------------------------------------------------
// Step 2: Validate OpenAPI
// ---------------------------------------------------------------------------

async function stepValidateOpenAPI(): Promise<void> {
    console.log('\n─── Step 2: Validate OpenAPI ───────────────────────────────\n');

    const validatorScriptPath = new URL('./validate-openapi.ts', import.meta.url).pathname;
    const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-read', '--allow-net', validatorScriptPath],
        stdout: 'piped',
        stderr: 'piped',
    });

    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    const standardOutput = decoder.decode(stdout);
    const standardError = decoder.decode(stderr);

    if (standardOutput.length > 0) {
        console.log(standardOutput.trimEnd());
    }
    if (standardError.length > 0) {
        console.error(standardError.trimEnd());
    }

    if (code !== 0) {
        throw new Error(`OpenAPI validation failed via scripts/validate-openapi.ts (exit code ${code})`);
    }
}

// ---------------------------------------------------------------------------
// Step 3: Upload to Cloudflare API Shield
// ---------------------------------------------------------------------------

async function stepUploadToApiShield(dryRun: boolean, skipIfUnchanged: boolean): Promise<void> {
    console.log('\n─── Step 3: Upload to Cloudflare API Shield ────────────────\n');

    if (dryRun) {
        console.log('🔍 Dry-run: would upload cloudflare-schema.yaml to Cloudflare API Shield.');
        return;
    }

    const envResult = EnvSchema.safeParse({
        CLOUDFLARE_ZONE_ID: Deno.env.get('CLOUDFLARE_ZONE_ID'),
        CLOUDFLARE_API_SHIELD_TOKEN: Deno.env.get('CLOUDFLARE_API_SHIELD_TOKEN'),
    });
    if (!envResult.success) {
        const messages = envResult.error.issues.map((i) => i.message).join('\n  ');
        throw new Error(`Missing env vars for upload step:\n  ${messages}`);
    }
    const { CLOUDFLARE_ZONE_ID: zoneId, CLOUDFLARE_API_SHIELD_TOKEN: apiToken } = envResult.data;

    let schemaContent: string;
    try {
        schemaContent = await Deno.readTextFile(CLOUDFLARE_SCHEMA_PATH);
    } catch (err) {
        throw new Error(`Failed to read ${CLOUDFLARE_SCHEMA_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const localHash = await sha256Hex(schemaContent);
    console.log(`📋 Local schema: ${CLOUDFLARE_SCHEMA_PATH} (SHA-256: ${localHash.slice(0, 16)}...)`);

    const service = createCloudflareApiService({ apiToken });

    let existingSchemas: ApiShieldSchema[];
    try {
        existingSchemas = await service.listApiShieldSchemas(zoneId);
        console.log(`📡 Found ${existingSchemas.length} existing schema(s)`);
    } catch (err) {
        throw new Error(`Failed to list existing schemas: ${err instanceof Error ? err.message : String(err)}`);
    }

    // --skip-if-unchanged: compare hashes before uploading
    if (skipIfUnchanged) {
        for (const schema of existingSchemas) {
            if (schema.source) {
                const existingHash = await sha256Hex(schema.source);
                if (existingHash === localHash) {
                    if (schema.validation_enabled) {
                        console.log(`✅ Schema unchanged and validation enabled — skipping upload.`);
                        return;
                    }
                    // Hash matches but validation disabled — enable it, then remove any other active schema
                    console.warn(`⚠️  Schema unchanged but validation disabled — enabling validation.`);
                    await service.enableApiShieldSchema(zoneId, schema.schema_id);
                    console.log(`✅ Enabled validation on existing schema ${schema.schema_id}`);

                    const previousValidationEnabledSchema = existingSchemas.find((existingSchema) =>
                        existingSchema.validation_enabled === true && existingSchema.schema_id !== schema.schema_id
                    );
                    if (previousValidationEnabledSchema) {
                        await service.deleteApiShieldSchema(zoneId, previousValidationEnabledSchema.schema_id);
                        console.log(
                            `🗑️  Deleted previous validation-enabled schema ${previousValidationEnabledSchema.schema_id}`,
                        );
                    }
                    return;
                }
            }
        }
        console.log('🔄 Schema changed (or no source to compare) — uploading.');
    }

    // Identify the schema to delete after the new one is active
    const previousSchema = existingSchemas.find((s) => s.validation_enabled === true) ??
        existingSchemas.reduce<ApiShieldSchema | undefined>((latest, s) => {
            if (!latest) {
                return s;
            }
            return new Date(s.created_at).getTime() > new Date(latest.created_at).getTime() ? s : latest;
        }, undefined);

    // Upload
    const uploadResult = await service.uploadApiShieldSchema(zoneId, SCHEMA_NAME, schemaContent);
    const newSchemaId = uploadResult.schema.schema_id;
    console.log(`✅ Uploaded "${SCHEMA_NAME}" with ID: ${newSchemaId}`);

    if (uploadResult.upload_details?.warnings?.length) {
        for (const w of uploadResult.upload_details.warnings) {
            console.warn(`⚠️  Upload warning (${w.code}): ${w.message ?? '(no message)'}`);
        }
    }

    // Enable validation
    await service.enableApiShieldSchema(zoneId, newSchemaId);
    console.log(`✅ Enabled validation on schema ${newSchemaId}`);

    // Delete previous
    if (previousSchema && previousSchema.schema_id !== newSchemaId) {
        await service.deleteApiShieldSchema(zoneId, previousSchema.schema_id);
        console.log(`✅ Deleted previous schema "${previousSchema.name}" (${previousSchema.schema_id})`);
    }
}

// ---------------------------------------------------------------------------
// Step 4: Regenerate Postman collection
// ---------------------------------------------------------------------------

// Postman type stubs (minimal)

interface OAServer {
    url: string;
    description?: string;
}

interface OAMediaType {
    // deno-lint-ignore no-explicit-any
    schema?: Record<string, any>;
    example?: unknown;
    // deno-lint-ignore no-explicit-any
    examples?: Record<string, { summary?: string; value?: unknown }>;
}

interface OAOperation {
    tags?: string[];
    summary?: string;
    description?: string;
    operationId?: string;
    // deno-lint-ignore no-explicit-any
    security?: Array<Record<string, any>>;
    requestBody?: { required?: boolean; content?: Record<string, OAMediaType> };
    parameters?: Array<{
        name: string;
        in: string;
        required?: boolean;
        // deno-lint-ignore no-explicit-any
        schema?: Record<string, any>;
        description?: string;
    }>;
    // deno-lint-ignore no-explicit-any
    responses?: Record<string, any>;
}

interface OAPathItem {
    get?: OAOperation;
    post?: OAOperation;
    put?: OAOperation;
    patch?: OAOperation;
    delete?: OAOperation;
    options?: OAOperation;
    head?: OAOperation;
    trace?: OAOperation;
}

interface OASpec {
    openapi: string;
    info: { title: string; description?: string; version: string };
    servers?: OAServer[];
    tags?: Array<{ name: string; description?: string }>;
    paths: Record<string, OAPathItem>;
    components?: {
        // deno-lint-ignore no-explicit-any
        schemas?: Record<string, any>;
        // deno-lint-ignore no-explicit-any
        securitySchemes?: Record<string, any>;
    };
}

interface PostmanUrl {
    raw: string;
    host: string[];
    path: string[];
    variable?: Array<{ key: string; value: string; description?: string }>;
    query?: Array<{ key: string; value: string; disabled?: boolean; description?: string }>;
}

interface PostmanItem {
    name: string;
    description?: string;
    event?: Array<{ listen: 'test' | 'prerequest'; script: { type: string; exec: string[] } }>;
    request?: {
        method: string;
        header: Array<{ key: string; value: string; type?: string; description?: string }>;
        url: PostmanUrl;
        body?: { mode: string; raw?: string; options?: { raw?: { language: string } } };
        description?: string;
    };
    item?: PostmanItem[];
}

const HTTP_METHODS_PM = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;
type HttpMethodPm = (typeof HTTP_METHODS_PM)[number];

function resolveRefPM(ref: string, spec: OASpec): Record<string, unknown> | null {
    if (!ref.startsWith('#/')) {
        return null;
    }
    const parts = ref.slice(2).split('/');
    let node: unknown = spec;
    for (const part of parts) {
        if (node == null || typeof node !== 'object') {
            return null;
        }
        node = (node as Record<string, unknown>)[part];
    }
    return node != null && typeof node === 'object' ? (node as Record<string, unknown>) : null;
}

// deno-lint-ignore no-explicit-any
function schemaToExamplePM(schema: Record<string, any> | undefined, spec: OASpec, depth = 0): unknown {
    if (!schema || depth > 4) {
        return {};
    }
    if ('$ref' in schema && typeof schema['$ref'] === 'string') {
        const resolved = resolveRefPM(schema['$ref'] as string, spec);
        return schemaToExamplePM(resolved as Record<string, unknown> | undefined, spec, depth + 1);
    }
    if ('example' in schema) {
        return schema['example'];
    }
    const type = schema['type'];
    if (type === 'object' || (type == null && schema['properties'])) {
        const props = schema['properties'] as Record<string, unknown> | undefined;
        if (!props) {
            return {};
        }
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(props)) {
            if (depth < 3) {
                result[key] = schemaToExamplePM(val as Record<string, unknown>, spec, depth + 1);
            }
        }
        return result;
    }
    if (type === 'array') {
        return [schemaToExamplePM(schema['items'] as Record<string, unknown>, spec, depth + 1)];
    }
    if (type === 'string') {
        return (schema['enum'] as string[] | undefined)?.[0] ?? 'string';
    }
    if (type === 'integer' || type === 'number') {
        return 0;
    }
    if (type === 'boolean') {
        return false;
    }
    return {};
}

function extractBodyExamplePM(mediaType: OAMediaType | undefined, spec: OASpec): unknown {
    if (!mediaType) {
        return undefined;
    }
    if (mediaType.example !== undefined) {
        return mediaType.example;
    }
    if (mediaType.examples) {
        const first = Object.values(mediaType.examples)[0];
        if (first?.value !== undefined) {
            return first.value;
        }
    }
    if (mediaType.schema) {
        return schemaToExamplePM(mediaType.schema, spec);
    }
    return undefined;
}

function buildPostmanUrlPM(
    rawPath: string,
    baseVarName: string,
    queryParams: Array<{ name: string; required?: boolean; description?: string }> = [],
): PostmanUrl {
    const segments = rawPath.split('/').filter(Boolean);
    const pathParts: string[] = [];
    const variables: Array<{ key: string; value: string; description?: string }> = [];

    for (const seg of segments) {
        if (seg.startsWith('{') && seg.endsWith('}')) {
            const paramName = seg.slice(1, -1);
            pathParts.push(`:${paramName}`);
            variables.push({ key: paramName, value: `{{${paramName}}}`, description: `Path parameter: ${paramName}` });
        } else {
            pathParts.push(seg);
        }
    }

    const query = queryParams.map((p) => ({
        key: p.name,
        value: `{{${p.name}}}`,
        ...(p.description ? { description: p.description } : {}),
        ...(p.required ? {} : { disabled: true }),
    }));

    const requiredQueryParts = queryParams.filter((p) => p.required).map((p) => `${p.name}={{${p.name}}}`);
    const rawQuery = requiredQueryParts.length > 0 ? `?${requiredQueryParts.join('&')}` : '';
    const rawUrl = `{{${baseVarName}}}/${pathParts.join('/')}${rawQuery}`;

    const url: PostmanUrl = { raw: rawUrl, host: [`{{${baseVarName}}}`], path: pathParts };
    if (variables.length > 0) {
        url.variable = variables;
    }
    if (query.length > 0) {
        url.query = query;
    }
    return url;
}

function buildRequestItemPM(path: string, method: HttpMethodPm, operation: OAOperation, spec: OASpec): PostmanItem {
    const name = operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`;
    const headers: Array<{ key: string; value: string; type?: string; description?: string }> = [];

    const jsonMedia = operation.requestBody?.content?.['application/json'];
    if (jsonMedia) {
        headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
    }

    const requiresAdmin = operation.security?.some((s) => Object.keys(s).includes('AdminKey')) ?? false;
    if (requiresAdmin) {
        headers.push({ key: 'X-Admin-Key', value: '{{adminKey}}', type: 'text', description: 'Admin API key' });
    }

    let body: { mode: string; raw?: string; options?: { raw?: { language: string } } } | undefined;
    if (jsonMedia) {
        const example = extractBodyExamplePM(jsonMedia, spec);
        if (example !== undefined) {
            body = { mode: 'raw', raw: JSON.stringify(example, null, 4), options: { raw: { language: 'json' } } };
        }
    }

    const successStatus = Object.keys(operation.responses ?? {}).find((s) => s.startsWith('2')) ?? '200';
    const statusNum = parseInt(successStatus, 10);
    const contentTypes = Object.keys((operation.responses?.[successStatus] as { content?: Record<string, unknown> })?.content ?? {});
    const isJson = contentTypes.some((ct) => ct.includes('json'));
    const isSse = contentTypes.some((ct) => ct.includes('event-stream'));

    const testLines: string[] = [
        `pm.test('Status code is ${statusNum}', function () {`,
        `    pm.response.to.have.status(${statusNum});`,
        '});',
    ];
    if (isJson) {
        testLines.push('', "pm.test('Response is JSON', function () {", '    pm.response.to.be.json;', '});');
    }
    if (isSse) {
        testLines.push(
            '',
            "pm.test('Response is SSE stream', function () {",
            "    pm.expect(pm.response.headers.get('Content-Type')).to.include('text/event-stream');",
            '});',
        );
    }

    return {
        name,
        description: operation.description?.split('\n')[0] ?? operation.summary,
        event: [{ listen: 'test', script: { type: 'text/javascript', exec: testLines } }],
        request: {
            method: method.toUpperCase(),
            header: headers,
            url: buildPostmanUrlPM(
                path,
                'baseUrl',
                (operation.parameters ?? []).filter((p) => p.in === 'query'),
            ),
            ...(body ? { body } : {}),
            description: operation.description,
        },
    };
}

async function stepGeneratePostmanCollection(dryRun: boolean): Promise<void> {
    console.log('\n─── Step 4: Generate Postman collection ────────────────────\n');

    if (!existsSync(OPENAPI_PATH)) {
        throw new Error(`OpenAPI file not found: ${OPENAPI_PATH}`);
    }

    const content = await Deno.readTextFile(OPENAPI_PATH);
    const spec = parse(content) as OASpec;

    const servers = spec.servers ?? [];
    const prodServer = servers.find((s) => !s.url.startsWith('http://localhost'));
    const localServer = servers.find((s) => s.url.startsWith('http://localhost'));
    const baseUrlValue = localServer?.url ?? 'http://localhost:8787/api';
    const prodUrlValue = prodServer?.url ?? '';

    const tagOrder = (spec.tags ?? []).map((t) => t.name);
    const tagDescriptions: Record<string, string> = Object.fromEntries((spec.tags ?? []).map((t) => [t.name, t.description ?? '']));

    const tagItems: Record<string, PostmanItem[]> = {};
    for (const tagName of tagOrder) {
        tagItems[tagName] = [];
    }
    const untaggedItems: PostmanItem[] = [];

    let requestCount = 0;
    for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const method of HTTP_METHODS_PM) {
            const operation = pathItem[method];
            if (!operation) {
                continue;
            }
            const item = buildRequestItemPM(path, method, operation, spec);
            const tag = operation.tags?.[0];
            if (tag) {
                if (!tagItems[tag]) {
                    tagItems[tag] = [];
                }
                tagItems[tag].push(item);
            } else {
                untaggedItems.push(item);
            }
            requestCount++;
        }
    }

    const folderItems: PostmanItem[] = [];
    for (const tagName of tagOrder) {
        const items = tagItems[tagName];
        if (!items || items.length === 0) {
            continue;
        }
        folderItems.push({ name: tagName, description: tagDescriptions[tagName], item: items });
    }
    if (untaggedItems.length > 0) {
        folderItems.push({ name: 'Other', item: untaggedItems });
    }

    const collection = {
        info: {
            name: spec.info.title,
            description: `Auto-generated from docs/api/openapi.yaml. Run 'deno task postman:collection' to regenerate.\n\n${spec.info.description ?? ''}`.trim(),
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
            _postman_id: 'adblock-compiler-api',
            version: spec.info.version,
        },
        variable: [
            { key: 'baseUrl', value: baseUrlValue, type: 'string' },
            { key: 'prodUrl', value: prodUrlValue, type: 'string' },
            { key: 'requestId', value: '', type: 'string' },
            { key: 'adminKey', value: '', type: 'string', description: 'Admin API key for protected admin endpoints (X-Admin-Key header)' },
            { key: 'bearerToken', value: '', type: 'string', description: 'Bearer token for authenticated user requests (Better Auth JWT or API key)' },
            { key: 'userApiKey', value: '', type: 'string', description: 'User API key with abc_ prefix for API key authentication' },
            { key: 'userId', value: '', type: 'string', description: 'User ID captured from Create User response' },
            { key: 'apiKeyPrefix', value: '', type: 'string', description: 'API key prefix captured from Create API Key response' },
        ],
        item: folderItems,
    };

    const environmentLocal = {
        name: `${spec.info.title} - Local`,
        values: [
            { key: 'baseUrl', value: baseUrlValue, type: 'default', enabled: true },
            { key: 'requestId', value: '', type: 'default', enabled: true },
            { key: 'userId', value: '', type: 'default', enabled: true },
            { key: 'apiKeyPrefix', value: '', type: 'default', enabled: true },
        ],
        _postman_variable_scope: 'environment',
        _postman_exported_using: 'deno task postman:collection',
    };

    const envProdUrl = prodUrlValue || 'https://api.bloqr.dev/api';
    const environmentProd = {
        name: `${spec.info.title} - Prod`,
        values: [
            { key: 'baseUrl', value: envProdUrl, type: 'default', enabled: true },
            { key: 'bearerToken', value: '', type: 'secret', enabled: true },
            { key: 'userApiKey', value: '', type: 'secret', enabled: true },
            { key: 'adminKey', value: '', type: 'secret', enabled: true },
            { key: 'requestId', value: '', type: 'default', enabled: true },
            { key: 'userId', value: '', type: 'default', enabled: true },
            { key: 'apiKeyPrefix', value: '', type: 'default', enabled: true },
        ],
        _postman_variable_scope: 'environment',
        _postman_exported_using: 'deno task postman:collection',
    };

    if (dryRun) {
        console.log(
            `🔍 Dry-run: would write ${COLLECTION_OUTPUT_PATH} (${requestCount} requests), ${ENVIRONMENT_LOCAL_OUTPUT_PATH}, ${ENVIRONMENT_PROD_OUTPUT_PATH}, and ${ENVIRONMENT_OUTPUT_PATH}`,
        );
        return;
    }

    await Deno.writeTextFile(COLLECTION_OUTPUT_PATH, JSON.stringify(collection, null, 2) + '\n');
    console.log(`✅ Generated Postman collection: ${COLLECTION_OUTPUT_PATH} (${requestCount} requests)`);

    await Deno.writeTextFile(ENVIRONMENT_LOCAL_OUTPUT_PATH, JSON.stringify(environmentLocal, null, 4) + '\n');
    console.log(`✅ Generated Postman environment (local): ${ENVIRONMENT_LOCAL_OUTPUT_PATH}`);

    await Deno.writeTextFile(ENVIRONMENT_PROD_OUTPUT_PATH, JSON.stringify(environmentProd, null, 4) + '\n');
    console.log(`✅ Generated Postman environment (prod): ${ENVIRONMENT_PROD_OUTPUT_PATH}`);

    await Deno.writeTextFile(ENVIRONMENT_OUTPUT_PATH, JSON.stringify(environmentLocal, null, 4) + '\n');
    console.log(`✅ Generated Postman environment (legacy alias): ${ENVIRONMENT_OUTPUT_PATH}`);
}

// ---------------------------------------------------------------------------
// Step 5: Sync API Shield Endpoint Management
// ---------------------------------------------------------------------------

/** HTTP methods accepted by Cloudflare Endpoint Management. */
const CF_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'] as const;
type CfHttpMethod = (typeof CF_HTTP_METHODS)[number];

/**
 * Normalises an OpenAPI path parameter template so it can be compared against
 * Cloudflare's normalized form.  Cloudflare replaces `{anyName}` left-to-right
 * with `{var1}`, `{var2}`, … during insertion.  Applying the same transform
 * locally lets us check whether an operation is already saved before adding it.
 *
 * @param path - OpenAPI path, e.g. `/keys/{keyId}/sub/{subId}`
 * @returns Normalised path, e.g. `/keys/{var1}/sub/{var2}`
 */
function normalizePathParams(path: string): string {
    let idx = 1;
    return path.replace(/\{[^}]+\}/g, () => `{var${idx++}}`);
}

/**
 * Derives managed label names from an endpoint's path and OpenAPI tags.
 *
 * Returns zero or more labels from Cloudflare's `cf-*` catalogue that are
 * appropriate for the endpoint.  See:
 * https://developers.cloudflare.com/api-shield/management-and-monitoring/endpoint-labels/
 */
function managedLabelsForOperation(path: string, tags: string[]): string[] {
    const labels: string[] = [];
    const p = path.toLowerCase();

    if (p.includes('/sign-in') || p.includes('/login') || p.includes('/sign-out') || p.includes('/get-session')) {
        labels.push('cf-log-in');
    }
    if (p.includes('/sign-up') || p.includes('/signup') || p.includes('/register')) {
        labels.push('cf-sign-up');
    }
    if (p.includes('/password') || p.includes('/reset-password') || p.includes('/change-password')) {
        labels.push('cf-password-reset');
    }
    if (p.includes('/account') || p.includes('/profile') || p.includes('/account-update')) {
        labels.push('cf-account-update');
    }
    if (tags.some((t) => t.toLowerCase() === 'compilation') || p.includes('/compile')) {
        labels.push('cf-content');
    }

    return [...new Set(labels)];
}

/**
 * Syncs all OpenAPI operations to Cloudflare API Shield Endpoint Management
 * and attaches managed labels to the relevant operations.
 *
 * Behaviour:
 * - Reads the already-generated `cloudflare-schema.yaml` for the canonical source.
 * - Extracts every `{method, path}` combination and the production host from the
 *   first non-localhost server.
 * - Lists saved operations in API Shield; skips operations that are already present
 *   (after normalising path parameters to Cloudflare's `{varN}` form).
 * - Uploads new operations in a single bulk request.
 * - Collects all operation IDs (new + previously existing) that qualify for each
 *   managed label and calls `setManagedLabelOperations` to attach them.
 *
 * @param dryRun - When `true` logs intended actions but makes no API calls.
 * @param skipUpload - When `true` skips the step entirely (mirrors `--skip-upload`).
 */
async function stepSyncEndpoints(dryRun: boolean, skipUpload: boolean): Promise<void> {
    console.log('\n─── Step 5: Sync API Shield Endpoint Management ────────────\n');

    if (dryRun) {
        console.log('🔍 Dry-run: would sync operations and labels to Cloudflare API Shield Endpoint Management.');
        return;
    }

    if (skipUpload) {
        console.log('⏭️  Endpoint sync skipped (--skip-upload / --skip-endpoints).');
        return;
    }

    // Re-use the same env validation as the schema-upload step.
    const envResult = EnvSchema.safeParse({
        CLOUDFLARE_ZONE_ID: Deno.env.get('CLOUDFLARE_ZONE_ID'),
        CLOUDFLARE_API_SHIELD_TOKEN: Deno.env.get('CLOUDFLARE_API_SHIELD_TOKEN'),
    });
    if (!envResult.success) {
        const messages = envResult.error.issues.map((i) => i.message).join('\n  ');
        throw new Error(`Missing env vars for endpoint sync step:\n  ${messages}`);
    }
    const { CLOUDFLARE_ZONE_ID: zoneId, CLOUDFLARE_API_SHIELD_TOKEN: apiToken } = envResult.data;

    // Read the generated Cloudflare schema (guaranteed to exist after step 1).
    let schemaContent: string;
    try {
        schemaContent = await Deno.readTextFile(CLOUDFLARE_SCHEMA_PATH);
    } catch (err) {
        throw new Error(`Failed to read ${CLOUDFLARE_SCHEMA_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const cfSpec = parse(schemaContent) as {
        servers?: Array<{ url: string }>;
        paths: Record<string, Record<string, { tags?: string[] }>>;
    };

    // Derive the production host from the first non-localhost server.
    const prodServer = (cfSpec.servers ?? []).find((s) => !s.url.startsWith('http://localhost'));
    if (!prodServer) {
        throw new Error('No production server found in cloudflare-schema.yaml — cannot derive API host.');
    }
    const host = new URL(prodServer.url).hostname; // e.g. "api.bloqr.dev"

    // Build the desired set of operations from the spec.
    const desired: Array<{ input: ApiShieldOperationInput; normalizedPath: string; tags: string[] }> = [];
    for (const [rawPath, pathItem] of Object.entries(cfSpec.paths ?? {})) {
        for (const method of CF_HTTP_METHODS) {
            const operation = pathItem[method.toLowerCase()];
            if (!operation) {
                continue;
            }
            desired.push({
                input: { method: method as CfHttpMethod, host, endpoint: rawPath },
                normalizedPath: normalizePathParams(rawPath),
                tags: operation.tags ?? [],
            });
        }
    }
    console.log(`📋 Desired operations from schema: ${desired.length}`);

    const service = createCloudflareApiService({ apiToken });

    // Fetch already-saved operations to avoid duplicates.
    let existing: ApiShieldOperation[];
    try {
        existing = await service.listApiShieldOperations(zoneId);
        console.log(`📡 Found ${existing.length} existing saved operation(s)`);
    } catch (err) {
        throw new Error(`Failed to list existing operations: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Build a lookup of (method, normalizedPath) → operation_id for existing operations.
    const existingKey = (method: string, path: string) => `${method.toUpperCase()}::${normalizePathParams(path)}`;
    const existingMap = new Map<string, string>(existing.map((op) => [existingKey(op.method, op.endpoint), op.operation_id]));

    // Determine which operations need to be added.
    const toAdd = desired.filter((d) => !existingMap.has(existingKey(d.input.method, d.normalizedPath)));
    console.log(`➕ New operations to add: ${toAdd.length}`);

    let created: ApiShieldOperation[] = [];
    if (toAdd.length > 0) {
        // Cloudflare recommends batches of ≤500; our spec is well under that limit.
        try {
            created = await service.addApiShieldOperations(zoneId, toAdd.map((d) => d.input));
            console.log(`✅ Added ${created.length} operation(s) to API Shield Endpoint Management`);
        } catch (err) {
            throw new Error(`Failed to add operations: ${err instanceof Error ? err.message : String(err)}`);
        }
    } else {
        console.log('✅ All operations already saved — nothing to add');
    }

    // Merge created operations into the lookup so label assignment works for both new and existing.
    for (const op of created) {
        existingMap.set(existingKey(op.method, op.endpoint), op.operation_id);
    }

    // Build label → operation_id mapping across all desired operations.
    const labelToIds = new Map<string, string[]>();
    for (const d of desired) {
        const opId = existingMap.get(existingKey(d.input.method, d.normalizedPath));
        if (!opId) {
            // Not in the map means the API returned it under a normalized path we didn't match —
            // log a warning but continue so the rest of the sync succeeds.
            console.warn(`⚠️  Could not resolve operation_id for ${d.input.method} ${d.input.endpoint} — skipping label assignment`);
            continue;
        }
        for (const label of managedLabelsForOperation(d.input.endpoint, d.tags)) {
            if (!labelToIds.has(label)) {
                labelToIds.set(label, []);
            }
            labelToIds.get(label)!.push(opId);
        }
    }

    if (labelToIds.size === 0) {
        console.log('ℹ️  No managed labels to assign for this spec');
        return;
    }

    // Assign managed labels — each call fully replaces the label's operation set.
    for (const [label, ids] of labelToIds) {
        try {
            await service.setManagedLabelOperations(zoneId, label, ids);
            console.log(`🏷️  Set managed label "${label}" on ${ids.length} operation(s)`);
        } catch (err) {
            // Label assignment is best-effort — warn but don't fail the pipeline.
            console.warn(
                `⚠️  Failed to set managed label "${label}": ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseArgs(Deno.args, {
        boolean: ['dry-run', 'skip-upload', 'skip-if-unchanged', 'skip-endpoints'],
        default: { 'dry-run': false, 'skip-upload': false, 'skip-if-unchanged': true, 'skip-endpoints': false },
    });

    const dryRun = args['dry-run'] as boolean;
    const skipUpload = args['skip-upload'] as boolean;
    const skipIfUnchanged = args['skip-if-unchanged'] as boolean;
    const skipEndpoints = args['skip-endpoints'] as boolean;

    console.log('🚀 sync-api-assets — full API asset sync pipeline');
    if (dryRun) {
        console.log('   Mode: DRY RUN (no files written, no API calls)');
    } else if (skipUpload) {
        console.log('   Mode: LOCAL ONLY (generate + validate, no upload)');
    } else {
        console.log(`   Mode: FULL SYNC (upload ${skipIfUnchanged ? 'with --skip-if-unchanged' : 'forced'})`);
    }

    // Step 1: Generate Cloudflare schema
    await stepGenerateCloudflareSchema(dryRun);

    // Step 2: Validate OpenAPI
    await stepValidateOpenAPI();

    // Step 3: Upload (unless --skip-upload; dry-run is handled inside stepUploadToApiShield)
    if (skipUpload) {
        console.log('\n─── Step 3: Upload skipped (--skip-upload) ─────────────────\n');
    } else {
        await stepUploadToApiShield(dryRun, skipIfUnchanged);
    }

    // Step 4: Regenerate Postman collection
    await stepGeneratePostmanCollection(dryRun);

    // Step 5: Sync API Shield Endpoint Management + labels
    await stepSyncEndpoints(dryRun, skipUpload || skipEndpoints);

    console.log('\n🎉 sync-api-assets complete!\n');
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
        Deno.exit(1);
    });
}

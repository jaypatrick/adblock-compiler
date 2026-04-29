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

async function stepGeneratePostmanCollection(dryRun: boolean): Promise<void> {
    console.log('\n─── Step 4: Generate Postman collection ────────────────────\n');

    if (dryRun) {
        console.log('🔍 Dry-run: would run deno task postman:collection to regenerate Postman artifacts.');
        return;
    }

    // Delegate to the canonical generator script so that both
    // `deno task postman:collection` and `deno task schema:sync` always
    // produce identical Postman artifacts.
    const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-read', '--allow-write', 'scripts/generate-postman-collection.ts'],
        stdout: 'inherit',
        stderr: 'inherit',
    });
    const { code } = await cmd.output();
    if (code !== 0) {
        throw new Error('Postman collection generation failed (see output above)');
    }
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

#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env

/**
 * @module upload-cloudflare-schema
 * Cloudflare API Shield Schema Uploader
 *
 * Uploads docs/api/cloudflare-schema.yaml to Cloudflare API Shield using a
 * zero-downtime upsert sequence:
 *   1. Compute SHA-256 of the local schema.
 *   2. List existing schemas; skip upload if hash matches (--skip-if-unchanged).
 *   3. POST the new schema.
 *   4. PATCH to enable validation on the new schema.
 *   5. DELETE the previously-active schema (prevents validation blackout).
 *
 * All API responses are Zod-validated at the service boundary — unexpected shapes
 * surface as {@link ZodError} before any downstream logic runs.
 *
 * Required environment variables:
 *   CLOUDFLARE_ZONE_ID           — zone to upload to
 *   CLOUDFLARE_API_SHIELD_TOKEN  — API token with "API Gateway: Edit" scope
 *
 * Flags:
 *   --dry-run            Print what would happen without making API calls.
 *   --skip-if-unchanged  Skip upload if the local schema matches the live schema hash.
 */

import { parseArgs } from '@std/cli/parse-args';
import { z } from 'zod';
import { createCloudflareApiService } from '../src/services/cloudflareApiService.ts';
import type { ApiShieldSchema } from '../src/services/cloudflareApiService.ts';

const SCHEMA_PATH = './docs/api/cloudflare-schema.yaml';
const SCHEMA_NAME = 'adblock-compiler-openapi';

/**
 * Compute a hex-encoded SHA-256 digest of a UTF-8 string.
 *
 * @param text - The input string to hash.
 * @returns A lowercase hex string (64 characters) representing the SHA-256 digest.
 */
async function sha256Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Zod schema for the required environment variables.
 *
 * Both variables must be non-empty strings — absent or empty values are rejected
 * immediately so the script fails fast with a clear diagnostic rather than
 * surfacing cryptic Cloudflare API errors downstream.
 *
 * CLOUDFLARE_API_SHIELD_TOKEN must be a token scoped to "API Gateway: Edit" only.
 * Never reuse the wrangler deployment token — it has much broader permissions.
 */
const EnvSchema = z.object({
    /** Cloudflare zone ID (32-character lowercase hex string from the dashboard). */
    CLOUDFLARE_ZONE_ID: z
        .string()
        .regex(/^[a-f0-9]{32}$/i, 'CLOUDFLARE_ZONE_ID must be a 32-character hex string (found in the Cloudflare dashboard)'),
    /**
     * API token with "API Gateway: Edit" scope.
     * Create a dedicated token — do NOT reuse CLOUDFLARE_API_TOKEN / wrangler token.
     */
    CLOUDFLARE_API_SHIELD_TOKEN: z.string().min(1, 'CLOUDFLARE_API_SHIELD_TOKEN environment variable is required'),
});

/**
 * Orchestrates the zero-downtime API Shield schema upload sequence:
 * validates environment variables, reads the local schema file, compares
 * it against the live schema hash (when `--skip-if-unchanged` is set),
 * uploads the new schema, enables validation on it, and removes the
 * previously-active schema.
 */
async function main(): Promise<void> {
    const args = parseArgs(Deno.args, {
        boolean: ['dry-run', 'skip-if-unchanged'],
        default: { 'dry-run': false, 'skip-if-unchanged': false },
    });

    const dryRun = args['dry-run'] as boolean;
    const skipIfUnchanged = args['skip-if-unchanged'] as boolean;

    const envResult = EnvSchema.safeParse({
        CLOUDFLARE_ZONE_ID: Deno.env.get('CLOUDFLARE_ZONE_ID'),
        CLOUDFLARE_API_SHIELD_TOKEN: Deno.env.get('CLOUDFLARE_API_SHIELD_TOKEN'),
    });
    if (!envResult.success) {
        for (const issue of envResult.error.issues) {
            console.error(`❌ ${issue.message}`);
        }
        Deno.exit(1);
    }
    const { CLOUDFLARE_ZONE_ID: zoneId, CLOUDFLARE_API_SHIELD_TOKEN: apiToken } = envResult.data;

    // Read local schema
    let schemaContent: string;
    try {
        schemaContent = await Deno.readTextFile(SCHEMA_PATH);
    } catch (err) {
        console.error(`❌ Failed to read schema file ${SCHEMA_PATH}: ${err instanceof Error ? err.message : String(err)}`);
        Deno.exit(1);
    }

    const localHash = await sha256Hex(schemaContent);
    console.log(`📋 Local schema: ${SCHEMA_PATH} (SHA-256: ${localHash.slice(0, 16)}...)`);

    if (dryRun) {
        console.log('🔍 Dry-run mode: no API calls will be made.');
    }

    const service = createCloudflareApiService({ apiToken });

    // List existing schemas
    let existingSchemas: ApiShieldSchema[];
    try {
        existingSchemas = await service.listApiShieldSchemas(zoneId);
        console.log(`📡 Found ${existingSchemas.length} existing schema(s) in zone ${zoneId}`);
    } catch (err) {
        console.error(`❌ Failed to list existing schemas: ${err instanceof Error ? err.message : String(err)}`);
        Deno.exit(1);
    }

    // Check if schema is unchanged (skip-if-unchanged mode).
    // Only skip the upload entirely when the hash matches AND validation is already enabled.
    // If the hash matches but validation is disabled we fall through so validation gets enabled.
    if (skipIfUnchanged) {
        let matchedUnchangedSchema = false;
        for (const schema of existingSchemas) {
            if (schema.source) {
                const existingHash = await sha256Hex(schema.source);
                if (existingHash === localHash) {
                    matchedUnchangedSchema = true;
                    if (schema.validation_enabled) {
                        console.log(
                            `✅ Schema "${schema.name}" (${schema.schema_id}) is unchanged and validation is enabled — skipping upload.`,
                        );
                        Deno.exit(0);
                    }
                    console.warn(
                        `⚠️  Schema "${schema.name}" (${schema.schema_id}) is unchanged, but validation is not enabled. Proceeding with upload so validation can be enabled.`,
                    );
                    break;
                }
            }
        }
        if (!matchedUnchangedSchema) {
            console.log('🔄 Schema has changed (or no source to compare) — proceeding with upload.');
        }
    }

    // Identify the previous schema to delete after a successful upload.
    // Prefer the validation-enabled schema; fall back to the most recently created one
    // (determined by created_at timestamp) so the choice is deterministic regardless of
    // list ordering returned by the SDK.
    const validationEnabledSchema = existingSchemas.find((schema) => schema.validation_enabled === true);
    const mostRecentSchema = existingSchemas.reduce<ApiShieldSchema | undefined>((latestSchema, schema) => {
        if (!latestSchema) {
            return schema;
        }
        return new Date(schema.created_at).getTime() > new Date(latestSchema.created_at).getTime() ? schema : latestSchema;
    }, undefined);
    const previousSchema: ApiShieldSchema | undefined = validationEnabledSchema ?? mostRecentSchema;

    if (dryRun) {
        console.log(`🔍 Would upload schema "${SCHEMA_NAME}" (${schemaContent.length} bytes) to zone ${zoneId}`);
        if (previousSchema) {
            console.log(`🔍 Would enable validation on the new schema.`);
            console.log(`🔍 Would delete previous schema "${previousSchema.name}" (${previousSchema.schema_id})`);
        } else {
            console.log(`🔍 Would enable validation on the new schema (no previous schema to delete).`);
        }
        console.log('✅ Dry-run complete.');
        Deno.exit(0);
    }

    // Step 3: Upload new schema
    let newSchemaId: string;
    try {
        const uploadResult = await service.uploadApiShieldSchema(zoneId, SCHEMA_NAME, schemaContent);
        newSchemaId = uploadResult.schema.schema_id;
        console.log(`✅ Uploaded schema "${SCHEMA_NAME}" with ID: ${newSchemaId}`);

        if (uploadResult.upload_details?.warnings && uploadResult.upload_details.warnings.length > 0) {
            for (const warning of uploadResult.upload_details.warnings) {
                console.warn(`⚠️  Schema upload warning (code ${warning.code}): ${warning.message ?? '(no message)'}`);
            }
        }
    } catch (err) {
        console.error(`❌ Failed to upload schema: ${err instanceof Error ? err.message : String(err)}`);
        Deno.exit(1);
    }

    // Step 4: Enable validation on the new schema
    try {
        await service.enableApiShieldSchema(zoneId, newSchemaId);
        console.log(`✅ Enabled validation on schema ${newSchemaId}`);
    } catch (err) {
        console.error(`❌ Failed to enable validation on schema ${newSchemaId}: ${err instanceof Error ? err.message : String(err)}`);
        Deno.exit(1);
    }

    // Step 5: Delete the previous schema (now that the new one is active)
    if (previousSchema && previousSchema.schema_id !== newSchemaId) {
        try {
            await service.deleteApiShieldSchema(zoneId, previousSchema.schema_id);
            console.log(`✅ Deleted previous schema "${previousSchema.name}" (${previousSchema.schema_id})`);
        } catch (err) {
            console.error(
                `❌ Failed to delete previous schema ${previousSchema.schema_id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            Deno.exit(1);
        }
    }

    console.log('\n🎉 API Shield schema upload complete!');
}

if (import.meta.main) {
    try {
        await main();
    } catch (err) {
        console.error(`❌ Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
        Deno.exit(1);
    }
}

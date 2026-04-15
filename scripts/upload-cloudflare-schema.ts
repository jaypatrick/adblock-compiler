#!/usr/bin/env -S deno run --allow-read --allow-net --allow-env

/**
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
 * Required environment variables:
 *   CLOUDFLARE_ZONE_ID           — zone to upload to
 *   CLOUDFLARE_API_SHIELD_TOKEN  — API token with "API Gateway: Edit" scope
 *
 * Flags:
 *   --dry-run            Print what would happen without making API calls.
 *   --skip-if-unchanged  Skip upload if the local schema matches the live schema hash.
 */

import { parseArgs } from '@std/cli/parse-args';
import { createCloudflareApiService } from '../src/services/cloudflareApiService.ts';
import type { ApiShieldSchema } from '../src/services/cloudflareApiService.ts';

const SCHEMA_PATH = './docs/api/cloudflare-schema.yaml';
const SCHEMA_NAME = 'adblock-compiler-openapi';

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

async function main(): Promise<void> {
    const args = parseArgs(Deno.args, {
        boolean: ['dry-run', 'skip-if-unchanged'],
        default: { 'dry-run': false, 'skip-if-unchanged': false },
    });

    const dryRun = args['dry-run'] as boolean;
    const skipIfUnchanged = args['skip-if-unchanged'] as boolean;

    const zoneId = Deno.env.get('CLOUDFLARE_ZONE_ID');
    const apiToken = Deno.env.get('CLOUDFLARE_API_SHIELD_TOKEN');

    if (!zoneId) {
        console.error('❌ CLOUDFLARE_ZONE_ID environment variable is required');
        Deno.exit(1);
    }
    if (!apiToken) {
        console.error('❌ CLOUDFLARE_API_SHIELD_TOKEN environment variable is required');
        Deno.exit(1);
    }

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

    // Check if schema is unchanged (skip-if-unchanged mode)
    if (skipIfUnchanged) {
        for (const schema of existingSchemas) {
            if (schema.source) {
                const existingHash = await sha256Hex(schema.source);
                if (existingHash === localHash) {
                    console.log(`✅ Schema "${schema.name}" (${schema.schema_id}) is unchanged — skipping upload.`);
                    if (!schema.validation_enabled) {
                        console.warn(`⚠️  Validation is not enabled on the current schema. Run without --skip-if-unchanged to re-upload and enable.`);
                    }
                    Deno.exit(0);
                }
            }
        }
        console.log('🔄 Schema has changed (or no source to compare) — proceeding with upload.');
    }

    // Identify the previous schema to delete after a successful upload.
    // Prefer the validation-enabled schema; fall back to the most recent one.
    const previousSchema: ApiShieldSchema | undefined = existingSchemas.find((s) => s.validation_enabled === true) ?? existingSchemas[0];

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

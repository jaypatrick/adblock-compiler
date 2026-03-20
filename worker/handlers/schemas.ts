/**
 * GET /api/schemas
 *
 * Returns JSON Schema metadata for all public Zod request/response schemas.
 * The response includes the schema title and description derived from the Zod
 * definition. Full JSON Schema introspection (properties, required fields, etc.)
 * is intentionally omitted to keep this a zero-dependency, edge-compatible
 * endpoint — use the OpenAPI spec at GET /api for a complete schema reference.
 *
 * This is an anonymous-tier, read-only, cacheable endpoint.
 */

import { ConfigurationSchema, CompileRequestSchema, SourceSchema, BenchmarkMetricsSchema } from '../../src/configuration/schemas.ts';
import type { Env } from '../types.ts';

// deno-lint-ignore no-explicit-any
type JsonSchema = Record<string, any>;

/**
 * Builds a minimal JSON Schema descriptor from a Zod schema's metadata.
 *
 * Returns `$schema`, `title`, `description`, and `type` only.
 * This is a lightweight edge-compatible approach — for full property-level
 * JSON Schema, generate from the OpenAPI spec via `deno task openapi:docs`.
 */
// deno-lint-ignore no-explicit-any
function zodSchemaToJsonSchema(schema: any, name: string): JsonSchema {
    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: name,
        description: schema._def?.description ?? `Schema for ${name}`,
        type: 'object',
    };
}

export function handleSchemas(_request: Request, _env: Env): Response {
    const schemas: Record<string, JsonSchema> = {
        ConfigurationSchema: zodSchemaToJsonSchema(ConfigurationSchema, 'ConfigurationSchema'),
        CompileRequestSchema: zodSchemaToJsonSchema(CompileRequestSchema, 'CompileRequestSchema'),
        SourceSchema: zodSchemaToJsonSchema(SourceSchema, 'SourceSchema'),
        BenchmarkMetricsSchema: zodSchemaToJsonSchema(BenchmarkMetricsSchema, 'BenchmarkMetricsSchema'),
    };

    return Response.json(
        { success: true, schemas },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
}

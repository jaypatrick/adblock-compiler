/**
 * Shared Zod schemas for workflow API request bodies.
 *
 * These schemas are the single source of truth for the shape of POST request
 * bodies accepted by the /api/workflow/* endpoints. They are imported by:
 *   - workflow.routes.ts  — OpenAPI route definitions + Hono validation
 *   - workflow.ts handlers — safeParse validation inside routeWorkflow()
 *
 * Exporting the inferred TypeScript types alongside the schemas lets handler
 * signatures be written as `body: CompileInput` instead of casting.
 *
 * Uses z from @hono/zod-openapi (which re-exports zod with OpenAPI extensions)
 * so the schemas are usable in both Hono OpenAPI route definitions and plain
 * Zod safeParse calls.
 *
 * `configuration` fields use the strict `ConfigurationSchema` from src/ so that
 * the inferred types are `IConfiguration` rather than `Record<string, unknown>`,
 * removing the need for unsafe `as unknown as IConfiguration` casts in handlers.
 */

import { z } from '@hono/zod-openapi';
import { ConfigurationSchema } from '../../src/configuration/schemas.ts';

export const compileRequestSchema = z.object({
    configuration: ConfigurationSchema.describe('Compilation configuration object'),
    preFetchedContent: z.record(z.string(), z.string()).optional().describe('Optional pre-fetched filter list content'),
    benchmark: z.boolean().optional().describe('Whether to include benchmark metrics'),
    priority: z.enum(['high', 'normal', 'low']).optional().describe('Workflow priority'),
});

export const batchCompileRequestSchema = z.object({
    requests: z.array(z.object({
        id: z.string().describe('Unique identifier for this batch item'),
        configuration: ConfigurationSchema.describe('Compilation configuration'),
        preFetchedContent: z.record(z.string(), z.string()).optional().describe('Optional pre-fetched content'),
        benchmark: z.boolean().optional().describe('Whether to include benchmarks'),
    })).min(1).describe('Array of compilation requests to process in batch'),
    priority: z.enum(['high', 'normal', 'low']).optional().describe('Batch priority'),
});

export const cacheWarmRequestSchema = z.object({
    configurations: z.array(ConfigurationSchema).optional().describe('Optional configurations to warm. Uses defaults if omitted.'),
});

export const healthCheckRequestSchema = z.object({
    sources: z.array(z.object({
        name: z.string().describe('Human-readable source name'),
        url: z.string().url().describe('Source URL to check'),
        expectedMinRules: z.number().int().nonnegative().optional().describe('Minimum expected rule count'),
    })).optional().describe('Optional sources to check. Uses defaults if omitted.'),
    alertOnFailure: z.boolean().optional().describe('Whether to send alerts on health check failure'),
});

// Inferred types for use in handler signatures — these exactly match what
// Hono returns from `c.req.valid('json')` after OpenAPI validation, so no
// unsafe double-casts are needed when passing the validated body to handlers.
export type CompileInput = z.infer<typeof compileRequestSchema>;
export type BatchCompileInput = z.infer<typeof batchCompileRequestSchema>;
export type CacheWarmInput = z.infer<typeof cacheWarmRequestSchema>;
export type HealthCheckInput = z.infer<typeof healthCheckRequestSchema>;

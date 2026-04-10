/**
 * Zod schemas for runtime validation of tRPC procedure inputs and outputs.
 *
 * ZTA principle: treat all API responses as untrusted. All tRPC response
 * payloads are validated against these schemas before being consumed.
 *
 * Schemas mirror the procedure definitions in `worker/trpc/routers/v1/`.
 * When a procedure's output shape changes on the server side, update the
 * corresponding schema here to keep the types in sync.
 *
 * ## Compile input note
 * `TrpcCompileJsonInputSchema` intentionally covers only the fields that the
 * Angular UI sends. The server validates the full `CompileRequestSchema`
 * (which includes URL/path refinements, strict mode, etc.) — this schema
 * provides compile-time and runtime safety for the Angular layer.
 *
 * @see worker/trpc/routers/v1/ — canonical server-side procedure definitions
 * @see frontend/src/app/trpc/types.ts — TypeScript type aliases derived from these schemas
 * @see frontend/src/app/schemas/api-responses.ts — REST endpoint response schemas (separate)
 */

import { z } from 'zod';
import { CompileResponseSchema } from '../schemas/api-responses';

// ---------------------------------------------------------------------------
// v1.version.get — public query
// ---------------------------------------------------------------------------

/**
 * Response schema for `v1.version.get`.
 * Returns the Worker build version and the tRPC API version string.
 */
export const TrpcVersionGetResponseSchema = z.object({
    version: z.string(),
    apiVersion: z.string(),
});

export type TrpcVersionGetResponse = z.infer<typeof TrpcVersionGetResponseSchema>;

// ---------------------------------------------------------------------------
// v1.health.get — public query
// ---------------------------------------------------------------------------

/** Health status of a single service component. */
const TrpcServiceStatusSchema = z.enum(['healthy', 'degraded', 'down']);
export type TrpcServiceStatus = z.infer<typeof TrpcServiceStatusSchema>;

/** Base shape shared by all service health results. */
const TrpcServiceResultSchema = z.object({
    status: TrpcServiceStatusSchema,
    latency_ms: z.number().optional(),
});

/**
 * Response schema for `v1.health.get`.
 * Mirrors the JSON payload returned by `handleHealth()` in `worker/handlers/health.ts`.
 */
export const TrpcHealthGetResponseSchema = z.object({
    status: TrpcServiceStatusSchema,
    version: z.string(),
    timestamp: z.string(),
    services: z.object({
        gateway: TrpcServiceResultSchema,
        database: TrpcServiceResultSchema.extend({
            db_name: z.string().optional(),
            hyperdrive_host: z.string().optional(),
            error_code: z.string().optional(),
            error_message: z.string().optional(),
        }),
        compiler: TrpcServiceResultSchema,
        auth: TrpcServiceResultSchema.extend({
            provider: z.enum(['better-auth', 'none']),
        }),
        cache: TrpcServiceResultSchema,
    }),
});

export type TrpcHealthGetResponse = z.infer<typeof TrpcHealthGetResponseSchema>;

// ---------------------------------------------------------------------------
// v1.compile.json — authenticated mutation
// ---------------------------------------------------------------------------

/**
 * Input schema for `v1.compile.json`.
 *
 * Covers the fields that the Angular UI sends. The server validates the full
 * `CompileRequestSchema` (`src/configuration/schemas.ts`) — this schema
 * provides early Angular-layer validation without duplicating complex server
 * refinements (URL validation, strict mode, ordering constraints).
 *
 * **Field note**: sources use `source` (URL or file path), NOT `url`.
 * This matches `SourceSchema` in `src/configuration/schemas.ts`.
 */
export const TrpcCompileJsonInputSchema = z.object({
    configuration: z.object({
        /**
         * Human-readable filter list name. Required by the server-side
         * `ConfigurationSchema` (`src/configuration/schemas.ts`) and must be non-empty.
         * The Worker will reject requests with a 400 error if this field is absent.
         */
        name: z.string().min(1),
        /**
         * Source definitions. Each item's `source` field must be a valid URL or
         * file path — mirroring the `SourceSchema.source` validation on the server.
         */
        sources: z.array(
            z.object({
                /** URL or file path to the filter list source. */
                source: z.string().min(1),
                /** When true, fetch via Cloudflare Browser Rendering (WorkerCompiler only). */
                useBrowser: z.boolean().optional(),
            }),
        ).nonempty(),
        /** Ordered list of transformation names to apply (e.g. `['Deduplicate', 'Compress']`). */
        transformations: z.array(z.string()).optional(),
    }),
    /** When true, include benchmark metrics in the response. */
    benchmark: z.boolean().optional(),
    /** Cloudflare Turnstile token — required for anonymous/public-facing callers. */
    turnstileToken: z.string().optional(),
});

export type TrpcCompileJsonInput = z.infer<typeof TrpcCompileJsonInputSchema>;

/**
 * Response schema for `v1.compile.json`.
 *
 * Re-uses `CompileResponseSchema` from the shared REST schema file to avoid
 * duplication — the tRPC mutation delegates to the same handler as
 * `POST /api/compile`.
 */
export const TrpcCompileJsonResponseSchema = CompileResponseSchema;
export type TrpcCompileJsonResponse = z.infer<typeof CompileResponseSchema>;

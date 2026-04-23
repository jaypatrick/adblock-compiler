// Typed wrapper around the official `cloudflare` TypeScript SDK.
// All Cloudflare REST API calls go through this service — never use raw fetch() to api.cloudflare.com.

import Cloudflare from 'cloudflare';
import type { ZoneListParams } from 'cloudflare/resources/zones/zones';
import type { IBasicLogger } from '../types/index.ts';
import { silentLogger } from '../utils/logger.ts';
import { z } from 'zod';

// ─── Page Shield Zod schemas ─────────────────────────────────────────────────

/**
 * Zod schema for a single Cloudflare Page Shield script record.
 *
 * The `malicious_score` field is optional/nullable — the API omits it for
 * scripts that have not yet been analysed.
 */
export const PageShieldScriptSchema = z.object({
    /** Stable identifier for the detected script. */
    id: z.string(),
    /** Full URL of the script as observed on the zone. */
    url: z.string(),
    /**
     * Cloudflare threat score in the range [0, 1].
     * `null` means the script has not been analysed yet.
     */
    malicious_score: z.number().nullable().optional(),
});
/** Inferred type from {@link PageShieldScriptSchema}. */
export type PageShieldScript = z.infer<typeof PageShieldScriptSchema>;

/** Zod schema for the v4 API envelope returned by the Page Shield scripts endpoint. */
export const PageShieldScriptsResponseSchema = z.object({
    result: z.array(PageShieldScriptSchema).nullable(),
    success: z.boolean(),
    errors: z.array(z.object({ code: z.number(), message: z.string() })),
});
/** Inferred type from {@link PageShieldScriptsResponseSchema}. */
export type PageShieldScriptsResponse = z.infer<typeof PageShieldScriptsResponseSchema>;

// ─── API Shield Zod schemas ─────────────────────────────────────────────────

/**
 * Zod schema for a Cloudflare API Shield (API Gateway) user schema object.
 *
 * Mirrors the `PublicSchema` interface from `cloudflare@5.2.0`. The `source`
 * field is only populated when the listing request is made with `omit_source=false`.
 */
export const ApiShieldSchemaSchema = z.object({
    /** ISO 8601 timestamp indicating when the schema was created. */
    created_at: z.string().datetime(),
    /** Schema format — always `'openapi_v3'` for user-uploaded schemas. */
    kind: z.literal('openapi_v3'),
    /** Human-readable name given to the schema at upload time. */
    name: z.string(),
    /** Stable identifier for the schema within the zone. */
    schema_id: z.string(),
    /** Raw schema source content — only present when `omit_source=false` was requested. */
    source: z.string().optional(),
    /** Whether API Shield validation is currently active for this schema. */
    validation_enabled: z.boolean().optional(),
});
/** Inferred type from {@link ApiShieldSchemaSchema}. */
export type ApiShieldSchema = z.infer<typeof ApiShieldSchemaSchema>;

/**
 * Zod schema for the response returned when uploading an API Shield schema.
 *
 * Mirrors the `SchemaUpload` interface from `cloudflare@5.2.0`. The `upload_details`
 * field carries any parser warnings emitted during schema validation.
 */
export const ApiShieldUploadResultSchema = z.object({
    /** The schema object that was created. */
    schema: ApiShieldSchemaSchema,
    /** Optional upload diagnostics including any parser warnings. */
    upload_details: z
        .object({
            /** Non-fatal warnings produced by the API Gateway schema parser. */
            warnings: z
                .array(
                    z.object({
                        /** Numeric warning code. */
                        code: z.number(),
                        /** JSON Pointer or XPath locations in the schema that triggered the warning. */
                        locations: z.array(z.string()).optional(),
                        /** Human-readable description of the warning. */
                        message: z.string().optional(),
                    }),
                )
                .optional(),
        })
        .optional(),
});
/** Inferred type from {@link ApiShieldUploadResultSchema}. */
export type ApiShieldUploadResult = z.infer<typeof ApiShieldUploadResultSchema>;

/**
 * Zod schema for an API Shield schema object with validation confirmed active.
 *
 * Extends {@link ApiShieldSchemaSchema} by requiring `validation_enabled: true`
 * (a `z.literal`). Used as the parse target of
 * {@link CloudflareApiService.enableApiShieldSchema} to enforce the post-condition
 * at the trust boundary that the PATCH response confirms validation is on.
 */
export const EnabledApiShieldSchemaSchema = ApiShieldSchemaSchema.extend({
    /** Validation is confirmed active — `z.literal(true)` rejects absent or `false` values. */
    validation_enabled: z.literal(true),
});
/** Inferred type from {@link EnabledApiShieldSchemaSchema}. */
export type EnabledApiShieldSchema = z.infer<typeof EnabledApiShieldSchemaSchema>;

// ─── Return-type helpers ──────────────────────────────────────────────────────

// D1 accepts string | number | boolean | null at runtime; SDK types `params` as Array<string>.
export type D1Param = string | number | boolean | null;

export interface D1QueryResult<T = unknown> {
    result: T[];
    success: boolean;
}

// ─── Service class ────────────────────────────────────────────────────────────

// Thin, testable service wrapping the official `cloudflare` SDK.
// Construct via createCloudflareApiService for production use, or pass a mock client for tests.
export class CloudflareApiService {
    private readonly client: Cloudflare;
    private readonly logger: IBasicLogger;

    constructor(client: Cloudflare, logger?: IBasicLogger) {
        this.client = client;
        this.logger = logger ?? silentLogger;
    }

    // ── D1 ───────────────────────────────────────────────────────────────────

    async queryD1<T = unknown>(
        accountId: string,
        databaseId: string,
        sql: string,
        params?: D1Param[],
    ): Promise<D1QueryResult<T>> {
        this.logger.info(`[CloudflareApiService] queryD1: ${sql.slice(0, 80)}`);

        const page = await this.client.d1.database.query(databaseId, {
            account_id: accountId,
            sql,
            // D1 accepts any JSON primitive at runtime. We rely on the `D1Param[]`
            // function signature (string | number | boolean | null) for compile-time
            // enforcement instead of adding a separate runtime validator; this cast
            // narrows the type for the SDK. `undefined` (not an empty array) must be
            // passed when no params are provided so the SDK omits the field.
            params: params as Array<string> | undefined,
        });

        const queryResults = page.getPaginatedItems();
        const rows = queryResults.flatMap((qr) => (qr.results ?? []) as T[]);

        return { result: rows, success: true };
    }

    async listD1Databases(accountId: string) {
        this.logger.info(`[CloudflareApiService] listD1Databases`);

        const page = await this.client.d1.database.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── KV ───────────────────────────────────────────────────────────────────

    async listKvNamespaces(accountId: string) {
        this.logger.info(`[CloudflareApiService] listKvNamespaces`);

        const page = await this.client.kv.namespaces.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── Workers ───────────────────────────────────────────────────────────────

    async listWorkers(accountId: string) {
        this.logger.info(`[CloudflareApiService] listWorkers`);

        const page = await this.client.workers.scripts.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── Queues ────────────────────────────────────────────────────────────────

    async listQueues(accountId: string) {
        this.logger.info(`[CloudflareApiService] listQueues`);

        const page = await this.client.queues.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── Zones ─────────────────────────────────────────────────────────────────

    async listZones(params?: ZoneListParams) {
        this.logger.info(`[CloudflareApiService] listZones`);

        const page = await this.client.zones.list(params ?? {});
        return page.getPaginatedItems();
    }

    // ── Analytics Engine ──────────────────────────────────────────────────────
    // The Analytics Engine SQL API has no typed resource in the cloudflare SDK yet.
    // All SDK features (auth headers, retries, error handling) still apply via post().
    async queryAnalyticsEngine(
        accountId: string,
        sql: string,
    ): Promise<{ data: Record<string, unknown>[] }> {
        this.logger.info(`[CloudflareApiService] queryAnalyticsEngine`);

        return await this.client.post<{ query: string }, { data: Record<string, unknown>[] }>(
            `/accounts/${accountId}/analytics_engine/sql`,
            { body: { query: sql } },
        );
    }

    // ── API Shield ────────────────────────────────────────────────────────────

    /**
     * Lists all API Shield user schemas registered for the given zone.
     *
     * Fetches all pages via the SDK's paginated endpoint with `omit_source=false`
     * so that each item includes the raw schema source YAML.
     *
     * @param zoneId - Cloudflare zone ID (32-character hex string).
     * @returns Array of {@link ApiShieldSchema} objects describing each registered schema.
     * @throws {ZodError} if any item returned by the API does not match {@link ApiShieldSchemaSchema}.
     */
    async listApiShieldSchemas(zoneId: string): Promise<ApiShieldSchema[]> {
        this.logger.info(`[CloudflareApiService] listApiShieldSchemas zoneId=${zoneId}`);

        const page = await this.client.apiGateway.userSchemas.list({ zone_id: zoneId, omit_source: false });
        return page.getPaginatedItems().map((item) => ApiShieldSchemaSchema.parse(item));
    }

    /**
     * Uploads a new OpenAPI v3 schema to API Shield for the given zone.
     *
     * The schema content is sent as an `application/yaml` file. Cloudflare may
     * return non-fatal parser warnings inside `upload_details.warnings`.
     *
     * @param zoneId - Cloudflare zone ID (32-character hex string).
     * @param name - Human-readable label for the schema (e.g. `'my-api-v2'`).
     * @param content - Raw YAML or JSON content of the OpenAPI v3 schema.
     * @returns The {@link ApiShieldUploadResult} including the created schema and any parser warnings.
     * @throws {ZodError} if the API response does not match {@link ApiShieldUploadResultSchema}.
     */
    async uploadApiShieldSchema(zoneId: string, name: string, content: string): Promise<ApiShieldUploadResult> {
        this.logger.info(`[CloudflareApiService] uploadApiShieldSchema zoneId=${zoneId} name=${name}`);

        const file = new File([content], name, { type: 'application/yaml' });
        const raw = await this.client.apiGateway.userSchemas.create({
            zone_id: zoneId,
            file,
            kind: 'openapi_v3',
            name,
        });
        return ApiShieldUploadResultSchema.parse(raw);
    }

    /**
     * Enables API Shield validation for the given schema.
     *
     * PATCHes the schema with `validation_enabled: true` so that incoming
     * requests are validated against the schema's operation definitions.
     *
     * The API response is validated with a stricter inline schema that asserts
     * `validation_enabled === true`, so a {@link ZodError} is thrown if the API
     * returns the schema without the field being set — making the post-condition
     * explicit at the trust boundary.
     *
     * @param zoneId - Cloudflare zone ID (32-character hex string).
     * @param schemaId - Schema ID returned by {@link uploadApiShieldSchema}.
     * @returns The updated {@link EnabledApiShieldSchema} with `validation_enabled: true`, as confirmed by Zod.
     * @throws {ZodError} if the API response does not match {@link EnabledApiShieldSchemaSchema} or if
     *   `validation_enabled` is not `true` in the response.
     */
    async enableApiShieldSchema(zoneId: string, schemaId: string): Promise<EnabledApiShieldSchema> {
        this.logger.info(`[CloudflareApiService] enableApiShieldSchema zoneId=${zoneId} schemaId=${schemaId}`);

        const raw = await this.client.apiGateway.userSchemas.edit(schemaId, {
            zone_id: zoneId,
            validation_enabled: true,
        });
        // Use EnabledApiShieldSchemaSchema (which requires validation_enabled === true) so the
        // post-condition is enforced at the trust boundary rather than left as an unchecked assumption.
        return EnabledApiShieldSchemaSchema.parse(raw);
    }

    /**
     * Deletes an API Shield schema from the given zone.
     *
     * Should only be called after the replacement schema has been uploaded and
     * validation has been enabled on it, to avoid a validation blackout window.
     *
     * @param zoneId - Cloudflare zone ID (32-character hex string).
     * @param schemaId - ID of the schema to delete.
     * @returns Resolves when the deletion is confirmed by the API.
     */
    async deleteApiShieldSchema(zoneId: string, schemaId: string): Promise<void> {
        this.logger.info(`[CloudflareApiService] deleteApiShieldSchema zoneId=${zoneId} schemaId=${schemaId}`);

        await this.client.apiGateway.userSchemas.delete(schemaId, { zone_id: zoneId });
    }

    // ── Page Shield ───────────────────────────────────────────────────────────

    /**
     * Lists all scripts detected by Cloudflare Page Shield for the given zone.
     *
     * The Page Shield Scripts endpoint is not yet exposed as a typed resource
     * in the `cloudflare@5.x` SDK. The generic `get()` method is used so that
     * all SDK features (auth, retries, error handling) still apply; only the
     * path-level type safety is sacrificed.  The response is Zod-validated at
     * the trust boundary via {@link PageShieldScriptsResponseSchema}.
     *
     * @param zoneId - Cloudflare zone ID (32-character hex string).
     * @returns Array of {@link PageShieldScript} objects.
     * @throws {ZodError} if the API response does not match {@link PageShieldScriptsResponseSchema}.
     */
    async getPageShieldScripts(zoneId: string): Promise<PageShieldScript[]> {
        this.logger.info(`[CloudflareApiService] getPageShieldScripts zoneId=${zoneId}`);

        // The generic get() still routes through the SDK's auth, retries, and
        // error-handling middleware — only the path type is untyped.
        // TODO(@copilot): implement cursor-based pagination if zones exceed 100 detected scripts.
        const raw = await this.client.get<{ per_page?: number }, PageShieldScriptsResponse>(
            `/zones/${zoneId}/page_shield/scripts`,
            { query: { per_page: 100 } },
        );
        const parsed = PageShieldScriptsResponseSchema.parse(raw);

        if (!parsed.success) {
            const errorDetails = parsed.errors.length > 0 ? JSON.stringify(parsed.errors) : 'Unknown Cloudflare API error';
            throw new Error(`Cloudflare Page Shield scripts request failed: ${errorDetails}`);
        }

        return parsed.result ?? [];
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

// All standard Cloudflare SDK ClientOptions (baseURL, timeout, defaultHeaders, maxRetries)
// are forwarded to the underlying SDK client.
export type CreateCloudflareApiServiceOptions = {
    apiToken: string;
    logger?: IBasicLogger;
} & Omit<ConstructorParameters<typeof Cloudflare>[0], 'apiToken' | 'fetch'>;

export function createCloudflareApiService(options: CreateCloudflareApiServiceOptions): CloudflareApiService {
    const { logger, ...sdkOptions } = options;
    const client = new Cloudflare({
        maxRetries: 0,
        ...sdkOptions,
        // Lambda ensures globalThis.fetch patches (e.g. in unit tests) are honoured at call time
        // rather than being captured at construction time. @ts-expect-error below suppresses a
        // cross-environment type conflict: the SDK's Fetch type uses Cloudflare Workers' RequestInfo
        // (which includes URLLike), while Deno's globalThis.fetch uses the standard DOM RequestInfo.
        // They are functionally compatible at runtime; the mismatch is purely in type-level declarations.
        // @ts-expect-error TS2322 — Deno's RequestInfo|URL ≠ Workers URLLike; compatible at runtime
        fetch: (...args: Parameters<typeof globalThis.fetch>): ReturnType<typeof globalThis.fetch> => globalThis.fetch(...args),
    });
    return new CloudflareApiService(client, logger);
}

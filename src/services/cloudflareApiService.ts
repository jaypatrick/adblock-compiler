// Typed wrapper around the official `cloudflare` TypeScript SDK.
// All Cloudflare REST API calls go through this service — never use raw fetch() to api.cloudflare.com.

import Cloudflare from 'cloudflare';
import type { ZoneListParams } from 'cloudflare/resources/zones/zones';
import type { PublicSchema, SchemaUpload } from 'cloudflare/resources/api-gateway/user-schemas/user-schemas';
import type { IBasicLogger } from '../types/index.ts';
import { silentLogger } from '../utils/logger.ts';

// ─── API Shield return-type helpers ──────────────────────────────────────────

export type { PublicSchema as ApiShieldSchema, SchemaUpload as ApiShieldUploadResult };

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

    async listApiShieldSchemas(zoneId: string): Promise<PublicSchema[]> {
        this.logger.info(`[CloudflareApiService] listApiShieldSchemas zoneId=${zoneId}`);

        const page = await this.client.apiGateway.userSchemas.list({ zone_id: zoneId, omit_source: false });
        return page.getPaginatedItems();
    }

    async uploadApiShieldSchema(zoneId: string, name: string, content: string): Promise<SchemaUpload> {
        this.logger.info(`[CloudflareApiService] uploadApiShieldSchema zoneId=${zoneId} name=${name}`);

        const file = new File([content], name, { type: 'application/yaml' });
        return await this.client.apiGateway.userSchemas.create({
            zone_id: zoneId,
            file,
            kind: 'openapi_v3',
            name,
        });
    }

    async enableApiShieldSchema(zoneId: string, schemaId: string): Promise<PublicSchema> {
        this.logger.info(`[CloudflareApiService] enableApiShieldSchema zoneId=${zoneId} schemaId=${schemaId}`);

        return await this.client.apiGateway.userSchemas.edit(schemaId, {
            zone_id: zoneId,
            validation_enabled: true,
        });
    }

    async deleteApiShieldSchema(zoneId: string, schemaId: string): Promise<void> {
        this.logger.info(`[CloudflareApiService] deleteApiShieldSchema zoneId=${zoneId} schemaId=${schemaId}`);

        await this.client.apiGateway.userSchemas.delete(schemaId, { zone_id: zoneId });
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

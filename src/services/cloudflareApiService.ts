/**
 * Cloudflare API Service — typed wrapper around the official `cloudflare` TypeScript SDK.
 *
 * Centralises all Cloudflare REST API calls (D1, KV, Workers, Queues, Zones) so that
 * individual scripts and worker handlers never need to construct raw `fetch` requests.
 *
 * @see https://github.com/cloudflare/cloudflare-typescript
 *
 * ## Usage
 *
 * ```typescript
 * import { createCloudflareApiService } from './cloudflareApiService.ts';
 *
 * const cfApi = createCloudflareApiService({ apiToken: Deno.env.get('CLOUDFLARE_API_TOKEN')! });
 *
 * // Query D1
 * const { result } = await cfApi.queryD1<{ id: number }>('acct-id', 'db-id', 'SELECT id FROM t WHERE x = ?', ['val']);
 *
 * // List KV namespaces
 * const namespaces = await cfApi.listKvNamespaces('acct-id');
 *
 * // List Worker scripts
 * const scripts = await cfApi.listWorkers('acct-id');
 *
 * // List Queues
 * const queues = await cfApi.listQueues('acct-id');
 *
 * // List Zones
 * const zones = await cfApi.listZones();
 * ```
 */

import Cloudflare from 'cloudflare';
import type { ZoneListParams } from 'cloudflare/resources/zones/zones';
import type { IBasicLogger } from '../types/index.ts';
import { silentLogger } from '../utils/logger.ts';

// ─── Return-type helpers ──────────────────────────────────────────────────────

/**
 * Result returned by {@link CloudflareApiService.queryD1}.
 * Mirrors the shape that the raw Cloudflare REST API returned so existing call-sites
 * require minimal changes.
 */
export interface D1QueryResult<T = unknown> {
    /** Flattened rows from all result sets returned by the SQL statement. */
    result: T[];
    /** Always `true` when the method returns; SDK throws on API errors. */
    success: boolean;
}

// ─── Service class ────────────────────────────────────────────────────────────

/**
 * Thin, testable service wrapping the official `cloudflare` SDK.
 *
 * Construct via the {@link createCloudflareApiService} factory for production use,
 * or pass a mock client directly for unit testing.
 */
export class CloudflareApiService {
    private readonly client: Cloudflare;
    private readonly logger: IBasicLogger;

    /**
     * @param client  - An initialised `Cloudflare` SDK instance (or a compatible mock).
     * @param logger  - Optional logger; defaults to the silent no-op logger.
     */
    constructor(client: Cloudflare, logger?: IBasicLogger) {
        this.client = client;
        this.logger = logger ?? silentLogger;
    }

    // ── D1 ───────────────────────────────────────────────────────────────────

    /**
     * Execute a SQL statement against a D1 database.
     *
     * @param accountId  - Cloudflare account identifier.
     * @param databaseId - D1 database identifier.
     * @param sql        - SQL statement (supports `?` placeholders).
     * @param params     - Optional positional parameters bound to the `?` placeholders.
     * @returns Flattened result rows cast to `T`, plus a `success` flag.
     */
    async queryD1<T = unknown>(
        accountId: string,
        databaseId: string,
        sql: string,
        params?: unknown[],
    ): Promise<D1QueryResult<T>> {
        this.logger.info(`[CloudflareApiService] queryD1: ${sql.slice(0, 80)}`);

        const page = await this.client.d1.database.query(databaseId, {
            account_id: accountId,
            sql,
            // The SDK types params as Array<string>, but D1 accepts any JSON primitive.
            params: params as Array<string> | undefined,
        });

        const queryResults = page.getPaginatedItems();
        const rows = queryResults.flatMap((qr) => (qr.results ?? []) as T[]);

        return { result: rows, success: true };
    }

    /**
     * List all D1 databases in the account.
     *
     * @param accountId - Cloudflare account identifier.
     */
    async listD1Databases(accountId: string) {
        this.logger.info(`[CloudflareApiService] listD1Databases`);

        const page = await this.client.d1.database.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── KV ───────────────────────────────────────────────────────────────────

    /**
     * List all KV namespaces in the account.
     *
     * @param accountId - Cloudflare account identifier.
     */
    async listKvNamespaces(accountId: string) {
        this.logger.info(`[CloudflareApiService] listKvNamespaces`);

        const page = await this.client.kv.namespaces.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── Workers ───────────────────────────────────────────────────────────────

    /**
     * List all Worker scripts in the account.
     *
     * @param accountId - Cloudflare account identifier.
     */
    async listWorkers(accountId: string) {
        this.logger.info(`[CloudflareApiService] listWorkers`);

        const page = await this.client.workers.scripts.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── Queues ────────────────────────────────────────────────────────────────

    /**
     * List all Queues in the account.
     *
     * @param accountId - Cloudflare account identifier.
     */
    async listQueues(accountId: string) {
        this.logger.info(`[CloudflareApiService] listQueues`);

        const page = await this.client.queues.list({ account_id: accountId });
        return page.getPaginatedItems();
    }

    // ── Zones ─────────────────────────────────────────────────────────────────

    /**
     * List zones, optionally filtered by the supplied parameters.
     *
     * @param params - Optional filtering/pagination parameters forwarded to the SDK.
     */
    async listZones(params?: ZoneListParams) {
        this.logger.info(`[CloudflareApiService] listZones`);

        const page = await this.client.zones.list(params ?? {});
        return page.getPaginatedItems();
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a production-ready {@link CloudflareApiService} authenticated with an API token.
 *
 * @param options.apiToken - A Cloudflare API token with the required permissions.
 * @param options.logger   - Optional logger forwarded to the service instance.
 */
export function createCloudflareApiService(options: { apiToken: string; logger?: IBasicLogger }): CloudflareApiService {
    const client = new Cloudflare({ apiToken: options.apiToken });
    return new CloudflareApiService(client, options.logger);
}

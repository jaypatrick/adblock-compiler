/**
 * @module neonApiService
 * Typed wrapper around the Neon REST API v2 for admin reporting and monitoring.
 *
 * All Neon platform calls go through this service — never use raw `fetch()` to
 * `console.neon.tech/api/v2`. SQL queries against the Neon database use the
 * `@neondatabase/serverless` driver.
 *
 * @example
 * ```ts
 * const neon = createNeonApiService({ apiKey: env.NEON_API_KEY });
 * const project = await neon.getProject('twilight-river-73901472');
 * const branches = await neon.listBranches(project.id);
 * ```
 */

import { z } from 'zod';
import type { IBasicLogger } from '../types/index.ts';
import { silentLogger } from '../utils/logger.ts';

// ── Neon API Error ───────────────────────────────────────────────────────────

/**
 * Structured error thrown by the Neon API service.
 * Includes the HTTP status code and the parsed response body so callers can
 * inspect both without re-fetching.
 */
export class NeonApiError extends Error {
    /** HTTP status code returned by the Neon REST API. */
    readonly status: number;
    /** Parsed JSON body from the error response (may be `undefined` for non-JSON responses). */
    readonly body: unknown;

    constructor(message: string, status: number, body?: unknown) {
        super(message);
        this.name = 'NeonApiError';
        this.status = status;
        this.body = body;
    }
}

// ── Zod Schemas ──────────────────────────────────────────────────────────────

/** Configuration for the Neon API service factory. */
export const NeonApiServiceConfigSchema = z.object({
    /** Neon API key (required). */
    apiKey: z.string().min(1, 'Neon API key is required'),
    /** Override the Neon REST API base URL. Defaults to the public v2 endpoint. */
    baseUrl: z.string().url().default('https://console.neon.tech/api/v2'),
});
export type NeonApiServiceConfig = z.infer<typeof NeonApiServiceConfigSchema>;

/** Schema for a Neon project (partial — fields we actually use). */
export const NeonProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    region_id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    pg_version: z.number().optional(),
});
export type NeonProject = z.infer<typeof NeonProjectSchema>;

/** Schema for a Neon branch. */
export const NeonBranchSchema = z.object({
    id: z.string(),
    name: z.string(),
    project_id: z.string(),
    parent_id: z.string().nullable(),
    current_state: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type NeonBranch = z.infer<typeof NeonBranchSchema>;

/** Schema for a Neon compute endpoint. */
export const NeonEndpointSchema = z.object({
    id: z.string(),
    host: z.string(),
    branch_id: z.string(),
    type: z.enum(['read_only', 'read_write']),
    current_state: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type NeonEndpoint = z.infer<typeof NeonEndpointSchema>;

/** Schema for a Neon database (within a branch). */
export const NeonDatabaseSchema = z.object({
    id: z.number(),
    name: z.string(),
    branch_id: z.string(),
    owner_name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type NeonDatabase = z.infer<typeof NeonDatabaseSchema>;

/** Schema for a Neon operation (branch create, endpoint start, etc.). */
export const NeonOperationSchema = z.object({
    id: z.string(),
    project_id: z.string(),
    branch_id: z.string().optional(),
    action: z.string(),
    status: z.enum(['running', 'finished', 'failed', 'scheduling']),
    created_at: z.string(),
    updated_at: z.string(),
});
export type NeonOperation = z.infer<typeof NeonOperationSchema>;

/** Schema for the Neon connection URI response. */
export const NeonConnectionUriSchema = z.object({
    uri: z.string(),
});
export type NeonConnectionUri = z.infer<typeof NeonConnectionUriSchema>;

// ── Options types ────────────────────────────────────────────────────────────

/** Options for creating a new branch. */
export interface CreateBranchOptions {
    /** Human-readable branch name. */
    name?: string;
    /** Parent branch ID to fork from (defaults to the primary branch). */
    parent_id?: string;
}

/** Options for retrieving a connection URI. */
export interface ConnectionUriOptions {
    /** Database name (defaults to `neondb`). */
    database_name?: string;
    /** Role name (defaults to the branch owner). */
    role_name?: string;
}

/** Result row from a Neon serverless SQL query. */
export type SqlRow = Record<string, unknown>;

// ── Service interface ────────────────────────────────────────────────────────

/** Public API surface of the Neon API service. */
export interface NeonApiService {
    /** Fetch a single Neon project by ID. */
    getProject(projectId: string): Promise<NeonProject>;

    /** List all branches for a project. */
    listBranches(projectId: string): Promise<NeonBranch[]>;

    /** Get details of a single branch. */
    getBranch(projectId: string, branchId: string): Promise<NeonBranch>;

    /** Create a new branch in a project. Returns the branch and any operations. */
    createBranch(projectId: string, opts?: CreateBranchOptions): Promise<{ branch: NeonBranch; operations: NeonOperation[] }>;

    /** Delete a branch. Returns the deleted branch and any operations. */
    deleteBranch(projectId: string, branchId: string): Promise<{ branch: NeonBranch; operations: NeonOperation[] }>;

    /** List compute endpoints for a project. */
    listEndpoints(projectId: string): Promise<NeonEndpoint[]>;

    /** List databases within a specific branch. */
    listDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]>;

    /** Retrieve a connection URI for a branch. */
    getConnectionUri(projectId: string, branchId: string, opts?: ConnectionUriOptions): Promise<string>;

    /**
     * Execute a SQL query via the Neon serverless driver (`@neondatabase/serverless`).
     * The `connectionString` should be a full `postgres://…` URI.
     */
    querySQL<T extends SqlRow = SqlRow>(connectionString: string, sql: string, params?: unknown[]): Promise<T[]>;
}

// ── Implementation ───────────────────────────────────────────────────────────

class NeonApiServiceImpl implements NeonApiService {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly logger: IBasicLogger;

    constructor(config: NeonApiServiceConfig, logger?: IBasicLogger) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
        this.logger = logger ?? silentLogger;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /**
     * Authenticated fetch against the Neon REST API.
     * Throws {@link NeonApiError} on non-2xx responses.
     */
    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        this.logger.info(`[NeonApiService] ${method} ${path}`);

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json',
        };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
            let errorBody: unknown;
            try {
                errorBody = await res.json();
            } catch {
                errorBody = await res.text().catch(() => undefined);
            }
            throw new NeonApiError(
                `Neon API ${method} ${path} failed with status ${res.status}`,
                res.status,
                errorBody,
            );
        }

        return (await res.json()) as T;
    }

    // ── Project ──────────────────────────────────────────────────────────────

    async getProject(projectId: string): Promise<NeonProject> {
        const data = await this.request<{ project: unknown }>('GET', `/projects/${projectId}`);
        return NeonProjectSchema.parse(data.project);
    }

    // ── Branches ─────────────────────────────────────────────────────────────

    async listBranches(projectId: string): Promise<NeonBranch[]> {
        const data = await this.request<{ branches: unknown[] }>('GET', `/projects/${projectId}/branches`);
        return data.branches.map((b) => NeonBranchSchema.parse(b));
    }

    async getBranch(projectId: string, branchId: string): Promise<NeonBranch> {
        const data = await this.request<{ branch: unknown }>('GET', `/projects/${projectId}/branches/${branchId}`);
        return NeonBranchSchema.parse(data.branch);
    }

    async createBranch(
        projectId: string,
        opts?: CreateBranchOptions,
    ): Promise<{ branch: NeonBranch; operations: NeonOperation[] }> {
        const body: Record<string, unknown> = {};
        if (opts?.name || opts?.parent_id) {
            const endpoints: Record<string, unknown> = {};
            if (opts.name) endpoints.name = opts.name;
            if (opts.parent_id) endpoints.parent_id = opts.parent_id;
            body.branch = endpoints;
        }
        const data = await this.request<{ branch: unknown; operations: unknown[] }>(
            'POST',
            `/projects/${projectId}/branches`,
            body,
        );
        return {
            branch: NeonBranchSchema.parse(data.branch),
            operations: data.operations.map((op) => NeonOperationSchema.parse(op)),
        };
    }

    async deleteBranch(
        projectId: string,
        branchId: string,
    ): Promise<{ branch: NeonBranch; operations: NeonOperation[] }> {
        const data = await this.request<{ branch: unknown; operations: unknown[] }>(
            'DELETE',
            `/projects/${projectId}/branches/${branchId}`,
        );
        return {
            branch: NeonBranchSchema.parse(data.branch),
            operations: data.operations.map((op) => NeonOperationSchema.parse(op)),
        };
    }

    // ── Endpoints ────────────────────────────────────────────────────────────

    async listEndpoints(projectId: string): Promise<NeonEndpoint[]> {
        const data = await this.request<{ endpoints: unknown[] }>('GET', `/projects/${projectId}/endpoints`);
        return data.endpoints.map((e) => NeonEndpointSchema.parse(e));
    }

    // ── Databases ────────────────────────────────────────────────────────────

    async listDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]> {
        const data = await this.request<{ databases: unknown[] }>(
            'GET',
            `/projects/${projectId}/branches/${branchId}/databases`,
        );
        return data.databases.map((d) => NeonDatabaseSchema.parse(d));
    }

    // ── Connection URI ───────────────────────────────────────────────────────

    async getConnectionUri(
        projectId: string,
        branchId: string,
        opts?: ConnectionUriOptions,
    ): Promise<string> {
        const params = new URLSearchParams({ branch_id: branchId });
        if (opts?.database_name) params.set('database_name', opts.database_name);
        if (opts?.role_name) params.set('role_name', opts.role_name);

        const data = await this.request<{ uri: string }>(
            'GET',
            `/projects/${projectId}/connection_uri?${params.toString()}`,
        );
        return NeonConnectionUriSchema.parse(data).uri;
    }

    // ── SQL via @neondatabase/serverless ──────────────────────────────────────

    async querySQL<T extends SqlRow = SqlRow>(
        connectionString: string,
        sql: string,
        params?: unknown[],
    ): Promise<T[]> {
        this.logger.info(`[NeonApiService] querySQL: ${sql.slice(0, 80)}`);
        const { neon: neonSql } = await import('@neondatabase/serverless');
        const sqlFn = neonSql(connectionString);
        // The neon() function returns a tagged-template driver. When called as a
        // plain function with (sql, params) it executes a parameterized query and
        // returns rows directly.
        const rows = await sqlFn(sql, params ?? []);
        return rows as T[];
    }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new {@link NeonApiService} instance.
 *
 * Validates the config with Zod and throws a `ZodError` if the API key is
 * missing or the base URL is not a valid URL.
 *
 * @param config - API key and optional base-URL override.
 * @param logger - Optional logger (defaults to silent no-op logger).
 * @returns A fully configured {@link NeonApiService}.
 *
 * @example
 * ```ts
 * const svc = createNeonApiService({ apiKey: 'napi_abc123' });
 * const proj = await svc.getProject('twilight-river-73901472');
 * ```
 */
export function createNeonApiService(
    config: { apiKey: string; baseUrl?: string },
    logger?: IBasicLogger,
): NeonApiService {
    const validated = NeonApiServiceConfigSchema.parse(config);
    return new NeonApiServiceImpl(validated, logger);
}

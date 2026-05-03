/**
 * Hono RPC API Client — typed, zero-boilerplate HTTP client generated from
 * the worker's `AppType`.
 *
 * Uses `hc<AppType>()` from `hono/client` to provide end-to-end type-safe
 * API calls between the Angular frontend and the Cloudflare Worker.
 *
 * ## Scope
 * - `ApiClientService` — covers **public, unauthenticated** endpoints.
 * - `AuthedApiClientService` — covers **authenticated** endpoints using the
 *   same `AppType` but with a manually-injected Bearer token + X-Trace-ID.
 *   Import from `./authed-api-client.service`.
 *
 * ## Usage (public endpoints)
 * ```ts
 * import { ApiClientService } from './services/api-client';
 *
 * @Component({ ... })
 * export class MyComponent {
 *   private readonly apiClient = inject(ApiClientService);
 *
 *   async checkHealth(): Promise<void> {
 *     const res = await this.apiClient.client.api.health.$get();
 *     const data = await res.json();
 *     console.log(data); // fully typed
 *   }
 * }
 * ```
 *
 * @see docs/architecture/hono-rpc-client.md — full usage guide
 */

import { Injectable, inject } from '@angular/core';
import { hc } from 'hono/client';
import type { ClientResponse } from 'hono/client';
import { API_BASE_URL } from '../tokens';

// ── AppType ───────────────────────────────────────────────────────────────────
//
// Re-exported from the worker's `worker/hono-app.ts`.  During development the
// worker is compiled with Deno; during Angular builds the type-only import is
// resolved by TypeScript's cross-project type checking via `tsconfig.json`
// `"paths"` or a shared `@bloqr-backend/worker-types` package.
//
// For the initial rollout we inline a minimal type definition that mirrors the
// public routes covered by this client (health, version, openapi.json).  Replace
// the `type AppType` import once the worker types are published as a package.

type TypedResponse<T> = Promise<ClientResponse<T>>;

// ── Shared response shapes ────────────────────────────────────────────────────

/** Compilation result returned by POST /api/compile and POST /api/compile/batch. */
export interface CompileResponseData {
    success: boolean;
    rules?: string[];
    ruleCount?: number;
    sources?: number;
    compiledAt?: string;
    cached?: boolean;
    deduplicated?: boolean;
    error?: string;
    benchmark?: { duration?: string; startTime?: number; endTime?: number };
    metrics?: {
        totalDuration?: number;
        sourceCount?: number;
        transformationCount?: number;
        inputRuleCount?: number;
        outputRuleCount?: number;
        phases?: Record<string, number>;
    };
}

/** Async compile result (202 queued) returned by POST /api/compile/async and /batch/async. */
export interface AsyncCompileResponseData {
    success: boolean;
    requestId: string;
    note: string;
    message?: string;
    batchSize?: number;
    priority?: string;
    error?: string;
}

/** Validation result returned by POST /api/validate. */
export interface ValidateResponseData {
    success: boolean;
    valid: boolean;
    totalRules: number;
    validRules: number;
    invalidRules: number;
    errors: Array<{
        line: number;
        column?: number;
        rule: string;
        errorType: string;
        message: string;
        severity: 'error' | 'warning' | 'info';
    }>;
    warnings: Array<{
        line: number;
        column?: number;
        rule: string;
        errorType: string;
        message: string;
        severity: 'error' | 'warning' | 'info';
    }>;
    duration?: string;
}

/** Validate-rule result returned by POST /api/validate-rule. */
export interface ValidateRuleResponseData {
    success: boolean;
    valid: boolean;
    rule?: string;
    errors?: string[];
}

/** A single saved rule set returned by GET/POST /api/rules. */
export interface RuleSetData {
    id: string;
    name: string;
    description?: string;
    rules: string[];
    createdAt: string;
    updatedAt: string;
}

/** List of saved rule sets returned by GET /api/rules. */
export interface RulesListData {
    success: boolean;
    ruleSets: RuleSetData[];
}

/**
 * AppType mirror covering both **public** and **authenticated** routes.
 *
 * Public routes (`/api/health`, `/api/version`, `/api/openapi.json`) are used
 * by `ApiClientService`.  Authenticated routes (`/api/compile`, `/api/validate`,
 * `/api/validate-rule`, `/api/rules`) are used by `AuthedApiClientService`.
 *
 * To use the real AppType from the worker:
 * ```ts
 * import type { AppType } from '../../../../worker/hono-app';
 * ```
 */
export type AppType = {
    api: {
        // ── Public endpoints ────────────────────────────────────────────────────
        health: {
            $get: () => TypedResponse<{
                status: 'healthy' | 'degraded' | 'down';
                version: string;
                timestamp: string;
                services: Record<string, { status: string; latency_ms?: number }>;
            }>;
        };
        version: {
            $get: () => TypedResponse<{
                version: string;
                environment?: string;
                buildTime?: string;
            }>;
        };
        'openapi.json': {
            $get: () => TypedResponse<Record<string, unknown>>;
        };
        // ── Authenticated endpoints (Free tier minimum) ─────────────────────────
        compile: {
            $post: (opts: {
                json: {
                    configuration: {
                        name: string;
                        sources: Array<{ source: string; useBrowser?: boolean }>;
                        transformations: string[];
                    };
                    benchmark?: boolean;
                    turnstileToken?: string;
                };
            }) => TypedResponse<CompileResponseData>;
        };
        validate: {
            $post: (opts: {
                json: { rules: string[]; strict?: boolean; turnstileToken?: string };
            }) => TypedResponse<ValidateResponseData>;
        };
        'validate-rule': {
            $post: (opts: {
                json: { rule: string; turnstileToken?: string };
            }) => TypedResponse<ValidateRuleResponseData>;
        };
        rules: {
            $get: () => TypedResponse<RulesListData>;
            $post: (opts: {
                json: { name: string; description?: string; rules: string[] };
            }) => TypedResponse<{ success: boolean; ruleSet: RuleSetData }>;
        };
    };
};

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Typed RPC client for the Adblock Compiler Worker API — **public endpoints only**.
 *
 * Wraps `hc<AppType>()` from `hono/client` with Angular's DI system so the
 * base URL is injected from the `API_BASE_URL` token (which differs between
 * browser and SSR environments).
 *
 * Use this service for unauthenticated endpoints (`/api/health`, `/api/version`,
 * `/api/openapi.json`).  For endpoints that require authentication (e.g. `POST /compile`)
 * use `AuthedApiClientService` which injects the Bearer token and trace ID header.
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
    /** Base URL injected from the `API_BASE_URL` token (e.g. `'/api'` in browser). */
    private readonly baseUrl = inject(API_BASE_URL);

    /**
     * Typed Hono RPC client.
     * Call methods directly:  `this.client.api.health.$get()`
     */
    readonly client: ReturnType<typeof hc<AppType>>;

    constructor() {
        // `API_BASE_URL` includes the `/api` prefix (e.g. `'/api'` in browser,
        // `${origin}/api` in SSR), while the generated `AppType` tree also
        // includes `/api` in its paths (e.g. `client.api.health` → `/api/health`).
        // Normalize to the worker origin (no `/api` suffix) before passing to `hc`
        // to avoid double-prefixing routes (`/api/api/health`).
        const workerOriginBase = this.baseUrl.replace(/\/api\/?$/, '') || '/';
        this.client = hc<AppType>(workerOriginBase);
    }
}

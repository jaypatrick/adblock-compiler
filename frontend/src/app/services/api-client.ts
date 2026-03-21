/**
 * Hono RPC API Client — typed, zero-boilerplate HTTP client generated from
 * the worker's `AppType`.
 *
 * Uses `hc<AppType>()` from `hono/client` to provide end-to-end type-safe
 * API calls between the Angular frontend and the Cloudflare Worker.
 *
 * ## Usage
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
// `"paths"` or a shared `@adblock-compiler/worker-types` package.
//
// For the initial rollout we inline a minimal type definition that mirrors the
// routes covered by this client (compile, health, api/version).  Replace the
// `type AppType` import once the worker types are published as a package.

/* eslint-disable @typescript-eslint/no-explicit-any */
type TypedResponse<T> = Promise<ClientResponse<T>>;

/**
 * Minimal AppType mirror for the three routes covered by this client.
 * Extend this as additional routes are onboarded to the typed RPC pattern.
 *
 * To use the real AppType from the worker:
 * ```ts
 * import type { AppType } from '../../../../worker/hono-app';
 * ```
 */
export type AppType = {
    api: {
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
    };
    compile: {
        $post: (args: {
            json: {
                configuration: {
                    name: string;
                    sources: Array<{ source: string; useBrowser?: boolean }>;
                    transformations: string[];
                };
                benchmark?: boolean;
                turnstileToken?: string;
                priority?: 'standard' | 'high';
            };
        }) => TypedResponse<{
            success: boolean;
            rules?: string[];
            ruleCount?: number;
            sources?: number;
            benchmark?: Record<string, unknown>;
            metrics?: Record<string, unknown>;
            compiledAt?: string;
            error?: string;
        }>;
    };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Typed RPC client for the Adblock Compiler Worker API.
 *
 * Wraps `hc<AppType>()` from `hono/client` with Angular's DI system so the
 * base URL is injected from the `API_BASE_URL` token (which differs between
 * browser and SSR environments).
 *
 * Prefer this service over raw `HttpClient` calls for endpoints that have a
 * corresponding type in `AppType` — the compiler ensures request/response
 * shapes stay in sync with the worker.
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

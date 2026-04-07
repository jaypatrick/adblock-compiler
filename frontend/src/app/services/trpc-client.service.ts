/**
 * TrpcClientService — Typed tRPC v11 client for consuming the Worker's tRPC API.
 *
 * Wraps the `createTrpcClient` factory from `worker/trpc/client.ts` as a proper
 * Angular service with full `AppRouter` inference and ZTA compliance.
 *
 * ## Why tRPC?
 * - **End-to-end type safety**: Procedure input/output types are inferred from
 *   the Worker's `AppRouter` definition. No manual sync between frontend and backend.
 * - **Automatic batching**: Multiple queries/mutations issued in the same tick
 *   are batched into a single HTTP request via `httpBatchLink`.
 * - **Lightweight**: No code generation step required — pure TypeScript inference.
 * - **Versioned API**: All procedures are namespaced under `v1.*` for stable versioning.
 *
 * ## Available procedures
 * - `v1.health.get` — query, public
 * - `v1.version.get` — query, public
 * - `v1.compile.json` — mutation, authenticated (requires Free tier+)
 *
 * ## Usage
 * ```ts
 * import { TrpcClientService } from './services/trpc-client.service';
 *
 * @Component({ ... })
 * export class MyComponent {
 *   private readonly trpc = inject(TrpcClientService);
 *
 *   async checkHealth(): Promise<void> {
 *     const health = await this.trpc.client.v1.health.get.query();
 *     console.log('Worker healthy:', health.healthy);
 *   }
 *
 *   async compile(): Promise<void> {
 *     const result = await this.trpc.client.v1.compile.json.mutate({
 *       configuration: {
 *         sources: [{ url: 'https://easylist.to/easylist/easylist.txt' }],
 *       },
 *     });
 *     console.log('Compiled rules:', result.ruleCount);
 *   }
 * }
 * ```
 *
 * ## ZTA compliance
 * - **No token storage**: The Bearer token is resolved per-call via
 *   `AuthFacadeService.getToken()` (which reads a short-lived Better Auth session
 *   cookie). Never stored in component state or localStorage.
 * - **Auth header attachment**: The `httpBatchLink` passes `() => this.auth.getToken()`
 *   as the `getToken` argument. When the token is available, tRPC automatically
 *   attaches `Authorization: Bearer <token>` to all requests. When the token is null,
 *   no auth header is attached (server will enforce auth on protected procedures).
 *
 * ## Base URL resolution
 * - Browser: `API_BASE_URL` is `/api` (relative, same origin). The service strips
 *   the `/api` suffix (using `this.baseUrl.replace(/\/api\/?$/, '') || ''`) so that
 *   `createTrpcClient` can append `/api/trpc` correctly.
 * - SSR: `API_BASE_URL` is an absolute URL (e.g. `https://adblock-compiler.<account>.workers.dev/api`).
 *   The service strips the `/api` suffix the same way, yielding the Worker origin.
 *
 * @see docs/architecture/trpc.md — full tRPC architecture guide
 * @see worker/trpc/client.ts — createTrpcClient factory
 * @see worker/trpc/router.ts — AppRouter type definition
 */

import { Injectable, inject } from '@angular/core';
import { createTrpcClient } from '../../../../../worker/trpc/client';
import type { AppRouter } from '../../../../../worker/trpc/router';
import { API_BASE_URL } from '../tokens';
import { AuthFacadeService } from './auth-facade.service';

@Injectable({ providedIn: 'root' })
export class TrpcClientService {
    private readonly baseUrl = inject(API_BASE_URL);
    private readonly auth = inject(AuthFacadeService);

    /**
     * Normalised worker origin (no `/api` suffix).
     *
     * This follows the same pattern as `AuthedApiClientService.workerOrigin`:
     * the `API_BASE_URL` token includes `/api` by default (e.g., '/api' in browser,
     * 'https://adblock-compiler.<account>.workers.dev/api' in SSR), but
     * `createTrpcClient` expects a base URL that it can append `/api/trpc` to.
     * We strip the trailing `/api` or `/api/` suffix here so the final URL is
     * `{workerOrigin}/api/trpc`.
     */
    private get workerOrigin(): string {
        return this.baseUrl.replace(/\/api\/?$/, '') || '';
    }

    /**
     * Fully-typed tRPC client with `AppRouter` inference.
     *
     * All procedures are namespaced under `v1`:
     * - `client.v1.health.get.query()` — health check (public)
     * - `client.v1.version.get.query()` — version info (public)
     * - `client.v1.compile.json.mutate({ configuration })` — compile (authenticated)
     *
     * The client automatically attaches `Authorization: Bearer <token>` when
     * `AuthFacadeService.getToken()` returns a non-null value. When the token is
     * null (user not signed in), no auth header is attached — the server will
     * enforce authentication on protected procedures.
     *
     * ## Batching
     * Multiple `query()`/`mutate()` calls in the same JavaScript microtask tick
     * are automatically batched into a single HTTP request via `httpBatchLink`.
     */
    readonly client: ReturnType<typeof createTrpcClient> = createTrpcClient(
        this.workerOrigin,
        // ZTA: token resolved per-call via AuthFacadeService.getToken(); never stored in state.
        () => this.auth.getToken(),
    );
}

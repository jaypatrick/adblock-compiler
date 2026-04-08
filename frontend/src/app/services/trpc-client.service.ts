/**
 * TrpcClientService — Runtime-validated tRPC v11 client for consuming the Worker's tRPC API.
 *
 * Wraps the frontend-local `createTrpcClient` factory from `frontend/src/app/trpc/client.ts`
 * as a proper Angular service with ZTA compliance.
 *
 * ## Why a separate factory?
 * The Worker's `worker/trpc/client.ts` uses Deno-style explicit `.ts` file extension
 * imports (`import type { AppRouter } from './router.ts'`) that are not supported by
 * Angular's `moduleResolution: "bundler"` tsconfig. A frontend-local factory in
 * `frontend/src/app/trpc/client.ts` mirrors the same logic without that import chain.
 *
 * ## Why tRPC?
 * - **Typed client surface with current limitations**: This service exposes the
 *   frontend-local tRPC client API, but does **not** currently provide end-to-end
 *   compile-time inference from the Worker's `AppRouter`. The frontend factory uses
 *   `createTRPCClient<any>` to avoid importing the Deno-style `.ts` extension chain
 *   from `worker/trpc/`, so backend/frontend procedure types are not guaranteed to
 *   stay in sync at compile time. Runtime validation is enforced by the Worker's
 *   Zod validators — see `frontend/src/app/trpc/client.ts` for the full trade-off.
 * - **Automatic batching**: Multiple queries/mutations issued in the same tick
 *   are batched into a single HTTP request via `httpBatchLink`.
 * - **Lightweight integration**: No code generation step required. The current setup
 *   relies on the frontend-local untyped factory rather than pure `AppRouter`-driven
 *   TypeScript inference.
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
 * - **No persistent token storage**: `TrpcClientService` does not store or cache
 *   tokens itself. On each request it calls `AuthFacadeService.getToken()`, which
 *   reads the current token from an in-memory signal managed by `BetterAuthService`
 *   (never written to `localStorage` or any persistent storage). The token is not
 *   held by this service between requests.
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
 * @see frontend/src/app/trpc/client.ts — frontend-safe createTrpcClient factory
 * @see worker/trpc/router.ts — AppRouter type definition (Deno/Worker only)
 */

import { Injectable, inject } from '@angular/core';
import { createTrpcClient } from '../trpc/client';
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
     * tRPC client for calling Worker procedures.
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
     *
     * ## Type note
     * The client is typed via `ReturnType<typeof createTrpcClient>`. The frontend
     * factory (`frontend/src/app/trpc/client.ts`) does not import `AppRouter` from
     * the worker tree to avoid Deno-style `.ts` extension import conflicts with
     * Angular's bundler. Runtime procedure validation is enforced by the server's
     * Zod validators.
     */
    readonly client: ReturnType<typeof createTrpcClient> = createTrpcClient(
        this.workerOrigin,
        // ZTA: token resolved per-call via AuthFacadeService.getToken(); never stored in state.
        () => this.auth.getToken(),
    );
}

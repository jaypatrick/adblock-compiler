/**
 * TypeScript interfaces for the typed tRPC client proxy.
 *
 * These interfaces give `TrpcClientService.client` proper compile-time type
 * checking for procedure paths, input shapes, and return types — closing the
 * gap documented in the Angular client factory (`frontend/src/app/trpc/client.ts`).
 *
 * ## How it works
 * `createTRPCClient<any>` is used internally to avoid traversing the Deno-style
 * `.ts`-extension import chain from `worker/trpc/`. The returned proxy is cast to
 * `TrpcTypedClient` so callers get TypeScript type safety without running
 * the server-side Deno code through Angular's bundler.
 *
 * ## Maintenance
 * When server-side procedures change (input/output shapes, new procedures, removed
 * procedures), update the corresponding interfaces here AND the Zod schemas in
 * `frontend/src/app/trpc/schemas.ts`.
 *
 * Adding a new tRPC version namespace (e.g. `v2`) means:
 *   1. Add the `Trpc<V2>Router` interface below.
 *   2. Add `v2: TrpcV2Router` to `TrpcTypedClient`.
 *   3. Add the matching Zod schemas in `schemas.ts`.
 *
 * @see worker/trpc/router.ts — canonical AppRouter type (Deno/Worker only)
 * @see worker/trpc/routers/v1/ — server-side procedure implementations
 * @see frontend/src/app/trpc/schemas.ts — Zod runtime validation schemas
 */

import type {
    TrpcVersionGetResponse,
    TrpcHealthGetResponse,
    TrpcCompileJsonInput,
    TrpcCompileJsonResponse,
} from './schemas';

// ---------------------------------------------------------------------------
// Procedure shape helpers
// ---------------------------------------------------------------------------

/**
 * Shape of a tRPC **query** procedure as returned by `createTRPCClient` with
 * `httpBatchLink`.
 *
 * When `TInput` is `void` (the default), `query()` is callable with no arguments.
 * When `TInput` is a concrete type, `query(input)` requires the argument.
 *
 * @template TOutput - Resolved return type of the procedure.
 * @template TInput  - Input type (defaults to `void` for parameterless queries).
 */
export interface TrpcQueryProcedure<TOutput, TInput = void> {
    query(...args: TInput extends void ? [] : [input: TInput]): Promise<TOutput>;
}

/**
 * Shape of a tRPC **mutation** procedure as returned by `createTRPCClient` with
 * `httpBatchLink`.
 *
 * @template TInput  - Accepted input type.
 * @template TOutput - Resolved return type.
 */
export interface TrpcMutationProcedure<TInput, TOutput> {
    mutate(input: TInput): Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// v1 router namespace
// ---------------------------------------------------------------------------

/**
 * Typed namespace for all v1 tRPC procedures.
 *
 * Mirrors the `v1Router` structure in `worker/trpc/routers/v1/index.ts`.
 * Add new procedure definitions here as the v1 router grows.
 */
export interface TrpcV1Router {
    health: {
        /**
         * Public query — returns the same payload as `GET /api/health`.
         * No authentication required.
         */
        get: TrpcQueryProcedure<TrpcHealthGetResponse>;
    };
    compile: {
        /**
         * Authenticated mutation — compiles the provided filter list sources.
         * Requires a Better Auth session or valid API key (Free tier+).
         * Delegates to `handleCompileJson` / `POST /api/compile`.
         */
        json: TrpcMutationProcedure<TrpcCompileJsonInput, TrpcCompileJsonResponse>;
    };
    version: {
        /**
         * Public query — returns `{ version, apiVersion }`.
         * No authentication required.
         */
        get: TrpcQueryProcedure<TrpcVersionGetResponse>;
    };
}

// ---------------------------------------------------------------------------
// Top-level typed client interface
// ---------------------------------------------------------------------------

/**
 * Typed tRPC client interface.
 *
 * Mirrors the `AppRouter` structure from `worker/trpc/router.ts` without
 * importing the Deno source tree. Add new version namespaces here when the
 * Worker introduces `v2`, `v3`, etc.
 *
 * @example
 * ```typescript
 * // Via TrpcClientService (recommended in Angular):
 * private readonly trpc = inject(TrpcClientService);
 *
 * // Public query
 * const { version, apiVersion } = await this.trpc.client.v1.version.get.query();
 *
 * // Authenticated mutation
 * const result = await this.trpc.client.v1.compile.json.mutate({
 *   configuration: {
 *     name: 'My List',
 *     sources: [{ source: 'https://easylist.to/easylist/easylist.txt' }],
 *   },
 * });
 * ```
 */
export interface TrpcTypedClient {
    v1: TrpcV1Router;
}

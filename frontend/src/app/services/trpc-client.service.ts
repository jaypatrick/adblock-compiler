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
 * ## Type safety
 * `TrpcClientService.client` is now typed as `TrpcTypedClient` — a frontend-local
 * interface in `frontend/src/app/trpc/types.ts` that mirrors the `AppRouter` structure.
 * TypeScript will catch typos in procedure paths and incorrect input shapes.
 * Runtime response validation is enforced by the Zod schemas in
 * `frontend/src/app/trpc/schemas.ts` via the helper methods below.
 *
 * ## Why tRPC?
 * - **Typed client surface**: Procedure paths and I/O shapes are checked at compile
 *   time via `TrpcTypedClient`. Update `types.ts` and `schemas.ts` when the Worker
 *   adds or changes procedures to keep the Angular client in sync.
 * - **Automatic batching**: Multiple queries/mutations issued in the same tick
 *   are batched into a single HTTP request via `httpBatchLink`.
 * - **Lightweight integration**: No code generation step required.
 * - **Versioned API**: All procedures are namespaced under `v1.*` for stable versioning.
 *
 * ## Available procedures
 * - `v1.health.get` — query, public
 * - `v1.version.get` — query, public
 * - `v1.compile.json` — mutation, authenticated (requires Free tier+)
 *
 * ## Signal helpers
 * Beyond raw procedure calls, `TrpcClientService` exposes Angular signal-native helpers:
 *
 * ### `query<T>(fn, schema)` — validated one-shot call
 * ```ts
 * const { version } = await this.trpc.query(
 *   () => this.trpc.client.v1.version.get.query(),
 *   TrpcVersionGetResponseSchema,
 * );
 * ```
 *
 * ### `createResource<P, T>(params, loader, schema)` — reactive Angular resource
 * ```ts
 * readonly versionResource = this.trpc.createResource(
 *   signal<void>(undefined),                     // reactive params signal
 *   () => this.trpc.client.v1.version.get.query(), // loader
 *   TrpcVersionGetResponseSchema,                // Zod schema for validation
 * );
 * // Template: {{ versionResource.value()?.version }}
 * ```
 *
 * ### `createMutation<TIn, TOut>(fn, schema)` — signal-based mutation
 * ```ts
 * readonly compileMutation = this.trpc.createMutation(
 *   (input: TrpcCompileJsonInput) => this.trpc.client.v1.compile.json.mutate(input),
 *   TrpcCompileJsonResponseSchema,
 * );
 * // Trigger: await this.compileMutation.mutate({ configuration: { ... } });
 * // State:   this.compileMutation.loading() / .error() / .result()
 * ```
 *
 * ## Usage (direct procedure calls)
 * ```ts
 * import { TrpcClientService } from './services/trpc-client.service';
 *
 * @Component({ ... })
 * export class MyComponent {
 *   private readonly trpc = inject(TrpcClientService);
 *
 *   async checkHealth(): Promise<void> {
 *     const health = await this.trpc.client.v1.health.get.query();
 *     console.log('Worker status:', health.status); // 'healthy' | 'degraded' | 'down'
 *   }
 *
 *   async compile(): Promise<void> {
 *     const result = await this.trpc.client.v1.compile.json.mutate({
 *       configuration: {
 *         name: 'My List',
 *         sources: [{ source: 'https://easylist.to/easylist/easylist.txt' }],
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
 *   (never written to browser storage or any persistent storage). The token is not
 *   held by this service between requests.
 * - **Auth header attachment**: The `httpBatchLink` passes `() => this.auth.getToken()`
 *   as the `getToken` argument. When the token is available, tRPC automatically
 *   attaches `Authorization: Bearer <token>` to all requests.
 * - **Response validation**: All responses passed through `query()`, `createResource()`,
 *   or `createMutation()` are validated against Zod schemas before being consumed.
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
 * @see frontend/src/app/trpc/types.ts — TrpcTypedClient interface
 * @see frontend/src/app/trpc/schemas.ts — Zod validation schemas
 * @see worker/trpc/router.ts — AppRouter type definition (Deno/Worker only)
 */

import { Injectable, Injector, Signal, inject, signal } from '@angular/core';
import { rxResource, ResourceRef } from '@angular/core/rxjs-interop';
import { from, EMPTY, map } from 'rxjs';
import { z } from 'zod';
import { createTrpcClient } from '../trpc/client';
import type { TrpcTypedClient } from '../trpc/types';
import { API_BASE_URL } from '../tokens';
import { AuthFacadeService } from './auth-facade.service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Signal-based mutation reference returned by `TrpcClientService.createMutation()`.
 *
 * @template TIn  - Input type for the mutation.
 * @template TOut - Validated output type.
 */
export interface TrpcMutationRef<TIn, TOut> {
    /** `true` while the mutation is in flight. */
    readonly loading: Signal<boolean>;
    /** The last error thrown by the mutation, or `null`. */
    readonly error: Signal<Error | null>;
    /** The last successful mutation result, or `null`. */
    readonly result: Signal<TOut | null>;
    /**
     * Invoke the mutation with the provided input.
     *
     * Validates the response against the Zod schema. Updates `loading`, `error`,
     * and `result` signals. Throws (re-throws) on error so callers can `await` and
     * handle failures in a try/catch if needed.
     */
    mutate: (input: TIn) => Promise<TOut>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

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
     * Typed tRPC client for calling Worker procedures.
     *
     * All procedures are namespaced under `v1`:
     * - `client.v1.health.get.query()` — health check (public)
     * - `client.v1.version.get.query()` — version info (public)
     * - `client.v1.compile.json.mutate({ configuration })` — compile (authenticated)
     *
     * The client automatically attaches `Authorization: Bearer <token>` when
     * `AuthFacadeService.getToken()` returns a non-null value.
     *
     * ## Type safety
     * The client is typed as `TrpcTypedClient` (see `frontend/src/app/trpc/types.ts`).
     * TypeScript will catch typos in procedure paths and incorrect input shapes.
     *
     * ## Batching
     * Multiple `query()`/`mutate()` calls in the same JavaScript microtask tick
     * are automatically batched into a single HTTP request via `httpBatchLink`.
     */
    readonly client: TrpcTypedClient = createTrpcClient(
        this.workerOrigin,
        // ZTA: token resolved per-call via AuthFacadeService.getToken(); never stored in state.
        () => this.auth.getToken(),
    );

    // -------------------------------------------------------------------------
    // Signal helpers
    // -------------------------------------------------------------------------

    /**
     * Executes a tRPC call and validates the response with a Zod schema.
     *
     * Use this for one-shot imperative calls (e.g. inside event handlers).
     * For reactive data that should update when component state changes,
     * use `createResource()` instead.
     *
     * ZTA: the `schema.safeParse()` call ensures the response conforms to the
     * expected shape before it is consumed by Angular code.
     *
     * @param fn     A zero-argument function that returns a tRPC procedure call promise.
     * @param schema Zod schema to validate the raw response against.
     * @returns      Validated, typed response.
     *
     * @example
     * ```ts
     * const { version } = await this.trpc.query(
     *   () => this.trpc.client.v1.version.get.query(),
     *   TrpcVersionGetResponseSchema,
     * );
     * ```
     */
    async query<T>(fn: () => Promise<unknown>, schema: z.ZodType<T>): Promise<T> {
        const raw = await fn();
        const result = schema.safeParse(raw);
        if (!result.success) {
            console.error('[ZTA][TrpcClientService] Invalid tRPC response:', result.error.format());
            throw new Error('Invalid tRPC response: ' + result.error.message);
        }
        return result.data;
    }

    /**
     * Creates a reactive Angular resource backed by a tRPC query.
     *
     * Uses `rxResource` from `@angular/core/rxjs-interop`. The resource re-runs
     * its loader whenever the `params` signal emits a new non-undefined value.
     * When `params()` returns `undefined`, the loader is not called and the
     * resource stays Idle.
     *
     * ZTA: responses are validated against `schema` before being surfaced to the
     * template or component code.
     *
     * @param params  A reactive signal of loader parameters. Return `undefined` to
     *                keep the resource Idle (no HTTP call).
     * @param loader  An async function that receives the current params value and
     *                returns a raw (unvalidated) tRPC response.
     * @param schema  Zod schema to validate the raw response against.
     * @param options Optional Angular injector override (for use outside injection context).
     * @returns       `ResourceRef<T>` with `.value()`, `.isLoading()`, `.error()`, and `.reload()`.
     *
     * @example
     * ```ts
     * // Reactive query — reload whenever userId changes
     * private readonly userId = signal<string | undefined>(undefined);
     *
     * readonly versionResource = this.trpc.createResource(
     *   this.userId,
     *   () => this.trpc.client.v1.version.get.query(),
     *   TrpcVersionGetResponseSchema,
     * );
     *
     * // Template:
     * // @if (versionResource.isLoading()) { <mat-spinner /> }
     * // @if (versionResource.value(); as v) { <span>{{ v.version }}</span> }
     * ```
     */
    createResource<P, T>(
        params: Signal<P | undefined>,
        loader: (p: P) => Promise<unknown>,
        schema: z.ZodType<T>,
        options?: { injector?: Injector },
    ): ResourceRef<T> {
        return rxResource<T, P | undefined>({
            params,
            stream: ({ params: p }) => {
                if (p === undefined) return EMPTY;
                return from(loader(p)).pipe(
                    map((raw) => {
                        const result = schema.safeParse(raw);
                        if (!result.success) {
                            console.error('[ZTA][TrpcClientService] Invalid tRPC response in resource:', result.error.format());
                            throw new Error('Invalid tRPC response: ' + result.error.message);
                        }
                        return result.data;
                    }),
                );
            },
            injector: options?.injector,
        });
    }

    /**
     * Creates a signal-based mutation reference for a tRPC procedure.
     *
     * Returns a `TrpcMutationRef` with reactive `loading`, `error`, and `result`
     * signals and a `mutate()` method. Use this in components that need to track
     * the in-flight state of a mutation without managing signals manually.
     *
     * ZTA: responses are validated against `schema` before being surfaced to the
     * component.
     *
     * @param fn     A function that takes the mutation input and returns a tRPC procedure
     *               call promise (the raw, unvalidated response). The `mutate()` method
     *               on the returned ref validates this response with `schema` and returns
     *               the typed, validated result.
     * @param schema Zod schema to validate the raw response against.
     * @returns      `TrpcMutationRef<TIn, TOut>` with `loading`, `error`, `result` signals
     *               and a `mutate()` method that validates and returns the typed response.
     *
     * @example
     * ```ts
     * readonly compileMutation = this.trpc.createMutation(
     *   (input: TrpcCompileJsonInput) => this.trpc.client.v1.compile.json.mutate(input),
     *   TrpcCompileJsonResponseSchema,
     * );
     *
     * // Trigger from event handler:
     * async onCompile(): Promise<void> {
     *   try {
     *     const result = await this.compileMutation.mutate({ configuration: { ... } });
     *     console.log('Rules compiled:', result.ruleCount);
     *   } catch {
     *     // compileMutation.error() is already set
     *   }
     * }
     *
     * // Template:
     * // @if (compileMutation.loading()) { <mat-spinner /> }
     * // @if (compileMutation.error(); as err) { <p class="error">{{ err.message }}</p> }
     * ```
     */
    createMutation<TIn, TOut>(
        fn: (input: TIn) => Promise<unknown>,
        schema: z.ZodType<TOut>,
    ): TrpcMutationRef<TIn, TOut> {
        const loading = signal(false);
        const error = signal<Error | null>(null);
        const result = signal<TOut | null>(null);

        const mutate = async (input: TIn): Promise<TOut> => {
            loading.set(true);
            error.set(null);
            try {
                const raw = await fn(input);
                const parsed = schema.safeParse(raw);
                if (!parsed.success) {
                    console.error('[ZTA][TrpcClientService] Invalid tRPC mutation response:', parsed.error.format());
                    throw new Error('Invalid tRPC response: ' + parsed.error.message);
                }
                result.set(parsed.data);
                return parsed.data;
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                error.set(err);
                throw err;
            } finally {
                loading.set(false);
            }
        };

        return {
            loading: loading.asReadonly(),
            error: error.asReadonly(),
            result: result.asReadonly(),
            mutate,
        };
    }
}

/**
 * Frontend-safe tRPC client factory.
 *
 * This module mirrors the `createTrpcClient` factory from `worker/trpc/client.ts`
 * but lives entirely within the Angular project so that the Angular bundler
 * (`moduleResolution: "bundler"`) never has to traverse the Worker tree, which
 * uses Deno-style explicit `.ts` file extensions that Angular's bundler does not
 * support.
 *
 * ## Why a separate file?
 * `worker/trpc/client.ts` imports `import type { AppRouter } from './router.ts'`.
 * Angular's bundler and TypeScript compiler resolve that chain (`router.ts` →
 * `init.ts` → ...) and fail because those files use `.ts` extensions in their
 * import specifiers, which requires `allowImportingTsExtensions` (a Deno/Node
 * flag not set in the Angular tsconfig).
 *
 * ## Type safety via frontend-local interface
 * This factory calls `createTRPCClient<any>` internally but casts the result to
 * `TrpcTypedClient` — a manually maintained TypeScript interface that mirrors the
 * `AppRouter` structure from `worker/trpc/router.ts`. This provides:
 *   - Compile-time checking for procedure paths (`v1.health.get`, `v1.compile.json`, …)
 *   - Typed input shapes (TypeScript will flag incorrect payload fields)
 *   - Typed response shapes (used with Zod schemas in `TrpcClientService` for ZTA)
 *
 * The trade-off vs. a true `createTRPCClient<AppRouter>` setup:
 *   - `TrpcTypedClient` must be updated manually when procedures change on the server.
 *   - TypeScript will not detect drift between this interface and the Worker until the
 *     developer updates `frontend/src/app/trpc/types.ts` and `schemas.ts`.
 *
 * > **When the Worker adds or changes procedures**: update `types.ts` and `schemas.ts`
 * > in this directory to keep the Angular client in sync.
 *
 * @see worker/trpc/client.ts — canonical server-side factory (Deno/Node only)
 * @see frontend/src/app/trpc/types.ts — `TrpcTypedClient` interface
 * @see frontend/src/app/trpc/schemas.ts — Zod runtime validation schemas
 * @see TrpcClientService — Angular DI wrapper (use this in Angular components)
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { TrpcTypedClient } from './types';

/**
 * Creates a typed tRPC HTTP batch client pointed at the Worker's `/api/trpc` endpoint.
 *
 * @param baseUrl  Worker origin (no `/api` suffix — the factory appends `/api/trpc`).
 *                 Examples: `''` (same-origin, browser), `'https://bloqr-backend.<account>.workers.dev'` (SSR/CLI).
 * @param getToken Optional async getter that returns a Bearer token string or `null`.
 *                 Called on every request. Never cached by this factory.
 * @returns        `TrpcTypedClient` — typed proxy over `createTRPCClient<any>`.
 *                 Procedure paths, input shapes, and response shapes are checked
 *                 at compile time via the frontend-local interface in `types.ts`.
 */
export function createTrpcClient(
    baseUrl: string,
    getToken?: () => Promise<string | null>,
): TrpcTypedClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createTRPCClient<any>({
        links: [
            httpBatchLink({
                url: `${baseUrl}/api/trpc`,
                async headers() {
                    const token = await getToken?.();
                    return token ? { Authorization: `Bearer ${token}` } : {};
                },
            }),
        ],
    }) as unknown as TrpcTypedClient;
}

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
 * ## Intentionally untyped — no `AppRouter` generic
 * This factory calls `createTRPCClient<any>`, meaning the returned client has
 * **no compile-time type checking** for procedure names, input shapes, or return
 * types. TypeScript will not catch:
 *   - Typos in procedure paths (e.g. `v1.version.get` vs `v1.version.fetch`)
 *   - Incorrect input payloads
 *   - Incorrect assumptions about response shapes
 *
 * Runtime safety is still enforced by the Worker's Zod validators — unknown
 * procedure paths return 404 and invalid payloads return 400. However, these
 * errors surface at runtime rather than at compile time.
 *
 * To restore end-to-end compile-time type safety, introduce a frontend-consumable
 * `AppRouter` type surface (e.g. a generated `.d.ts` or a `types/` shared package)
 * and change the return type to `createTRPCClient<AppRouter>`.
 *
 * > **Caution for callers**: Rely on the procedure names documented in
 * > `docs/architecture/trpc.md` and verify against `worker/trpc/routers/v1/`
 * > whenever the Worker's API evolves, since TypeScript will not surface drift.
 *
 * @see worker/trpc/client.ts — canonical server-side factory (Deno/Node only)
 * @see TrpcClientService — Angular DI wrapper (use this in Angular components)
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';

/**
 * Creates a tRPC HTTP batch client pointed at the Worker's `/api/trpc` endpoint.
 *
 * @param baseUrl  Worker origin (no `/api` suffix — the factory appends `/api/trpc`).
 *                 Examples: `''` (same-origin, browser), `'https://adblock-compiler.<account>.workers.dev'` (SSR/CLI).
 * @param getToken Optional async getter that returns a Bearer token string or `null`.
 *                 Called on every request. Never cached by this factory.
 * @returns        Untyped tRPC client proxy (`createTRPCClient<any>`). Accepts
 *                 any procedure path at runtime — no compile-time procedure/payload
 *                 type checking. See module-level JSDoc for context.
 */
export function createTrpcClient(
    baseUrl: string,
    getToken?: () => Promise<string | null>,
): ReturnType<typeof createTRPCClient> {
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
    });
}

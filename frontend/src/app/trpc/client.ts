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
 * ## Type safety
 * The returned client is typed as `ReturnType<typeof createTRPCClient>`.
 * Without the `AppRouter` generic, callers get a dynamically-proxied client
 * that accepts any procedure path at runtime. The tRPC wire protocol is still
 * enforced; the Worker validates all inputs with Zod and rejects unknown paths.
 *
 * > **Caution for callers**: Because `AppRouter` is not imported here, TypeScript
 * > will **not** catch typos in procedure names or incorrect payload shapes at
 * > compile time. Use the procedure names documented in `trpc.md` and verify
 * > against `worker/trpc/routers/v1/` when the Worker's API evolves.
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
 * @returns        Typed tRPC client proxy. The exact return type is inferred from
 *                 `createTRPCClient` and accepts any tRPC procedure path.
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

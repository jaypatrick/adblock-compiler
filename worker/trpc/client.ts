/**
 * Typed tRPC client for Angular and other API consumers.
 *
 * Usage in Angular service:
 *   const client = createTrpcClient('https://adblock-compiler.jayson-knight.workers.dev',
 *                                   () => authService.getToken());
 *   const health = await client.v1.health.get.query();
 *   const result = await client.v1.compile.json.mutate({
 *     configuration: {
 *       sources: [{ url: 'https://example.com/filters.txt' }],
 *     },
 *   });
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from './router.ts';

export function createTrpcClient(baseUrl: string, getToken?: () => Promise<string | null>) {
    return createTRPCClient<AppRouter>({
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

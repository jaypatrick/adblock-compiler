/**
 * Hono adapter for the tRPC router.
 *
 * Mounts the tRPC app at `/api/trpc` using the fetch adapter.
 * Auth context is already populated by the global middleware chain before
 * this handler runs — no additional middleware wiring is needed.
 *
 * ZTA telemetry: UNAUTHORIZED and FORBIDDEN tRPC errors emit
 * `AnalyticsService.trackSecurityEvent()`.
 */

import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { Context } from 'hono';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import type { Env, IAuthContext } from '../types.ts';
import { appRouter } from './router.ts';
import { createTrpcContext } from './context.ts';

/** Minimal subset of Hono Variables needed by the tRPC handler. */
interface AppVars {
    authContext: IAuthContext;
    analytics: AnalyticsService;
    requestId: string;
    ip: string;
    isSSR: boolean;
}

export async function handleTrpcRequest(c: Context<{ Bindings: Env; Variables: AppVars }>): Promise<Response> {
    const analytics = c.get('analytics');
    const ip = c.get('ip') ?? '';

    return fetchRequestHandler({
        endpoint: '/api/trpc',
        req: c.req.raw,
        router: appRouter,
        createContext: () => createTrpcContext(c),
        onError({ error, path }) {
            if (error instanceof TRPCError) {
                if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') {
                    analytics?.trackSecurityEvent({
                        eventType: 'auth_failure',
                        path: `/api/trpc/${path ?? ''}`,
                        method: 'POST',
                        clientIpHash: AnalyticsService.hashIp(ip),
                        reason: error.code === 'UNAUTHORIZED' ? 'trpc_unauthorized' : 'trpc_forbidden',
                    });
                }
            }
        },
    });
}

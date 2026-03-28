/**
 * tRPC context factory.
 *
 * Creates the tRPC context from a Hono request context.
 * The global unified-auth middleware in hono-app.ts already populates
 * `authContext` on `c` before the tRPC handler is reached.
 */

import type { Context } from 'hono';
import type { Env, IAuthContext } from '../types.ts';
import type { AnalyticsService } from '../../src/services/AnalyticsService.ts';

/** Minimal subset of Hono Variables needed by the tRPC context. */
interface AppVars {
    authContext: IAuthContext;
    analytics: AnalyticsService;
    requestId: string;
    ip: string;
    isSSR: boolean;
}

export interface TrpcContext {
    env: Env;
    authContext: IAuthContext;
    requestId: string;
    ip: string;
    analytics: AnalyticsService;
}

export function createTrpcContext(c: Context<{ Bindings: Env; Variables: AppVars }>): TrpcContext {
    return {
        env: c.env,
        authContext: c.get('authContext'),
        requestId: c.get('requestId') ?? crypto.randomUUID(),
        ip: c.get('ip') ?? '',
        analytics: c.get('analytics'),
    };
}

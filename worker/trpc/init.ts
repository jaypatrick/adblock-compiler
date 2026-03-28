/**
 * tRPC initialisation — defines the base `t` instance and procedure builders.
 *
 * Procedure types:
 *   - `publicProcedure`    — no auth required
 *   - `protectedProcedure` — requires authenticated session (userId non-null)
 *   - `adminProcedure`     — requires admin role
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context.ts';

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/** Procedure that requires an authenticated session (non-anonymous authContext). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.authContext.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    return next({ ctx });
});

/** Procedure that requires admin role. */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.authContext.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin role required.' });
    }
    return next({ ctx });
});

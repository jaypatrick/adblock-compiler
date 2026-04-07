/**
 * tRPC v1 compile router.
 *
 * v1.compile.json (mutation, authenticated) — accepts a CompileRequestSchema body
 * and returns the compiled ruleset JSON.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from '../../init.ts';
import { CompileRequestSchema } from '../../../../src/configuration/schemas.ts';
import { handleCompileJson } from '../../../handlers/compile.ts';
import { buildSyntheticRequest } from '../../../utils/synthetic-request.ts';

export const compileRouter = router({
    json: protectedProcedure
        // Use a parser function to avoid the jsr:@zod/zod ↔ npm:zod module-identity
        // mismatch that would force `as any`. The function approach preserves full
        // TypeScript inference of the compile request type on both client and server.
        .input((input: unknown): z.infer<typeof CompileRequestSchema> => {
            const result = CompileRequestSchema.safeParse(input);
            if (!result.success) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: result.error.message,
                    cause: result.error,
                });
            }
            return result.data;
        })
        .mutation(async ({ input, ctx }) => {
            const req = buildSyntheticRequest(JSON.stringify(input));
            const res = await handleCompileJson(req, ctx.env, ctx.analytics, ctx.requestId);
            return res.json();
        }),
});

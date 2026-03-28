/**
 * tRPC v1 compile router.
 *
 * v1.compile.json (mutation, authenticated) — accepts a CompileRequestSchema body
 * and returns the compiled ruleset JSON.
 */

import { protectedProcedure, router } from '../../init.ts';
import { CompileRequestSchema } from '../../../../src/configuration/schemas.ts';
import { handleCompileJson } from '../../../handlers/compile.ts';
import { buildSyntheticRequest } from '../../../utils/synthetic-request.ts';

export const compileRouter = router({
    json: protectedProcedure
        // deno-lint-ignore no-explicit-any
        .input(CompileRequestSchema as any)
        .mutation(async ({ input, ctx }) => {
            const req = buildSyntheticRequest(JSON.stringify(input));
            const res = await handleCompileJson(req, ctx.env, ctx.analytics, ctx.requestId);
            return res.json();
        }),
});

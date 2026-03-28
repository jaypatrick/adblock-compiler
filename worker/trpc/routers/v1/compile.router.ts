/**
 * tRPC v1 compile router.
 *
 * v1.compile.json (mutation, authenticated) — accepts a CompileRequestSchema body
 * and returns the compiled ruleset JSON.
 */

import { protectedProcedure, router } from '../../init.ts';
// deno-lint-ignore no-explicit-any
import { CompileRequestSchema } from '../../../../src/configuration/schemas.ts';
import { handleCompileJson } from '../../../handlers/compile.ts';

/** Build a minimal synthetic POST Request from a JSON body string. */
function makeSyntheticRequest(body: string): Request {
    return new Request('https://worker.local', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body,
    });
}

export const compileRouter = router({
    json: protectedProcedure
        // deno-lint-ignore no-explicit-any
        .input(CompileRequestSchema as any)
        .mutation(async ({ input, ctx }) => {
            const req = makeSyntheticRequest(JSON.stringify(input));
            const res = await handleCompileJson(req, ctx.env, ctx.analytics, ctx.requestId);
            return res.json();
        }),
});

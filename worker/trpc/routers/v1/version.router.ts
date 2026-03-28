/**
 * tRPC v1 version router.
 *
 * v1.version.get (query, public) — returns the Worker version and API version.
 */

import { publicProcedure, router } from '../../init.ts';

export const versionRouter = router({
    get: publicProcedure.query(({ ctx }) => ({
        version: ctx.env.COMPILER_VERSION || 'unknown',
        apiVersion: 'v1',
    })),
});

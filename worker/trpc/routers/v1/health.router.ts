/**
 * tRPC v1 health router.
 *
 * v1.health.get (query, public) — returns the same payload as GET /api/health.
 */

import { publicProcedure, router } from '../../init.ts';
import { handleHealth } from '../../../handlers/health.ts';

export const healthRouter = router({
    get: publicProcedure.query(async ({ ctx }) => {
        const res = await handleHealth(ctx.env);
        return res.json();
    }),
});

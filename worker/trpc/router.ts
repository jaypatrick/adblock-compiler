/**
 * Top-level versioned tRPC router.
 *
 * All tRPC procedures are namespaced under `v1`. Future breaking changes will
 * be introduced under `v2` without removing `v1`.
 */

import { router } from './init.ts';
import { v1Router } from './routers/v1/index.ts';

export const appRouter = router({
    v1: v1Router,
});

export type AppRouter = typeof appRouter;

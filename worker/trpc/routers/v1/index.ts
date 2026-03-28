/**
 * tRPC v1 barrel — assembles all v1 procedure routers.
 */

import { router } from '../../init.ts';
import { healthRouter } from './health.router.ts';
import { compileRouter } from './compile.router.ts';
import { versionRouter } from './version.router.ts';

export const v1Router = router({
    health: healthRouter,
    compile: compileRouter,
    version: versionRouter,
});

export type V1Router = typeof v1Router;

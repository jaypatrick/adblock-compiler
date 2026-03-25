/**
 * Dynamic Workers subsystem — public API barrel export.
 *
 * Re-exports the loader utilities and types for use by the rest of the
 * Worker codebase.
 *
 * @see worker/dynamic-workers/loader.ts — orchestration helpers
 * @see worker/dynamic-workers/types.ts  — canonical types
 * @see ideas/CLOUDFLARE_DYNAMIC_WORKERS_PIVOT.md
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

export {
    getOrCreateUserAgent,
    runAstParseInDynamicWorker,
    runValidateInDynamicWorker,
} from './loader.ts';

export type {
    AgentWorkerId,
    DynamicAstParseOptions,
    DynamicValidateOptions,
    DynamicWorkerResult,
} from './types.ts';

export {
    isLoaderAvailable,
    makeAgentWorkerId,
} from './types.ts';

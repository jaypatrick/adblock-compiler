/**
 * Barrel export for the `worker/dynamic-workers` module.
 *
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

export type {
    AgentWorkerId,
    DynamicAstParseOptions,
    DynamicValidateOptions,
    DynamicWorkerBindings,
    DynamicWorkerHandle,
    DynamicWorkerLoader,
    DynamicWorkerResult,
    DynamicWorkerTask,
    DynamicWorkerTaskType,
    DynamicWorkerTransport,
} from './types.ts';
export { isLoaderAvailable, makeAgentWorkerId } from './types.ts';
export { AST_PARSE_WORKER_SOURCE } from './sources.ts';
export { dispatchToDynamicWorker, getOrCreateUserAgent, isDynamicWorkerAvailable, runAstParseInDynamicWorker, runValidateInDynamicWorker } from './loader.ts';

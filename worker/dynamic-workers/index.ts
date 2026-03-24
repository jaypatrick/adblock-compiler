/**
 * Barrel export for the `worker/dynamic-workers` module.
 *
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

export type {
    DynamicWorkerBindings,
    DynamicWorkerHandle,
    DynamicWorkerLoader,
    DynamicWorkerTask,
    DynamicWorkerTaskType,
    DynamicWorkerTransport,
} from './types.ts';
export { dispatchToDynamicWorker, isDynamicWorkerAvailable } from './loader.ts';
export { AST_PARSE_WORKER_SOURCE } from './sources.ts';

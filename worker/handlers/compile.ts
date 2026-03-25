/**
 * Compile handlers for the Cloudflare Worker.
 * Provides compilation endpoints for filter lists.
 */

import { WORKER_DEFAULTS } from '../../src/config/defaults.ts';
import { createTracingContext, type ICompilerEvents, WorkerCompiler } from '../../src/index.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import { generateRequestId, JsonResponse } from '../utils/index.ts';
import { createWorkerErrorReporter } from '../utils/errorReporter.ts';
import { ErrorUtils } from '../../src/utils/ErrorUtils.ts';
import { recordMetric } from './metrics.ts';
import { compress, decompress, emitDiagnosticsToTailWorker, getCacheKey, QUEUE_BINDINGS_NOT_AVAILABLE_ERROR, updateQueueStats } from './queue.ts';
import type { BatchRequest, CompilationResult, CompileQueueMessage, CompileRequest, Env, PreviousVersion, Priority } from '../types.ts';
import { BatchRequestAsyncSchema, BatchRequestSyncSchema, CompileRequestSchema } from '../../src/configuration/schemas.ts';
import { AstParseRequestSchema } from '../schemas.ts';
import { AST_PARSE_WORKER_SOURCE, dispatchToDynamicWorker, type DynamicWorkerTask, isDynamicWorkerAvailable } from '../dynamic-workers/index.ts';

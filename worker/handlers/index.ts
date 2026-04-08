/**
 * Handler exports for the Cloudflare Worker.
 */

// Admin handlers
export {
    handleAdminClearCache,
    handleAdminClearExpired,
    handleAdminExport,
    handleAdminListTables,
    handleAdminQuery,
    handleAdminStorageStats,
    handleAdminVacuum,
    routeAdminStorage,
} from './admin.ts';

// Asset / SPA serving handlers
export { fetchAssetWithRedirects, fetchSpaShell, serveStaticAsset, serveWebUI } from './assets.ts';

// Browser Rendering handlers
export { handleMonitorLatest } from './monitor-latest.ts';
export { handleResolveUrl } from './url-resolver.ts';
export { handleSourceMonitor } from './source-monitor.ts';

// Compile handlers
export { handleASTParseRequest, handleCompileAsync, handleCompileBatch, handleCompileBatchAsync, handleCompileJson, handleCompileStream, handleValidate } from './compile.ts';

// Health check handlers
export { handleHealth, handleHealthLatest } from './health.ts';

// Info / API metadata handlers
export { handleInfo, routeApiMeta } from './info.ts';

// Metrics handlers
export { handleMetrics, recordMetric } from './metrics.ts';

// Queue handlers
export {
    compress,
    decompress,
    emitDiagnosticsToTailWorker,
    getCacheKey,
    handleQueue,
    handleQueueCancel,
    handleQueueHistory,
    handleQueueResults,
    handleQueueStats,
    processCompileMessage,
    QUEUE_BINDINGS_NOT_AVAILABLE_ERROR,
    routeQueue,
    updateQueueStats,
} from './queue.ts';

// Core request router (extracted from worker.ts _handleRequest)
export { handleRequest } from './router.ts';

// Scheduled cron handler
export { handleScheduled } from './scheduled.ts';

// Rule validation handler (POST /api/validate-rule)
export { handleValidateRule } from './validate-rule.ts';

// Diff handler (POST /api/diff)
export { handleDiff } from './diff.ts';

// Rule management handlers (POST/GET/PUT/DELETE /api/rules)
export { handleRulesCreate, handleRulesDelete, handleRulesGet, handleRulesList, handleRulesUpdate } from './rules.ts';

// Webhook / notification handler (POST /api/notify)
export { handleNotify } from './webhook.ts';

// Prometheus metrics handler (GET /metrics/prometheus)
export { handlePrometheusMetrics } from './prometheus-metrics.ts';

// Workflow handlers
export {
    handleWorkflowBatchCompile,
    handleWorkflowCacheWarm,
    handleWorkflowCompile,
    handleWorkflowEvents,
    handleWorkflowHealthCheck,
    handleWorkflowMetrics,
    handleWorkflowStatus,
    routeWorkflow,
    WORKFLOW_BINDINGS_NOT_AVAILABLE_ERROR,
} from './workflow.ts';

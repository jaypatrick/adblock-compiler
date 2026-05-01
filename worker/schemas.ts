/**
 * Zod schemas for worker runtime validation.
 * Provides type-safe validation for worker requests, queue messages, and workflow parameters.
 */

import { z } from 'zod';
import { ConfigurationSchema, PrioritySchema } from '../src/configuration/schemas.ts';
import { AuthScope, UserTier } from './types.ts';

// ============================================================================
// Basic Enums and Constants
// ============================================================================

// PrioritySchema is re-exported from src/configuration/schemas.ts to avoid duplication.
export { PrioritySchema } from '../src/configuration/schemas.ts';

/**
 * Queue message type schema
 */
export const QueueMessageTypeSchema = z.enum(['compile', 'batch-compile', 'cache-warm']).describe('Type of queue message');

/**
 * Workflow status schema
 */
export const WorkflowStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'paused', 'terminated']).describe('Current workflow execution status');

// ============================================================================
// AST Parse Request Schema
// ============================================================================
// Note: CompileRequestSchema, BatchRequestSchema, BatchRequestSyncSchema, and
// BatchRequestAsyncSchema are available from '../src/configuration/schemas.ts'
// and can be imported directly when needed in worker context.

/**
 * Schema for AST parse request
 */
export const ASTParseRequestSchema = z.object({
    rules: z.array(z.string()).optional(),
    text: z.string().optional(),
}).refine(
    (data) => data.rules !== undefined || data.text !== undefined,
    {
        message: 'Either rules or text must be provided',
    },
);

// ============================================================================
// AST Walk Request/Response Schemas
// ============================================================================

/**
 * Maximum number of rules accepted in a single /ast/walk request.
 * Prevents DoS via large payloads.
 */
const AST_WALK_MAX_RULES = 5_000;

/**
 * Maximum depth the walker will descend.
 * Prevents runaway traversal on pathological inputs.
 */
const AST_WALK_MAX_DEPTH = 50;

/**
 * All AGTree node type strings that the typed visitor map recognises.
 * Kept in sync with {@link AGTreeTypedVisitor} in src/utils/AGTreeWalker.ts.
 */
const AGTreeNodeTypeSchema = z.enum([
    'FilterList',
    'NetworkRule',
    'HostRule',
    'ModifierList',
    'Modifier',
    'HostnameList',
    'ElementHidingRule',
    'ElementHidingRuleBody',
    'CssInjectionRule',
    'CssInjectionRuleBody',
    'ScriptletInjectionRule',
    'ScriptletInjectionRuleBody',
    'HtmlFilteringRule',
    'JsInjectionRule',
    'DomainList',
    'Domain',
    'CommentRule',
    'MetadataCommentRule',
    'HintCommentRule',
    'ConfigCommentRule',
    'ConfigNode',
    'AgentCommentRule',
    'PreProcessorCommentRule',
    'EmptyRule',
    'Value',
    'ParameterList',
    'Hint',
    'Agent',
    'Operator',
    'Parenthesis',
    'Variable',
    'App',
    'Method',
    'StealthOption',
    'InvalidRule',
]);

/**
 * Zod schema for POST /ast/walk request body.
 *
 * Either `rules` (an array of raw rule strings) or `text` (a full filter list
 * as a single newline-separated string) must be provided.  The optional
 * `nodeTypes` filter lets callers request only specific node type names — the
 * walker still traverses the entire tree but only includes matching nodes in
 * the response.  `maxDepth` limits how deep the walker descends (default: 50).
 * `includeContext` controls whether depth/parent-key information is included
 * per node in the response.
 */
export const ASTWalkRequestSchema = z.object({
    /** Array of raw rule strings to walk. Mutually exclusive with `text`. */
    rules: z.array(z.string().max(4_096, 'Individual rule must be ≤ 4 096 characters'))
        .max(AST_WALK_MAX_RULES, `Maximum ${AST_WALK_MAX_RULES} rules per request`)
        .optional(),
    /** Full filter list text (newline-separated). Mutually exclusive with `rules`. */
    text: z.string().max(1_048_576, 'Filter list text must be ≤ 1 MiB').optional(),
    /**
     * Restrict the response to nodes whose `type` matches one of these values.
     * When omitted all node types are included.
     */
    nodeTypes: z.array(AGTreeNodeTypeSchema).max(30).optional(),
    /**
     * Maximum traversal depth (0-indexed, inclusive).
     * Defaults to 50.  Nodes deeper than this value are silently skipped.
     */
    maxDepth: z.number().int().min(0).max(AST_WALK_MAX_DEPTH).optional(),
    /**
     * When `true`, each result node includes `depth`, `key`, and `index` from
     * the {@link WalkContext}.  Defaults to `false`.
     */
    includeContext: z.boolean().optional(),
    /** Optional Cloudflare Turnstile token. */
    turnstileToken: z.string().optional(),
}).refine(
    (d) => d.rules !== undefined || d.text !== undefined,
    { message: 'Either rules or text must be provided' },
).refine(
    (d) => !(d.rules !== undefined && d.text !== undefined),
    { message: 'rules and text are mutually exclusive — provide exactly one' },
);

// ============================================================================
// Convert Rule Request Schema
// ============================================================================

/**
 * Target adblock syntax for rule conversion.
 */
export const ConversionTargetSchema = z.enum(['adg', 'ubo']).describe('Target adblock syntax: adg (AdGuard) or ubo (uBlock Origin)');

/**
 * Schema for convert-rule request.
 */
export const ConvertRuleRequestSchema = z.object({
    /** The raw filter rule text to convert */
    rule: z.string().min(1, 'Rule text is required'),
    /** Target syntax to convert the rule to */
    targetSyntax: ConversionTargetSchema,
    /** Optional Cloudflare Turnstile token consumed by turnstileMiddleware() */
    turnstileToken: z.string().optional(),
});

// ============================================================================
// Admin Request Schemas
// ============================================================================

/**
 * Schema for admin SQL query request
 */
export const AdminQueryRequestSchema = z.object({
    sql: z.string().min(1, 'SQL query is required'),
});

// ============================================================================
// Queue Message Schemas
// ============================================================================

/**
 * Base queue message schema
 */
const BaseQueueMessageSchema = z.object({
    requestId: z.string().optional(),
    timestamp: z.number().int().positive(),
    priority: PrioritySchema.optional(),
    /** Optional group identifier; jobs sharing a group can be cancelled or queried together */
    group: z.string().max(128).optional(),
});

/**
 * Schema for a single batch request item
 * Shared between batch-related schemas to prevent drift.
 */
export const BatchRequestItemSchema = z.object({
    id: z.string().min(1),
    configuration: ConfigurationSchema,
    preFetchedContent: z.record(z.string(), z.string()).optional(),
    benchmark: z.boolean().optional(),
});

/**
 * Schema for single compilation queue message
 */
export const CompileQueueMessageSchema = BaseQueueMessageSchema.extend({
    type: z.literal('compile'),
    configuration: ConfigurationSchema,
    preFetchedContent: z.record(z.string(), z.string()).optional(),
    benchmark: z.boolean().optional(),
});

/**
 * Schema for batch compilation queue message
 */
export const BatchCompileQueueMessageSchema = BaseQueueMessageSchema.extend({
    type: z.literal('batch-compile'),
    requests: z.array(BatchRequestItemSchema).nonempty(),
});

/**
 * Schema for cache warming queue message
 */
export const CacheWarmQueueMessageSchema = BaseQueueMessageSchema.extend({
    type: z.literal('cache-warm'),
    configurations: z.array(ConfigurationSchema).nonempty(),
});

/**
 * Union schema for all queue message types
 */
export const QueueMessageSchema = z.discriminatedUnion('type', [
    CompileQueueMessageSchema,
    BatchCompileQueueMessageSchema,
    CacheWarmQueueMessageSchema,
]);

// ============================================================================
// Workflow Parameter Schemas
// ============================================================================

/**
 * Schema for compilation workflow parameters
 */
export const CompilationParamsSchema = z.object({
    requestId: z.string().min(1),
    configuration: ConfigurationSchema,
    preFetchedContent: z.record(z.string(), z.string()).optional(),
    benchmark: z.boolean().optional(),
    priority: PrioritySchema.optional(),
    queuedAt: z.number().int().positive(),
});

/**
 * Schema for batch compilation workflow parameters
 */
export const BatchCompilationParamsSchema = z.object({
    batchId: z.string().min(1),
    requests: z.array(BatchRequestItemSchema).nonempty(),
    priority: PrioritySchema.optional(),
    queuedAt: z.number().int().positive(),
});

/**
 * Schema for cache warming workflow parameters
 */
export const CacheWarmingParamsSchema = z.object({
    runId: z.string().min(1),
    configurations: z.array(ConfigurationSchema).nonempty(),
    scheduled: z.boolean(),
});

/**
 * Schema for health monitoring workflow parameters
 */
export const HealthMonitoringParamsSchema = z.object({
    runId: z.string().min(1),
    sources: z.array(
        z.object({
            name: z.string().min(1),
            url: z.string().url(),
            expectedMinRules: z.number().int().positive().optional(),
        }),
    ).nonempty(),
    alertOnFailure: z.boolean(),
});

// ============================================================================
// Turnstile Validation Schemas
// ============================================================================

/**
 * Schema for Turnstile verification response
 */
export const TurnstileVerifyResponseSchema = z.object({
    success: z.boolean(),
    challenge_ts: z.string().optional(),
    hostname: z.string().optional(),
    'error-codes': z.array(z.string()).optional(),
    action: z.string().optional(),
    cdata: z.string().optional(),
});

/**
 * Schema for Turnstile verification result
 */
export const TurnstileResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
});

// ============================================================================
// Metrics and Statistics Schemas
// ============================================================================

/**
 * Schema for rate limit data
 */
export const RateLimitDataSchema = z.object({
    count: z.number().int().nonnegative(),
    resetAt: z.number().int().positive(),
});

/**
 * Schema for endpoint metrics
 */
export const EndpointMetricsSchema = z.object({
    count: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    totalDuration: z.number().nonnegative(),
    errors: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * Schema for endpoint metrics display (with calculated avg)
 */
export const EndpointMetricsDisplaySchema = z.object({
    count: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    avgDuration: z.number().nonnegative(),
    errors: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * Schema for aggregated metrics
 */
export const AggregatedMetricsSchema = z.object({
    window: z.string(),
    timestamp: z.string().datetime().describe('ISO 8601 timestamp of the metrics window'),
    endpoints: z.record(z.string(), EndpointMetricsDisplaySchema),
});

/**
 * Schema for job history entry
 */
export const JobHistoryEntrySchema = z.object({
    requestId: z.string(),
    configName: z.string(),
    status: z.enum(['completed', 'failed', 'cancelled']),
    duration: z.number().nonnegative(),
    timestamp: z.string().datetime().describe('ISO 8601 timestamp when the job completed'),
    error: z.string().optional(),
    ruleCount: z.number().int().nonnegative().optional(),
    cacheKey: z.string().optional(),
});

/**
 * Schema for queue depth history entry
 */
export const DepthHistoryEntrySchema = z.object({
    timestamp: z.string().datetime().describe('ISO 8601 timestamp of the queue depth measurement'),
    pending: z.number().int().nonnegative(),
});

/**
 * Schema for queue statistics
 */
export const QueueStatsSchema = z.object({
    pending: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    totalProcessingTime: z.number().nonnegative(),
    averageProcessingTime: z.number().nonnegative(),
    processingRate: z.number().nonnegative(),
    queueLag: z.number().nonnegative(),
    lastUpdate: z.string(),
    history: z.array(JobHistoryEntrySchema),
    depthHistory: z.array(DepthHistoryEntrySchema),
});

/**
 * Schema for job info (for stat updates)
 */
export const JobInfoSchema = z.object({
    requestId: z.string().optional(),
    configName: z.string().optional(),
    error: z.string().optional(),
    ruleCount: z.number().int().nonnegative().optional(),
    cacheKey: z.string().optional(),
});

// ============================================================================
// Auth Provider / Auth Result Schemas
// ============================================================================

/**
 * Discriminated auth provider identifier.
 *
 * Used for observability logging and the auth priority chain:
 *   1. `api-key`      — `abc_`-prefixed Bearer token (always first)
 *   2. `better-auth`  — Primary session provider (cookie or bearer plugin)
 *   3. `anonymous`    — No credentials presented
 */
export const AuthProviderSchema = z.enum(['better-auth', 'api-key', 'anonymous']);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

/**
 * Structured result returned by the auth priority chain.
 *
 * Captures which provider authenticated the request, the resolved userId,
 * the user's subscription tier, and the granted scope.
 */
export const AuthResultSchema = z.object({
    provider: AuthProviderSchema,
    userId: z.string().optional(),
    tier: z.enum(['free', 'pro', 'admin']).default('free'),
    scope: z.nativeEnum(AuthScope),
});
export type AuthResult = z.infer<typeof AuthResultSchema>;

// ============================================================================
// Admin Response Schemas
// ============================================================================

/**
 * Schema for admin authentication result
 */
export const AdminAuthResultSchema = z.object({
    authorized: z.boolean(),
    error: z.string().optional(),
});

/**
 * Schema for storage statistics
 */
export const StorageStatsSchema = z.object({
    storage_entries: z.number().int().nonnegative(),
    filter_cache: z.number().int().nonnegative(),
    compilation_metadata: z.number().int().nonnegative(),
    expired_storage: z.number().int().nonnegative(),
    expired_cache: z.number().int().nonnegative(),
});

/**
 * Schema for table info
 */
export const TableInfoSchema = z.object({
    name: z.string(),
    type: z.string(),
});

// ============================================================================
// Compilation Result Schemas
// ============================================================================

/**
 * Schema for compilation metrics
 */
export const CompilationMetricsSchema = z.object({
    totalDuration: z.number().nonnegative().optional(),
    sourceCount: z.number().int().nonnegative().optional(),
    transformationCount: z.number().int().nonnegative().optional(),
    inputRuleCount: z.number().int().nonnegative().optional(),
    outputRuleCount: z.number().int().nonnegative().optional(),
    phases: z.record(z.string(), z.number().nonnegative()).optional(),
});

/**
 * Schema for previous version info
 */
export const PreviousVersionSchema = z.object({
    rules: z.array(z.string()),
    ruleCount: z.number().int().nonnegative(),
    compiledAt: z.string().datetime().describe('ISO 8601 timestamp when this version was compiled'),
});

/**
 * Schema for compilation result
 */
export const CompilationResultSchema = z.object({
    success: z.boolean(),
    rules: z.array(z.string()).optional(),
    ruleCount: z.number().int().nonnegative().optional(),
    metrics: CompilationMetricsSchema.optional(),
    error: z.string().optional(),
    compiledAt: z.string().optional(),
    previousVersion: PreviousVersionSchema.optional(),
    cached: z.boolean().optional(),
    deduplicated: z.boolean().optional(),
});

// ============================================================================
// Workflow Result Schemas
// ============================================================================

/**
 * Schema for source fetch result
 */
export const SourceFetchResultSchema = z.object({
    name: z.string(),
    url: z.string().url(),
    success: z.boolean(),
    ruleCount: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
    durationMs: z.number().nonnegative(),
    cached: z.boolean(),
    etag: z.string().optional(),
});

/**
 * Schema for transformation result
 */
export const TransformationResultSchema = z.object({
    transformationName: z.string(),
    inputRuleCount: z.number().int().nonnegative(),
    outputRuleCount: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
});

// ============================================================================
// Workflow Step Sub-Schemas
// ============================================================================

/**
 * Schema for the validation step in a workflow compilation result
 */
export const WorkflowValidationStepSchema = z.object({
    durationMs: z.number().nonnegative(),
    success: z.boolean(),
});

/**
 * Schema for the source fetch step in a workflow compilation result
 */
export const WorkflowSourceFetchStepSchema = z.object({
    durationMs: z.number().nonnegative(),
    sources: z.array(SourceFetchResultSchema),
});

/**
 * Schema for the transformation step in a workflow compilation result
 */
export const WorkflowTransformationStepSchema = z.object({
    durationMs: z.number().nonnegative(),
    transformations: z.array(TransformationResultSchema),
});

/**
 * Schema for the header generation step in a workflow compilation result
 */
export const WorkflowHeaderGenerationStepSchema = z.object({
    durationMs: z.number().nonnegative(),
});

/**
 * Schema for the caching step in a workflow compilation result
 */
export const WorkflowCachingStepSchema = z.object({
    durationMs: z.number().nonnegative(),
    compressed: z.boolean(),
    sizeBytes: z.number().int().nonnegative(),
});

/**
 * Schema for all workflow compilation steps (each step is optional)
 */
export const WorkflowStepsSchema = z.object({
    validation: WorkflowValidationStepSchema.optional(),
    sourceFetch: WorkflowSourceFetchStepSchema.optional(),
    transformation: WorkflowTransformationStepSchema.optional(),
    headerGeneration: WorkflowHeaderGenerationStepSchema.optional(),
    caching: WorkflowCachingStepSchema.optional(),
});

/**
 * Schema for workflow compilation result
 */
export const WorkflowCompilationResultSchema = z.object({
    success: z.boolean().describe('Whether the compilation succeeded'),
    requestId: z.string().describe('Unique request identifier'),
    configName: z.string().describe('Name of the compiled filter list configuration'),
    rules: z.array(z.string()).optional().describe('Compiled filter rules'),
    ruleCount: z.number().int().nonnegative().optional().describe('Number of compiled filter rules'),
    cacheKey: z.string().optional().describe('Cache key under which the result is stored'),
    compiledAt: z.string().datetime().describe('ISO 8601 timestamp when compilation completed'),
    totalDurationMs: z.number().nonnegative().describe('Total compilation duration in milliseconds'),
    steps: WorkflowStepsSchema.describe('Per-step timing and result breakdown'),
    error: z.string().optional().describe('Error message if compilation failed'),
});

/**
 * Schema for batch workflow result
 */
export const BatchWorkflowResultSchema = z.object({
    batchId: z.string(),
    totalRequests: z.number().int().positive(),
    successful: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    results: z.array(WorkflowCompilationResultSchema),
    totalDurationMs: z.number().nonnegative(),
});

/**
 * Schema for source health result
 */
export const SourceHealthResultSchema = z.object({
    name: z.string(),
    url: z.string().url(),
    healthy: z.boolean(),
    statusCode: z.number().int().optional(),
    responseTimeMs: z.number().nonnegative().optional(),
    ruleCount: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
    lastChecked: z.string().datetime().describe('ISO 8601 timestamp of the last health check'),
});

/**
 * Schema for health monitoring result
 */
export const HealthMonitoringResultSchema = z.object({
    runId: z.string(),
    sourcesChecked: z.number().int().nonnegative(),
    healthySources: z.number().int().nonnegative(),
    unhealthySources: z.number().int().nonnegative(),
    results: z.array(SourceHealthResultSchema),
    alertsSent: z.boolean(),
    totalDurationMs: z.number().nonnegative(),
});

/**
 * Schema for cache warming result
 */
export const CacheWarmingResultSchema = z.object({
    runId: z.string(),
    scheduled: z.boolean(),
    warmedConfigurations: z.number().int().nonnegative(),
    failedConfigurations: z.number().int().nonnegative(),
    details: z.array(
        z.object({
            configName: z.string(),
            success: z.boolean(),
            cacheKey: z.string().optional(),
            error: z.string().optional(),
        }),
    ),
    totalDurationMs: z.number().nonnegative(),
});

// ============================================================================
// Workflow Event Schemas
// ============================================================================

/**
 * Schema for workflow event type
 */
export const WorkflowEventTypeSchema = z.enum([
    'workflow:started',
    'workflow:step:started',
    'workflow:step:completed',
    'workflow:step:failed',
    'workflow:progress',
    'workflow:completed',
    'workflow:failed',
    'source:fetch:started',
    'source:fetch:completed',
    'source:fetch:failed',
    'transformation:started',
    'transformation:completed',
    'cache:stored',
    'health:check:started',
    'health:check:completed',
]);

/**
 * Schema for workflow progress event
 */
export const WorkflowProgressEventSchema = z.object({
    type: WorkflowEventTypeSchema,
    workflowId: z.string(),
    workflowType: z.string(),
    timestamp: z.string(),
    step: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    message: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for workflow instance info
 */
export const WorkflowInstanceInfoSchema = z.object({
    id: z.string(),
    workflowName: z.string(),
    status: WorkflowStatusSchema,
    createdAt: z.string().datetime().describe('ISO 8601 timestamp when the workflow instance was created'),
    params: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
});

// ============================================================================
// Rule Validation Schemas (POST /validate-rule)
// ============================================================================

/**
 * Schema for validating a single adblock rule.
 * Optionally tests the rule against a provided URL.
 */
export const ValidateRuleRequestSchema = z.object({
    rule: z.string().min(1, 'Rule must not be empty').describe('Single adblock filter rule to validate'),
    testUrl: z.string().url('testUrl must be a valid URL').optional().describe('Optional URL to test the rule against'),
    strict: z.boolean().optional().default(false).describe('Enable strict validation mode'),
});

export type ValidateRuleRequest = z.infer<typeof ValidateRuleRequestSchema>;

/**
 * Schema for a single validate-rule response
 */
export const ValidateRuleResponseSchema = z.object({
    success: z.boolean(),
    valid: z.boolean(),
    rule: z.string(),
    ruleType: z.string().optional().describe('High-level classification of the rule (e.g. "NetworkRule", "CosmeticRule")'),
    category: z.string().optional().describe('Category or subtype of the rule (e.g. "Network", "Cosmetic")'),
    syntax: z.string().optional().describe('Detected adblock syntax variant for the rule'),
    ast: z.record(z.string(), z.unknown()).optional().describe('Parsed AST representation when validation succeeds'),
    error: z.string().optional().describe('Parse error message when valid is false'),
    testUrl: z.string().optional().describe('The URL that was tested against the rule'),
    matchResult: z.boolean().optional().describe('Whether the rule matched the testUrl'),
    duration: z.string().describe('Processing duration e.g. "2ms"'),
});

// ─── Diff Schemas (POST /diff) ───────────────────────────────────────────────

/** Configurable options for the diff algorithm */
export const DiffOptionsSchema = z.object({
    ignoreComments: z.boolean().optional().default(true),
    ignoreEmptyLines: z.boolean().optional().default(true),
    analyzeDomains: z.boolean().optional().default(true),
    includeFullRules: z.boolean().optional().default(true),
    maxRulesToInclude: z.number().int().min(1).max(10_000).optional().default(1000),
});

/** Request body for POST /diff */
export const DiffRequestSchema = z.object({
    original: z.array(z.string()).min(1, 'original list cannot be empty'),
    current: z.array(z.string()).min(1, 'current list cannot be empty'),
    options: DiffOptionsSchema.optional().default(() => DiffOptionsSchema.parse({})),
});
export type DiffRequest = z.infer<typeof DiffRequestSchema>;

/** A parse error encountered while reading a filter-list rule */
export const ParseErrorSchema = z.object({
    line: z.number(),
    rule: z.string(),
    message: z.string(),
});

/** A single added or removed rule in a diff result */
export const RuleDiffSchema = z.object({
    rule: z.string(),
    type: z.enum(['added', 'removed', 'modified']),
    source: z.string().optional(),
    originalLine: z.number().optional(),
    newLine: z.number().optional(),
    /** Rule category detected by AGTree (network, cosmetic, host, comment, unknown) */
    category: z.enum(['network', 'cosmetic', 'host', 'comment', 'unknown']).optional(),
    /** Adblock syntax dialect detected by AGTree (e.g. AdGuard, uBlockOrigin, AdblockPlus, Common) */
    syntax: z.string().optional(),
    /** Whether this is an exception (allowlist) rule */
    isException: z.boolean().optional(),
});

/** Per-domain rule change counts in a diff result */
export const DomainDiffSchema = z.object({
    domain: z.string(),
    added: z.number(),
    removed: z.number(),
});

/** Per-category added/removed counts (populated when AGTree parses successfully) */
const CategoryChangeCountsSchema = z.object({
    network: z.object({ added: z.number(), removed: z.number() }),
    cosmetic: z.object({ added: z.number(), removed: z.number() }),
    host: z.object({ added: z.number(), removed: z.number() }),
    comment: z.object({ added: z.number(), removed: z.number() }),
    unknown: z.object({ added: z.number(), removed: z.number() }),
});

/** High-level statistics for a diff result */
export const DiffSummarySchema = z.object({
    originalCount: z.number(),
    newCount: z.number(),
    addedCount: z.number(),
    removedCount: z.number(),
    unchangedCount: z.number(),
    netChange: z.number(),
    percentageChange: z.number(),
    /** Per-category breakdown of added/removed counts */
    categoryBreakdown: CategoryChangeCountsSchema.optional(),
});

/** Metadata for one list version (original or current) */
const ListMetadataSchema = z.object({
    name: z.string().optional(),
    version: z.string().optional(),
    timestamp: z.string().optional(),
    ruleCount: z.number(),
});

/** Full diff report returned by POST /diff */
export const DiffReportSchema = z.object({
    timestamp: z.string(),
    generatorVersion: z.string(),
    original: ListMetadataSchema,
    current: ListMetadataSchema,
    summary: DiffSummarySchema,
    added: z.array(RuleDiffSchema),
    removed: z.array(RuleDiffSchema),
    domainChanges: z.array(DomainDiffSchema),
});

/** Response body for POST /diff */
export const DiffResponseSchema = z.object({
    success: z.boolean(),
    parseErrors: z.object({
        original: z.array(ParseErrorSchema),
        current: z.array(ParseErrorSchema),
    }),
    report: DiffReportSchema,
    duration: z.string(),
});
export type DiffResponse = z.infer<typeof DiffResponseSchema>;

// ============================================================================
// Rule Management Schemas (POST/GET/PUT/DELETE /rules)
// ============================================================================

/**
 * Schema for creating a new saved rule set
 */
export const RuleSetCreateSchema = z.object({
    name: z.string().min(1).max(128).describe('Human-readable name for this rule set'),
    description: z.string().max(512).optional().describe('Optional description'),
    rules: z.array(z.string()).min(1, 'At least one rule is required').max(10_000, 'Maximum 10,000 rules per set'),
    tags: z.array(z.string().max(64)).max(20).optional().describe('Optional tags for categorisation'),
});

export type RuleSetCreate = z.infer<typeof RuleSetCreateSchema>;

/**
 * Schema for updating an existing rule set (all fields optional)
 */
export const RuleSetUpdateSchema = z.object({
    name: z.string().min(1).max(128).optional(),
    description: z.string().max(512).optional(),
    rules: z.array(z.string()).min(1).max(10_000).optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
});

export type RuleSetUpdate = z.infer<typeof RuleSetUpdateSchema>;

/**
 * Schema for a stored rule set (full representation)
 */
export const RuleSetSchema = z.object({
    id: z.string().uuid().describe('Unique identifier for the rule set'),
    name: z.string(),
    description: z.string().optional(),
    rules: z.array(z.string()),
    ruleCount: z.number().int().nonnegative(),
    tags: z.array(z.string()).optional(),
    createdAt: z.string().datetime().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().datetime().describe('ISO 8601 last-updated timestamp'),
});

export type RuleSet = z.infer<typeof RuleSetSchema>;

// ============================================================================
// Webhook / Notification Schemas (POST /notify)
// ============================================================================

/**
 * Supported notification event levels
 */
export const NotifyLevelSchema = z.enum(['info', 'warn', 'error', 'debug']).describe('Severity level of the notification');

/**
 * Schema for an outbound webhook notification request
 */
export const WebhookNotifyRequestSchema = z.object({
    event: z.string().min(1).max(128).describe('Event name or type (e.g. "compile.error", "rule.invalid")'),
    level: NotifyLevelSchema.default('info'),
    message: z.string().min(1).max(2048).describe('Human-readable message describing the event'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary additional data to attach to the notification'),
    source: z.string().max(128).optional().describe('Identifies the component that emitted the event'),
    timestamp: z.string().datetime().optional().describe('ISO 8601 event timestamp; defaults to current time if omitted'),
});

export type WebhookNotifyRequest = z.infer<typeof WebhookNotifyRequestSchema>;

/**
 * Schema for the result of a single webhook delivery attempt
 */
export const WebhookDeliverySchema = z.object({
    target: z.string().describe('Webhook target identifier (e.g. "generic", "sentry")'),
    success: z.boolean(),
    statusCode: z.number().int().optional(),
    error: z.string().optional(),
});

/**
 * Schema for POST /notify response
 */
export const WebhookNotifyResponseSchema = z.object({
    success: z.boolean(),
    event: z.string(),
    deliveries: z.array(WebhookDeliverySchema),
    duration: z.string(),
});

// ============================================================================
// Queue Group Enhancement
// ============================================================================

// Re-export BaseQueueMessageSchema extension note:
// The group field is added to queue messages to support grouped job processing.
// Consumers can use this to batch related jobs or apply shared cancellation.

/**
 * Request body for POST /api/keys (create a new API key).
 */
export const CreateApiKeyRequestSchema = z.object({
    name: z.string().trim().min(1, 'name is required').max(100, 'name must be at most 100 characters'),
    scopes: z.array(z.nativeEnum(AuthScope)).optional().default([AuthScope.Compile]),
    expiresInDays: z.number().int().min(1).max(365).optional(),
});

export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

/**
 * Request body for PATCH /api/keys/:id (update an existing API key).
 * At least one of `name` or `scopes` must be present.
 */
export const UpdateApiKeyRequestSchema = z.object({
    name: z.string().trim().min(1, 'name must be a non-empty string').max(100, 'name must be at most 100 characters').optional(),
    scopes: z.array(z.nativeEnum(AuthScope)).optional(),
}).refine(
    (d) => d.name !== undefined || d.scopes !== undefined,
    { message: 'At least one of name or scopes is required' },
);

export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequestSchema>;

/**
 * A single API key row returned from the `api_keys` table.
 * Used to validate DB rows before trusting them in business logic.
 */
export const ApiKeyRowSchema = z.object({
    id: z.string().min(1),
    user_id: z.string().optional(),
    key_prefix: z.string().optional(),
    name: z.string().optional(),
    scopes: z.array(z.nativeEnum(AuthScope)),
    rate_limit_per_minute: z.number().int().nonnegative(),
    expires_at: z.string().nullable().optional(),
    revoked_at: z.string().nullable().optional(),
    last_used_at: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
});

export type ApiKeyRow = z.infer<typeof ApiKeyRowSchema>;

/**
 * A single row from `users` when resolving an API key owner's info (tier and role).
 *
 * `role` is nullish because older rows may pre-date the role column migration;
 * callers should default to `'user'` when it is absent (`null` or `undefined`).
 * When present, it must still satisfy the same role constraints used elsewhere.
 */
export const UserTierRowSchema = z.object({
    tier: z.nativeEnum(UserTier),
    role: z.string().min(1).max(64).nullish(),
});

export type UserTierRow = z.infer<typeof UserTierRowSchema>;

// ============================================================================
// Better Auth User Schemas
//
// Better Auth stores users in a `user` table with these columns:
//   id, email, name, emailVerified, image, createdAt, updatedAt
// Plus custom additionalFields: tier, role, banned, banReason, banExpires
// ============================================================================

/**
 * Raw Postgres/Neon row shape for Better Auth's `user` table (admin queries only).
 *
 * Column alias note: in this repo, Better Auth's logical `name` value is
 * stored in the database column `display_name`. When reading rows directly
 * from Postgres/Neon, select `display_name AS name` so the result matches this schema.
 */
export const BetterAuthUserRowSchema = z.object({
    id: z.string(),
    email: z.string(),
    /** Backing database column is `display_name`; alias it to `name` for this raw row schema. */
    name: z.string().nullable(),
    emailVerified: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)),
    image: z.string().nullable().optional(),
    tier: z.nativeEnum(UserTier).nullish(),
    role: z.string().min(1).max(64).nullish(),
    banned: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional(),
    banReason: z.string().nullable().optional(),
    banExpires: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type BetterAuthUserRow = z.infer<typeof BetterAuthUserRowSchema>;

/** Public user shape for API responses — safe to return to admins. */
export const BetterAuthUserPublicSchema = BetterAuthUserRowSchema;
export type BetterAuthUserPublic = z.infer<typeof BetterAuthUserPublicSchema>;

/** Request body for PATCH /admin/users/:id — update tier and/or role. */
export const AdminUpdateUserSchema = z.object({
    tier: z.nativeEnum(UserTier).optional().describe('Updated user tier'),
    role: z.string().min(1).max(64).optional().describe('Updated user role'),
}).refine(
    (d) => d.tier !== undefined || d.role !== undefined,
    { message: 'At least one of tier or role is required' },
);

export type AdminUpdateUser = z.infer<typeof AdminUpdateUserSchema>;

/** Request body for POST /admin/users/:id/ban. */
export const AdminBanUserSchema = z.object({
    reason: z.string().max(500).optional(),
    expires: z.string().datetime().optional(),
});

export type AdminBanUser = z.infer<typeof AdminBanUserSchema>;

/** Request body for POST /admin/users/:id/unban. No body required — clears ban fields. */
export const AdminUnbanUserSchema = z.object({}).passthrough();

export type AdminUnbanUser = z.infer<typeof AdminUnbanUserSchema>;

// ============================================================================
// Agent Session / Invocation / Audit Log Row Schemas
//
// Validated DB row shapes for the three new agent tables:
//   agent_sessions, agent_invocations, agent_audit_logs
// Follow the same pattern as ApiKeyRowSchema / BetterAuthUserRowSchema.
// ============================================================================

/** Raw Neon/PostgreSQL row shape for the `agent_sessions` table. */
export const AgentSessionRowSchema = z.object({
    id: z.string().uuid(),
    agent_slug: z.string(),
    instance_id: z.string(),
    user_id: z.string().uuid().nullable().optional(),
    started_at: z.string(),
    ended_at: z.string().nullable().optional(),
    end_reason: z.string().nullable().optional(),
    message_count: z.number().int().default(0),
    transport: z.string().default('websocket'),
    client_ip: z.string().nullable().optional(),
    user_agent: z.string().nullable().optional(),
    metadata: z.unknown().nullable().optional(),
});

export type AgentSessionRow = z.infer<typeof AgentSessionRowSchema>;

/** Raw Neon/PostgreSQL row shape for the `agent_invocations` table. */
export const AgentInvocationRowSchema = z.object({
    id: z.string().uuid(),
    session_id: z.string().uuid(),
    tool_name: z.string(),
    input_summary: z.string().nullable().optional(),
    output_summary: z.string().nullable().optional(),
    duration_ms: z.number().int().nullable().optional(),
    success: z.boolean().default(true),
    error_message: z.string().nullable().optional(),
    invoked_at: z.string(),
    metadata: z.unknown().nullable().optional(),
});

export type AgentInvocationRow = z.infer<typeof AgentInvocationRowSchema>;

/** Raw Neon/PostgreSQL row shape for the `agent_audit_logs` table. */
export const AgentAuditLogRowSchema = z.object({
    id: z.string().uuid(),
    actor_user_id: z.string().uuid().nullable().optional(),
    agent_slug: z.string().nullable().optional(),
    instance_id: z.string().nullable().optional(),
    action: z.string(),
    status: z.string().default('success'),
    ip_address: z.string().nullable().optional(),
    user_agent: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    metadata: z.unknown().nullable().optional(),
    created_at: z.string(),
});

export type AgentAuditLogRow = z.infer<typeof AgentAuditLogRowSchema>;

// ============================================================================
// Two-Factor Authentication Schemas
// ============================================================================

/** Schema for 2FA TOTP code verification (6-digit code) */
export const TwoFactorVerifySchema = z.object({
    code: z.string().trim().length(6).regex(/^\d{6}$/, 'TOTP code must be exactly 6 digits'),
});

export type TwoFactorVerify = z.infer<typeof TwoFactorVerifySchema>;

/** Schema for 2FA backup code verification */
export const TwoFactorBackupSchema = z.object({
    code: z.string().trim().min(1, 'Backup code is required'),
});

export type TwoFactorBackup = z.infer<typeof TwoFactorBackupSchema>;

// ============================================================================
// Admin System Schemas — ADMIN_DB trust boundary validation (#1054)
// ============================================================================

// ---------------------------------------------------------------------------
// Admin Enums
// ---------------------------------------------------------------------------

/** Built-in admin role names */
export const AdminRoleNameSchema = z.enum(['viewer', 'editor', 'super-admin']).describe('Built-in admin role');
export type AdminRoleName = z.infer<typeof AdminRoleNameSchema>;

/** Granular admin permissions — used in role permission arrays */
export const AdminPermissionSchema = z.enum([
    'admin:read',
    'admin:write',
    'audit:read',
    'metrics:read',
    'config:read',
    'config:write',
    'users:read',
    'users:write',
    'users:manage',
    'flags:read',
    'flags:write',
    'tiers:read',
    'tiers:write',
    'scopes:read',
    'scopes:write',
    'endpoints:read',
    'endpoints:write',
    'announcements:read',
    'announcements:write',
    'roles:read',
    'roles:write',
    'roles:assign',
    'keys:read',
    'keys:write',
    'keys:revoke',
    'storage:read',
    'storage:write',
]).describe('Granular admin permission string');
export type AdminPermission = z.infer<typeof AdminPermissionSchema>;

/** Audit log status */
export const AuditStatusSchema = z.enum(['success', 'failure', 'denied']).describe('Audit log entry status');

/** Announcement severity */
export const AnnouncementSeveritySchema = z.enum(['info', 'warning', 'error', 'success']).describe('Announcement severity level');

// ---------------------------------------------------------------------------
// D1 Row Schemas — validate data coming OUT of Admin D1
// ---------------------------------------------------------------------------

/** Row from `admin_roles` table */
export const AdminRoleRowSchema = z.object({
    id: z.number(),
    role_name: AdminRoleNameSchema,
    display_name: z.string(),
    description: z.string(),
    permissions: z.string().transform((s) => JSON.parse(s) as string[]),
    is_active: z.number().transform((n) => n === 1),
    created_at: z.string(),
    updated_at: z.string(),
});
export type AdminRoleRow = z.infer<typeof AdminRoleRowSchema>;

/** Row from `admin_role_assignments` table */
export const AdminRoleAssignmentRowSchema = z.object({
    id: z.number(),
    user_id: z.string(),
    role_name: AdminRoleNameSchema,
    assigned_by: z.string(),
    assigned_at: z.string(),
    expires_at: z.string().nullable(),
});
export type AdminRoleAssignmentRow = z.infer<typeof AdminRoleAssignmentRowSchema>;

/** Row from `admin_audit_logs` table */
export const AdminAuditLogRowSchema = z.object({
    id: z.number(),
    actor_id: z.string(),
    actor_email: z.string().nullable(),
    action: z.string(),
    resource_type: z.string(),
    resource_id: z.string().nullable(),
    old_values: z.string().nullable().transform((s) => s ? JSON.parse(s) : null),
    new_values: z.string().nullable().transform((s) => s ? JSON.parse(s) : null),
    ip_address: z.string().nullable(),
    user_agent: z.string().nullable(),
    status: AuditStatusSchema,
    metadata: z.string().nullable().transform((s) => s ? JSON.parse(s) : null),
    created_at: z.string(),
});
export type AdminAuditLogRow = z.infer<typeof AdminAuditLogRowSchema>;

/** Row from `tier_configs` table */
export const TierConfigRowSchema = z.object({
    id: z.number(),
    tier_name: z.string(),
    order_rank: z.number(),
    rate_limit: z.number(),
    display_name: z.string(),
    description: z.string(),
    features: z.string().transform((s) => JSON.parse(s) as Record<string, unknown>),
    is_active: z.number().transform((n) => n === 1),
    created_at: z.string(),
    updated_at: z.string(),
});
export type TierConfigRow = z.infer<typeof TierConfigRowSchema>;

/** Row from `scope_configs` table */
export const ScopeConfigRowSchema = z.object({
    id: z.number(),
    scope_name: z.string(),
    display_name: z.string(),
    description: z.string(),
    required_tier: z.string(),
    is_active: z.number().transform((n) => n === 1),
    created_at: z.string(),
    updated_at: z.string(),
});
export type ScopeConfigRow = z.infer<typeof ScopeConfigRowSchema>;

/** Row from `endpoint_auth_overrides` table */
export const EndpointAuthOverrideRowSchema = z.object({
    id: z.number(),
    path_pattern: z.string(),
    method: z.string(),
    required_tier: z.string().nullable(),
    required_scopes: z.string().nullable().transform((s) => s ? JSON.parse(s) as string[] : null),
    is_public: z.number().transform((n) => n === 1),
    is_active: z.number().transform((n) => n === 1),
    created_at: z.string(),
    updated_at: z.string(),
});
export type EndpointAuthOverrideRow = z.infer<typeof EndpointAuthOverrideRowSchema>;

/** Row from `feature_flags` table */
export const FeatureFlagRowSchema = z.object({
    id: z.number(),
    flag_name: z.string(),
    enabled: z.number().transform((n) => n === 1),
    rollout_percentage: z.number().min(0).max(100),
    target_tiers: z.string().transform((s) => JSON.parse(s) as string[]),
    target_users: z.string().transform((s) => JSON.parse(s) as string[]),
    description: z.string(),
    created_by: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type FeatureFlagRow = z.infer<typeof FeatureFlagRowSchema>;

/** Row from `admin_announcements` table */
export const AdminAnnouncementRowSchema = z.object({
    id: z.number(),
    title: z.string(),
    body: z.string(),
    severity: AnnouncementSeveritySchema,
    active_from: z.string().nullable(),
    active_until: z.string().nullable(),
    is_active: z.number().transform((n) => n === 1),
    created_by: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type AdminAnnouncementRow = z.infer<typeof AdminAnnouncementRowSchema>;

// ---------------------------------------------------------------------------
// Admin API Request Schemas — validate data coming IN from API requests
// ---------------------------------------------------------------------------

/** Create / update an admin role */
export const CreateAdminRoleRequestSchema = z.object({
    role_name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Role name must be lowercase alphanumeric with hyphens'),
    display_name: z.string().min(1).max(100),
    description: z.string().max(500).default(''),
    permissions: z.array(AdminPermissionSchema).min(1, 'At least one permission is required'),
});
export type CreateAdminRoleRequest = z.infer<typeof CreateAdminRoleRequestSchema>;

export const UpdateAdminRoleRequestSchema = z.object({
    display_name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    permissions: z.array(AdminPermissionSchema).min(1).optional(),
    is_active: z.boolean().optional(),
});
export type UpdateAdminRoleRequest = z.infer<typeof UpdateAdminRoleRequestSchema>;

/** Assign / revoke a role to a user */
export const AssignRoleRequestSchema = z.object({
    user_id: z.string().min(1),
    role_name: AdminRoleNameSchema,
    expires_at: z.string().datetime().nullable().optional(),
});
export type AssignRoleRequest = z.infer<typeof AssignRoleRequestSchema>;

/** Update tier config */
export const UpdateTierConfigRequestSchema = z.object({
    rate_limit: z.number().int().min(0).optional(),
    display_name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    features: z.record(z.string(), z.unknown()).optional(),
    is_active: z.boolean().optional(),
});
export type UpdateTierConfigRequest = z.infer<typeof UpdateTierConfigRequestSchema>;

/** Update scope config */
export const UpdateScopeConfigRequestSchema = z.object({
    display_name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    required_tier: z.string().min(1).optional(),
    is_active: z.boolean().optional(),
});
export type UpdateScopeConfigRequest = z.infer<typeof UpdateScopeConfigRequestSchema>;

/** Create / update endpoint auth override */
export const CreateEndpointOverrideRequestSchema = z.object({
    path_pattern: z.string().min(1).max(200),
    method: z.string().toUpperCase().default('*'),
    required_tier: z.string().nullable().optional(),
    required_scopes: z.array(z.string()).nullable().optional(),
    is_public: z.boolean().default(false),
});
export type CreateEndpointOverrideRequest = z.infer<typeof CreateEndpointOverrideRequestSchema>;

export const UpdateEndpointOverrideRequestSchema = z.object({
    required_tier: z.string().nullable().optional(),
    required_scopes: z.array(z.string()).nullable().optional(),
    is_public: z.boolean().optional(),
    is_active: z.boolean().optional(),
});
export type UpdateEndpointOverrideRequest = z.infer<typeof UpdateEndpointOverrideRequestSchema>;

/** Create / update feature flag */
export const CreateFeatureFlagRequestSchema = z.object({
    flag_name: z.string().min(1).max(100).regex(/^[a-z0-9_.-]+$/, 'Flag name must be lowercase with dots, hyphens, or underscores'),
    enabled: z.boolean().default(false),
    rollout_percentage: z.number().int().min(0).max(100).default(100),
    target_tiers: z.array(z.string()).default([]),
    target_users: z.array(z.string()).default([]),
    description: z.string().max(500).default(''),
});
export type CreateFeatureFlagRequest = z.infer<typeof CreateFeatureFlagRequestSchema>;

export const UpdateFeatureFlagRequestSchema = z.object({
    enabled: z.boolean().optional(),
    rollout_percentage: z.number().int().min(0).max(100).optional(),
    target_tiers: z.array(z.string()).optional(),
    target_users: z.array(z.string()).optional(),
    description: z.string().max(500).optional(),
});
export type UpdateFeatureFlagRequest = z.infer<typeof UpdateFeatureFlagRequestSchema>;

/** Create / update announcement */
export const CreateAnnouncementRequestSchema = z.object({
    title: z.string().min(1).max(200),
    body: z.string().max(2000).default(''),
    severity: AnnouncementSeveritySchema.default('info'),
    active_from: z.string().datetime().nullable().optional(),
    active_until: z.string().datetime().nullable().optional(),
});
export type CreateAnnouncementRequest = z.infer<typeof CreateAnnouncementRequestSchema>;

export const UpdateAnnouncementRequestSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(2000).optional(),
    severity: AnnouncementSeveritySchema.optional(),
    active_from: z.string().datetime().nullable().optional(),
    active_until: z.string().datetime().nullable().optional(),
    is_active: z.boolean().optional(),
});
export type UpdateAnnouncementRequest = z.infer<typeof UpdateAnnouncementRequestSchema>;

/** Audit log query filters */
export const AuditLogQuerySchema = z.object({
    actor_id: z.string().optional(),
    action: z.string().optional(),
    resource_type: z.string().optional(),
    resource_id: z.string().optional(),
    status: AuditStatusSchema.optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).default(50),
    offset: z.number().int().min(0).default(0),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

// ---------------------------------------------------------------------------
// Admin API Response Schemas — typed responses for admin endpoints
// ---------------------------------------------------------------------------

/** Standard paginated list response wrapper */
export const AdminListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
    z.object({
        success: z.literal(true),
        items: z.array(itemSchema),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
    });

/** Resolved admin user context (from KV cache or D1 lookup) */
export const ResolvedAdminContextSchema = z.object({
    user_id: z.string(),
    role_name: AdminRoleNameSchema,
    permissions: z.array(AdminPermissionSchema),
    expires_at: z.string().nullable(),
});
export type ResolvedAdminContext = z.infer<typeof ResolvedAdminContextSchema>;

// ============================================================================
// Request / Query Validation Schemas — trust-boundary gaps closed (#1125)
// ============================================================================

/** POST /ast/parse */
export const AstParseRequestSchema = z.object({
    rules: z.array(z.string()).optional(),
    text: z.string().optional(),
}).refine(
    (d) => d.rules !== undefined || d.text !== undefined,
    { message: 'Request must include either "rules" array or "text" string' },
);
export type AstParseRequest = z.infer<typeof AstParseRequestSchema>;

/** POST /validate — batch rule validation */
export const ValidateRequestSchema = z.object({
    /** Array of adblock filter rules to validate. */
    rules: z.array(z.string()).optional().default([]),
    /** When true, treat warnings as errors. */
    strict: z.boolean().optional().default(false),
});
export type ValidateRequest = z.infer<typeof ValidateRequestSchema>;

/** POST /admin/auth/api-keys/revoke — one of apiKeyId or keyPrefix required */
export const RevokeApiKeyRequestSchema = z.object({
    apiKeyId: z.string().optional(),
    keyPrefix: z.string().optional(),
}).refine(
    (d) => d.apiKeyId !== undefined || d.keyPrefix !== undefined,
    { message: 'Provide either apiKeyId or keyPrefix' },
);
export type RevokeApiKeyRequest = z.infer<typeof RevokeApiKeyRequestSchema>;

/** POST /admin/auth/api-keys/validate */
export const ValidateApiKeyRequestSchema = z.object({
    apiKey: z.string().min(1, 'apiKey is required'),
});
export type ValidateApiKeyRequest = z.infer<typeof ValidateApiKeyRequestSchema>;

/** GET /admin/auth/api-keys?userId=<uuid> */
export const ListApiKeysQuerySchema = z.object({
    userId: z.string().uuid('userId must be a valid UUID'),
});
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;

/** Shared pagination query params for admin list endpoints */
export const AdminPaginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
export type AdminPaginationQuery = z.infer<typeof AdminPaginationQuerySchema>;

/** GET /admin/usage/:userId?days=<n> */
export const AdminUsageDaysQuerySchema = z.object({
    days: z.coerce.number().int().default(30),
});
export type AdminUsageDays = z.infer<typeof AdminUsageDaysQuerySchema>;

// ============================================================================
// Admin Neon — request schemas for /admin/neon/* endpoints
// ============================================================================

/** POST /admin/neon/branches — create a new branch */
export const AdminNeonCreateBranchSchema = z.object({
    /** Optional branch name. Neon auto-generates one when omitted. */
    name: z.string().max(128).optional(),
    /** Parent branch ID to fork from. Defaults to the project's primary branch. */
    parent_id: z.string().max(128).optional(),
});
export type AdminNeonCreateBranch = z.infer<typeof AdminNeonCreateBranchSchema>;

/** POST /admin/neon/query — execute a SQL query via the Neon serverless driver */
export const AdminNeonQuerySchema = z.object({
    /** Full postgres:// connection string. */
    connectionString: z.string().min(1, 'connectionString is required'),
    /** SQL statement to execute. */
    sql: z.string().min(1, 'SQL query is required'),
    /** Optional positional parameters ($1, $2, …). */
    params: z.array(z.unknown()).optional(),
});
export type AdminNeonQuery = z.infer<typeof AdminNeonQuerySchema>;

// ============================================================================
// Better Auth — Session / User response schemas
// ============================================================================

/**
 * Better Auth user object returned inside session responses.
 *
 * Matches the shape emitted by `auth.api.getSession()` — core fields
 * plus the project-specific `tier` and `role` additional fields.
 */
export const BetterAuthUserSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string().optional(),
    image: z.string().url().nullable().optional(),
    emailVerified: z.boolean(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    // Project-specific additional fields (see auth.ts → user.additionalFields)
    tier: z.nativeEnum(UserTier).default(UserTier.Free),
    role: z.string().min(1).max(64).default('user'),
});
export type BetterAuthUser = z.infer<typeof BetterAuthUserSchema>;

/**
 * Better Auth session object returned by `auth.api.getSession()`.
 *
 * Contains the session metadata plus an embedded `user` object.
 */
export const BetterAuthSessionResponseSchema = z.object({
    session: z.object({
        id: z.string(),
        userId: z.string(),
        token: z.string(),
        expiresAt: z.coerce.date(),
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
        ipAddress: z.string().nullable().optional(),
        userAgent: z.string().nullable().optional(),
    }),
    user: BetterAuthUserSchema,
});
export type BetterAuthSessionResponse = z.infer<typeof BetterAuthSessionResponseSchema>;

/**
 * Zod schema for the Better Auth configuration object passed to `betterAuth()`.
 *
 * This is a compile-time documentation aid — it validates the shape of the
 * config we construct in `createAuth()`, not runtime input. Useful in tests
 * to assert that the factory produces a valid config.
 */
export const BetterAuthConfigSchema = z.object({
    secret: z.string().min(32),
    basePath: z.string().default('/api/auth'),
    baseURL: z.string().url().optional(),
    emailAndPassword: z.object({ enabled: z.boolean() }).optional(),
});

// ============================================================================
// WebSocket Client Message Schemas — ZTA trust-boundary validation
// ============================================================================
// All incoming WebSocket messages must be Zod-validated before dispatch.
// The discriminated union uses the `type` field to match message variants.

/** Schema for compile request messages from WebSocket clients. */
export const WsCompileRequestSchema = z.object({
    type: z.literal('compile'),
    sessionId: z.string().min(1).max(128),
    configuration: z.record(z.string(), z.unknown()),
    preFetchedContent: z.record(z.string(), z.string()).optional(),
    benchmark: z.boolean().optional(),
    messageId: z.string().optional(),
    timestamp: z.string().optional(),
});

/** Schema for cancel request messages from WebSocket clients. */
export const WsCancelRequestSchema = z.object({
    type: z.literal('cancel'),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().optional(),
    timestamp: z.string().optional(),
});

/** Schema for pause request messages from WebSocket clients. */
export const WsPauseRequestSchema = z.object({
    type: z.literal('pause'),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().optional(),
    timestamp: z.string().optional(),
});

/** Schema for resume request messages from WebSocket clients. */
export const WsResumeRequestSchema = z.object({
    type: z.literal('resume'),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().optional(),
    timestamp: z.string().optional(),
});

/** Schema for ping messages from WebSocket clients. */
export const WsPingSchema = z.object({
    type: z.literal('ping'),
    messageId: z.string().optional(),
    timestamp: z.string().optional(),
});

/** Discriminated union of all valid client-to-server WebSocket messages. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
    WsCompileRequestSchema,
    WsCancelRequestSchema,
    WsPauseRequestSchema,
    WsResumeRequestSchema,
    WsPingSchema,
]);

export type ValidatedClientMessage = z.infer<typeof ClientMessageSchema>;

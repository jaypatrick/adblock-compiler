// Shared type definitions for the Cloudflare Worker.

/// <reference types="@cloudflare/workers-types" />

import type { IConfiguration } from '../src/types/index.ts';
import type { PipelineBinding } from '../src/services/PipelineService.ts';
import type { BrowserWorker } from './cloudflare-workers-shim.ts';

// ============================================================================
// Database Types
// ============================================================================

// D1 type aliases — re-exported from @cloudflare/workers-types global declarations.
// deno-lint-ignore no-explicit-any
export type D1Database = globalThis.D1Database;
// deno-lint-ignore no-explicit-any
export type D1PreparedStatement = globalThis.D1PreparedStatement;
export type D1Result<T = unknown> = globalThis.D1Result<T>;
export type D1ResultMeta = globalThis.D1Meta;
export type D1ExecResult = globalThis.D1ExecResult;

// ============================================================================
// Workflow Types
// ============================================================================

export type WorkflowStatus = 'queued' | 'running' | 'completed' | 'failed' | 'paused' | 'terminated';

// Canonical binding types from @cloudflare/workers-types.
export type Workflow<Params = unknown> = globalThis.Workflow<Params>;
export type WorkflowInstance = globalThis.WorkflowInstance;

// ============================================================================
// Hyperdrive Binding
// ============================================================================

// Canonical Hyperdrive binding type from @cloudflare/workers-types.
export type HyperdriveBinding = globalThis.Hyperdrive;

// ============================================================================
// Dynamic Workers (Cloudflare Dynamic Workers — open beta, March 2026)
// ============================================================================

/**
 * Type alias for the Cloudflare Dynamic Dispatch Namespace binding.
 * Provides `load()` for one-shot ephemeral Workers and `get()` for
 * named, persistent, hibernating Dynamic Workers (DO-backed).
 *
 * Requires wrangler.toml:
 *   [[dynamic_dispatch_namespaces]]
 *   binding = "LOADER"
 *   namespace = "adblock-compiler-dynamic"
 *
 * @see https://developers.cloudflare.com/dynamic-workers/
 */
export type DynamicDispatchNamespace = {
    /**
     * Load a one-shot ephemeral Worker from a module map.
     * Ideal for stateless transforms: AST parsing, rule validation, single-file compilation.
     * The Worker is destroyed after the response completes.
     */
    load(options: DynamicWorkerLoadOptions): Promise<DynamicWorkerEntrypoint>;
    /**
     * Get-or-create a named, persistent Dynamic Worker.
     * The Worker stays warm between requests and hibernates when idle (DO semantics).
     * Ideal for per-user AiAgent instances or long-lived orchestration workers.
     */
    get(id: string, factory: DynamicWorkerFactory): Promise<DynamicWorkerEntrypoint>;
};

export interface DynamicWorkerLoadOptions {
    /** Compatibility date for the dynamic Worker's V8 runtime. */
    compatibilityDate: string;
    /** The entry point module name (must be a key in `modules`). */
    mainModule: string;
    /** Map of module name → source code string. Pre-bundle with @cloudflare/worker-bundler. */
    modules: Record<string, string>;
    /**
     * Set to `null` to fully lock down outbound network access (Zero Trust).
     * Set to a `Fetcher` to allow outbound via a specific service binding.
     * Omit to inherit the parent Worker's outbound behaviour.
     */
    globalOutbound?: null | Fetcher;
    /** Bindings granted to the dynamic Worker. Only include what it actually needs. */
    bindings?: Partial<Env>;
}

export type DynamicWorkerFactory = (id: string) => DynamicWorkerLoadOptions;

export interface DynamicWorkerEntrypoint {
    /** Dispatch an HTTP request into the dynamic Worker's `fetch` handler. */
    fetch(request: Request): Promise<Response>;
}

// ============================================================================
// Authentication & Authorization Types
// ============================================================================

export enum UserTier {
    Anonymous = 'anonymous',
    Free = 'free',
    Pro = 'pro',
    Admin = 'admin',
}

// ---------------------------------------------------------------------------
// Tier Registry — single source of truth for tier metadata
// ---------------------------------------------------------------------------

export interface ITierConfig {
    readonly order: number;
    readonly rateLimit: number;
    readonly displayName: string;
    readonly description: string;
}

export const TIER_REGISTRY: Readonly<Record<UserTier, ITierConfig>> = {
    [UserTier.Anonymous]: { order: 0, rateLimit: 10, displayName: 'Anonymous', description: 'Unauthenticated user — basic access' },
    [UserTier.Free]: { order: 1, rateLimit: 60, displayName: 'Free', description: 'Registered free-tier user' },
    [UserTier.Pro]: { order: 2, rateLimit: 300, displayName: 'Pro', description: 'Paid pro-tier user — higher limits' },
    [UserTier.Admin]: { order: 3, rateLimit: Infinity, displayName: 'Admin', description: 'Administrator — unrestricted access' },
} as const;

// @deprecated: Use TIER_REGISTRY[tier].rateLimit instead.
export const TIER_RATE_LIMITS: Readonly<Record<UserTier, number>> = {
    [UserTier.Anonymous]: TIER_REGISTRY[UserTier.Anonymous].rateLimit,
    [UserTier.Free]: TIER_REGISTRY[UserTier.Free].rateLimit,
    [UserTier.Pro]: TIER_REGISTRY[UserTier.Pro].rateLimit,
    [UserTier.Admin]: TIER_REGISTRY[UserTier.Admin].rateLimit,
} as const;

export function isTierSufficient(actual: UserTier, required: UserTier): boolean {
    return TIER_REGISTRY[actual].order >= TIER_REGISTRY[required].order;
}

// ---------------------------------------------------------------------------
// Scope Registry — single source of truth for API scopes
// ---------------------------------------------------------------------------

export enum AuthScope {
    Compile = 'compile',
    Rules = 'rules',
    Admin = 'admin',
}

export interface IScopeConfig {
    readonly displayName: string;
    readonly description: string;
    readonly requiredTier: UserTier;
}

export const SCOPE_REGISTRY: Readonly<Record<AuthScope, IScopeConfig>> = {
    [AuthScope.Compile]: {
        displayName: 'Compile',
        description: 'Compile and download filter lists',
        requiredTier: UserTier.Free,
    },
    [AuthScope.Rules]: {
        displayName: 'Rules',
        description: 'Create, read, update, and delete custom filter rules',
        requiredTier: UserTier.Free,
    },
    [AuthScope.Admin]: {
        displayName: 'Admin',
        description: 'Full administrative access — manage users, keys, and system config',
        requiredTier: UserTier.Admin,
    },
} as const;

export const VALID_SCOPES: readonly string[] = Object.values(AuthScope);

export function isValidScope(value: string): value is AuthScope {
    return VALID_SCOPES.includes(value);
}

export interface IAuthContext {
    readonly userId: string | null;
    readonly tier: UserTier;
    readonly role: string;
    readonly apiKeyId: string | null;
    readonly sessionId: string | null;
    readonly scopes: readonly string[];
    /** Authentication method used for this request */
    readonly authMethod: 'api-key' | 'anonymous' | 'better-auth';
    /** User email from auth session (avoids extra DB round-trips) */
    readonly email?: string | null;
    /** User display name from auth session */
    readonly displayName?: string | null;
    /** Per-API-key rate limit override (requests/minute). null = use tier default */
    readonly apiKeyRateLimit?: number | null;
}

export interface IAuthMiddlewareResult {
    readonly context: IAuthContext;
    readonly response?: Response;
}

// ---------------------------------------------------------------------------
// Auth Provider Abstraction
// ---------------------------------------------------------------------------

export interface IAuthProviderResult {
    readonly valid: boolean;
    readonly providerUserId?: string;
    readonly tier?: UserTier;
    readonly role?: string;
    readonly sessionId?: string | null;
    readonly error?: string;
    /** User email resolved from auth session */
    readonly email?: string | null;
    /** User display name resolved from auth session */
    readonly displayName?: string | null;
}

export interface IAuthProvider {
    readonly name: string;

    verifyToken(request: Request): Promise<IAuthProviderResult>;

    readonly authMethod: IAuthContext['authMethod'];
}

export interface ICfAccessClaims {
    readonly aud: readonly string[];
    readonly email: string;
    readonly exp: number;
    readonly iat: number;
    readonly nbf: number;
    readonly iss: string;
    readonly sub: string;
    readonly identity_nonce?: string;
    readonly country?: string;
}

export const ANONYMOUS_AUTH_CONTEXT: IAuthContext = {
    userId: null,
    tier: UserTier.Anonymous,
    role: 'anonymous',
    apiKeyId: null,
    sessionId: null,
    scopes: [],
    authMethod: 'anonymous',
    email: null,
    displayName: null,
    apiKeyRateLimit: null,
} as const;

// ============================================================================
// Environment Bindings
// ============================================================================

export type Priority = 'standard' | 'high';

export interface Env {
    COMPILER_VERSION: string;
    // KV namespaces
    COMPILATION_CACHE: KVNamespace;
    RATE_LIMIT: KVNamespace;
    METRICS: KVNamespace;
    // Static assets (always present; wrangler types generates this as required via wrangler 4.72 fix)
    ASSETS: Fetcher;
    // Queue bindings (optional - queues must be created in Cloudflare dashboard first)
    ADBLOCK_COMPILER_QUEUE?: Queue<QueueMessage>;
    ADBLOCK_COMPILER_QUEUE_HIGH_PRIORITY?: Queue<QueueMessage>;
    // Turnstile configuration
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    // Cloudflare Web Analytics token (injected into index.html at build time)
    CF_WEB_ANALYTICS_TOKEN?: string;
    // D1 Database binding (optional - for SQLite admin features)
    DB?: D1Database;
    // Admin D1 Database binding (isolated admin config: roles, flags, audit, tiers, scopes)
    ADMIN_DB?: D1Database;
    /**
     * Hyperdrive binding — required for Prisma (Neon PostgreSQL).
     *
     * Better Auth's Prisma adapter and all database access routes use this
     * binding. Wrangler binds it automatically from [[hyperdrive]] in
     * wrangler.toml. For local dev, set the local connection string in
     * `.dev.vars`:
     *   WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://...
     */
    HYPERDRIVE?: HyperdriveBinding;
    // Request body size limit in megabytes (optional - defaults to 1MB)
    MAX_REQUEST_BODY_MB?: string;
    // Workflow bindings (optional - for durable execution)
    COMPILATION_WORKFLOW?: Workflow<CompilationParams>;
    BATCH_COMPILATION_WORKFLOW?: Workflow<BatchCompilationParams>;
    CACHE_WARMING_WORKFLOW?: Workflow<CacheWarmingParams>;
    HEALTH_MONITORING_WORKFLOW?: Workflow<HealthMonitoringParams>;
    // Analytics Engine binding (optional - for metrics tracking)
    ANALYTICS_ENGINE?: AnalyticsEngineDataset;
    // Analytics Engine SQL API credentials (required for GET /metrics/prometheus)
    // Set as Worker secrets: wrangler secret put ANALYTICS_ACCOUNT_ID
    //                        wrangler secret put ANALYTICS_API_TOKEN
    ANALYTICS_ACCOUNT_ID?: string;
    ANALYTICS_API_TOKEN?: string;
    // Cloudflare Pipelines binding (optional - for metrics/audit log ingestion)
    METRICS_PIPELINE?: PipelineBinding;
    // Error reporting configuration
    ERROR_REPORTER_TYPE?: string; // 'console', 'cloudflare', 'sentry', 'composite'
    SENTRY_DSN?: string; // Sentry Data Source Name (required if using Sentry)
    SENTRY_RELEASE?: string; // Git SHA / tag injected at deploy time for source map association
    ENVIRONMENT?: string; // Deployment environment tag; mirrors wrangler.toml [vars]
    ERROR_REPORTER_VERBOSE?: string; // 'true' or 'false' for verbose console logging
    // OpenTelemetry OTLP collector endpoint (required if using OpenTelemetry traces/metrics)
    // e.g. https://otlp.grafana.net or https://api.honeycomb.io
    // Set as a Worker secret: wrangler secret put OTEL_EXPORTER_OTLP_ENDPOINT
    OTEL_EXPORTER_OTLP_ENDPOINT?: string;
    // Browser Rendering binding (for Cloudflare Browser Rendering / Playwright MCP)
    BROWSER?: BrowserWorker;
    // R2 bucket for browser-rendered screenshots (source monitor)
    FILTER_STORAGE?: R2Bucket;
    // Playwright MCP Agent Durable Object namespace
    MCP_AGENT?: DurableObjectNamespace;
    // Adblock Compiler container Durable Object namespace
    ADBLOCK_COMPILER?: DurableObjectNamespace;
    // Dynamic Workers dispatch namespace (optional — requires [[dynamic_dispatch_namespaces]] in wrangler.toml)
    LOADER?: DynamicDispatchNamespace;
    // KV namespace for persisted user rule sets (POST/GET/PUT/DELETE /api/rules)
    RULES_KV?: KVNamespace;
    // Webhook target URL for POST /api/notify (generic HTTP endpoint)
    WEBHOOK_URL?: string;
    // Datadog API key for POST /api/notify (optional third-party integration)
    DATADOG_API_KEY?: string;
    // --- Better Auth ---
    /**
     * Signing secret for Better Auth session tokens.
     * Must be a 32+ character random string.
     * Local dev:  add `BETTER_AUTH_SECRET=<random-string>` to .dev.vars
     * Production: `wrangler secret put BETTER_AUTH_SECRET`
     */
    BETTER_AUTH_SECRET?: string;
    /**
     * Public base URL for Better Auth callbacks and redirects.
     * Defaults to the request origin if not set.
     *
     * @example `"https://adblock-compiler.example.com"`
     */
    BETTER_AUTH_URL?: string;
    // GitHub OAuth provider (required for social login via GitHub)
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    // Google OAuth is wired but not yet exposed in the UI — activate by setting these secrets
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    // --- Cloudflare Access (admin route protection) ---
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    // --- CORS ---
    CORS_ALLOWED_ORIGINS?: string;
    // --- Project URLs (non-secret; set in wrangler.toml [vars]) ---
    /** Public URL of the Angular frontend worker. Set in wrangler.toml [vars]. */
    URL_FRONTEND?: string;
    /** Public URL of the backend / API worker. Set in wrangler.toml [vars]. */
    URL_API?: string;
    /** Public URL of the mdBook documentation site. Set in wrangler.toml [vars]. */
    URL_DOCS?: string;
    // --- Cloudflare Containers ---
    // Shared secret for Worker→Container auth (X-Container-Secret). Must match container env. Set via `wrangler secret put CONTAINER_SECRET`.
    CONTAINER_SECRET?: string;
    // --- Neon (admin reporting) ---
    /** Neon API key for admin reporting endpoints. Set via `wrangler secret put NEON_API_KEY`. */
    NEON_API_KEY?: string;
    /** Default Neon project ID for admin reporting endpoints. */
    NEON_PROJECT_ID?: string;
}

// ============================================================================
// Request Types
// ============================================================================

export interface CompileRequest {
    configuration: IConfiguration;
    preFetchedContent?: Record<string, string>;
    benchmark?: boolean;
    priority?: Priority;
    turnstileToken?: string;
}

export interface BatchRequest {
    requests: Array<{
        id: string;
        configuration: IConfiguration;
        preFetchedContent?: Record<string, string>;
        benchmark?: boolean;
    }>;
    priority?: Priority;
}

export interface ASTParseRequest {
    rules?: string[];
    text?: string;
}

export interface AdminQueryRequest {
    sql: string;
}

// ============================================================================
// Queue Message Types
// ============================================================================

export type QueueMessageType = 'compile' | 'batch-compile' | 'cache-warm';

export interface QueueMessage {
    type: QueueMessageType;
    requestId?: string;
    timestamp: number;
    priority?: Priority;
    group?: string;
}

export interface CompileQueueMessage extends QueueMessage {
    type: 'compile';
    configuration: IConfiguration;
    preFetchedContent?: Record<string, string>;
    benchmark?: boolean;
}

export interface BatchCompileQueueMessage extends QueueMessage {
    type: 'batch-compile';
    requests: Array<{
        id: string;
        configuration: IConfiguration;
        preFetchedContent?: Record<string, string>;
        benchmark?: boolean;
    }>;
}

export interface CacheWarmQueueMessage extends QueueMessage {
    type: 'cache-warm';
    configurations: IConfiguration[];
}

// ============================================================================
// Workflow Parameter Types
// ============================================================================

export interface CompilationParams {
    requestId: string;
    configuration: IConfiguration;
    preFetchedContent?: Record<string, string>;
    benchmark?: boolean;
    priority?: Priority;
    queuedAt: number;
}

export interface BatchCompilationParams {
    batchId: string;
    requests: Array<{
        id: string;
        configuration: IConfiguration;
        preFetchedContent?: Record<string, string>;
        benchmark?: boolean;
    }>;
    priority?: Priority;
    queuedAt: number;
}

export interface CacheWarmingParams {
    runId: string;
    configurations: IConfiguration[];
    scheduled: boolean;
}

export interface HealthMonitoringParams {
    runId: string;
    sources: Array<{
        name: string;
        url: string;
        expectedMinRules?: number;
    }>;
    alertOnFailure: boolean;
}

// ============================================================================
// Response Types
// ============================================================================

export interface CompilationResult {
    success: boolean;
    rules?: string[];
    ruleCount?: number;
    metrics?: CompilationMetrics;
    error?: string;
    compiledAt?: string;
    previousVersion?: PreviousVersion;
    cached?: boolean;
    deduplicated?: boolean;
}

export interface CompilationMetrics {
    totalDuration?: number;
    sourceCount?: number;
    transformationCount?: number;
    inputRuleCount?: number;
    outputRuleCount?: number;
    phases?: Record<string, number>;
}

export interface PreviousVersion {
    rules: string[];
    ruleCount: number;
    compiledAt: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface RateLimitData {
    count: number;
    resetAt: number;
}

export interface EndpointMetrics {
    count: number;
    success: number;
    failed: number;
    totalDuration: number;
    errors: Record<string, number>;
}

export interface AggregatedMetrics {
    window: string;
    timestamp: string;
    endpoints: Record<string, EndpointMetricsDisplay>;
}

export interface EndpointMetricsDisplay {
    count: number;
    success: number;
    failed: number;
    avgDuration: number;
    errors: Record<string, number>;
}

export interface JobHistoryEntry {
    requestId: string;
    configName: string;
    status: 'completed' | 'failed' | 'cancelled';
    duration: number;
    timestamp: string;
    error?: string;
    ruleCount?: number;
    cacheKey?: string;
}

export interface DepthHistoryEntry {
    timestamp: string;
    pending: number;
}

export interface QueueStats {
    pending: number;
    completed: number;
    failed: number;
    cancelled: number;
    totalProcessingTime: number;
    averageProcessingTime: number;
    processingRate: number;
    queueLag: number;
    lastUpdate: string;
    history: JobHistoryEntry[];
    depthHistory: DepthHistoryEntry[];
}

export interface JobInfo {
    requestId?: string;
    configName?: string;
    error?: string;
    ruleCount?: number;
    cacheKey?: string;
}

// ============================================================================
// Turnstile Types
// ============================================================================

export interface TurnstileVerifyResponse {
    success: boolean;
    challenge_ts?: string;
    hostname?: string;
    'error-codes'?: string[];
    action?: string;
    cdata?: string;
}

export interface TurnstileResult {
    success: boolean;
    error?: string;
}

// ============================================================================
// Admin Types
// ============================================================================

export interface StorageStats {
    storage_entries: number;
    filter_cache: number;
    compilation_metadata: number;
    expired_storage: number;
    expired_cache: number;
}

export interface TableInfo {
    name: string;
    type: string;
}

// ============================================================================
// Workflow Event Types
// ============================================================================

export interface WorkflowEvent {
    type: string;
    workflowId: string;
    workflowType: string;
    timestamp: string;
    step?: string;
    progress?: number;
    message?: string;
    data?: Record<string, unknown>;
}

export interface WorkflowEventLog {
    workflowId: string;
    workflowType: string;
    startedAt: string;
    completedAt?: string;
    events: WorkflowEvent[];
}

export interface WorkflowMetrics {
    totalCompilations?: number;
    totalBatches?: number;
    totalRuns?: number;
    totalChecks?: number;
}

// ============================================================================
// Browser Rendering Types
// ============================================================================

export type BrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export interface UrlResolveRequest {
    url: string;
    timeout?: number;
    waitUntil?: BrowserWaitUntil;
}

export interface UrlResolveResponse {
    success: true;
    resolvedUrl: string;
    originalUrl: string;
}

export interface SourceMonitorRequest {
    urls: string[];
    captureScreenshots?: boolean;
    screenshotPrefix?: string;
    timeout?: number;
    waitUntil?: BrowserWaitUntil;
}

export interface SourceMonitorResult {
    url: string;
    reachable: boolean;
    status?: number;
    error?: string;
    screenshotKey?: string;
    checkedAt: string;
}

export interface SourceMonitorResponse {
    success: true;
    results: SourceMonitorResult[];
    total: number;
    reachable: number;
    unreachable: number;
}

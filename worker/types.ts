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
// Email Binding
// ============================================================================

/**
 * CF Email Workers binding type.
 *
 * Bound to `env.SEND_EMAIL` via `[[send_email]]` in `wrangler.toml`.
 * The `adblock-email` email worker handles routing.
 *
 * At runtime the Cloudflare Workers runtime provides the concrete `SendEmail`
 * global. We define the interface locally so `types.ts` compiles in Deno
 * without depending on `globalThis.SendEmail` being resolvable.
 *
 * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
 */
export interface SendEmail {
    // deno-lint-ignore no-explicit-any
    send(message: any): Promise<void>;
}

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
    /**
     * Bindings granted to the dynamic Worker.
     * Restricted to `DynamicWorkerSafeBindings` — a least-privilege allowlist of KV
     * namespaces and read-only config values. Auth secrets, D1 databases, Durable
     * Object namespaces, and R2 buckets are structurally excluded to prevent
     * accidental privilege escalation inside isolates.
     */
    bindings?: DynamicWorkerSafeBindings;
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
    PayAsYouGo = 'payg',
    Vendor = 'vendor',
    Enterprise = 'enterprise',
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
    [UserTier.Admin]: { order: 4, rateLimit: Infinity, displayName: 'Admin', description: 'Administrator — unrestricted access' },
    [UserTier.PayAsYouGo]: { order: 1.5, rateLimit: 120, displayName: 'Pay As You Go', description: 'Per-call billing via Stripe — no subscription required' },
    [UserTier.Vendor]: { order: 2.5, rateLimit: 600, displayName: 'Vendor', description: 'High-volume org subscription with negotiated limits' },
    [UserTier.Enterprise]: { order: 3, rateLimit: Infinity, displayName: 'Enterprise', description: 'Enterprise org — dedicated limits and SLA' },
} as const;

// @deprecated: Use TIER_REGISTRY[tier].rateLimit instead.
export const TIER_RATE_LIMITS: Readonly<Record<UserTier, number>> = {
    [UserTier.Anonymous]: TIER_REGISTRY[UserTier.Anonymous].rateLimit,
    [UserTier.Free]: TIER_REGISTRY[UserTier.Free].rateLimit,
    [UserTier.Pro]: TIER_REGISTRY[UserTier.Pro].rateLimit,
    [UserTier.Admin]: TIER_REGISTRY[UserTier.Admin].rateLimit,
    [UserTier.PayAsYouGo]: TIER_REGISTRY[UserTier.PayAsYouGo].rateLimit,
    [UserTier.Vendor]: TIER_REGISTRY[UserTier.Vendor].rateLimit,
    [UserTier.Enterprise]: TIER_REGISTRY[UserTier.Enterprise].rateLimit,
} as const;

export function isTierSufficient(actual: UserTier, required: UserTier): boolean {
    return TIER_REGISTRY[actual].order >= TIER_REGISTRY[required].order;
}

// ---------------------------------------------------------------------------
// PAYG Tier Limits — single source of truth for all PAYG operational limits
// ---------------------------------------------------------------------------

/**
 * Operational limits for Pay-As-You-Go (PAYG) customers.
 *
 * All PAYG gating decisions must reference this constant — never hardcode
 * individual limit values in route handlers or middleware.
 *
 * @see worker/middleware/payg-middleware.ts — enforces these limits at the request layer
 * @see docs/billing/payg.md — user-facing documentation
 */
export const PAYG_TIER_LIMITS = {
    // Rate limiting
    requestsPerMinute: 120,
    requestsPerDay: 500,

    // Compilation limits
    maxRulesPerList: 50_000,
    maxSourcesPerCompile: 5,
    maxListSizeBytes: 5_242_880,

    // Throughput / queueing
    maxConcurrentJobs: 2,
    queuePriority: 'standard' as const,
    queueTimeoutMs: 30_000,

    // Storage / durability
    retentionDays: 7,
    maxStoredOutputs: 10,

    // Features disabled for PAYG
    astStorageEnabled: false,
    translationEnabled: false,
    globalSharingEnabled: false,
    batchApiEnabled: false,
    webhooksEnabled: false,
    versionHistoryEnabled: false,
    cdnDistributionEnabled: false,
} as const;

export type PaygTierLimits = typeof PAYG_TIER_LIMITS;

/**
 * Operational limits and feature flags for subscription-based customers (Pro, Vendor, Enterprise).
 *
 * These are the Worker's in-memory operational defaults and feature flags for
 * subscription tiers. They are related to billing configuration but are not a
 * guaranteed 1:1 mirror of the `SubscriptionPlan` columns in `prisma/schema.prisma`.
 * Some keys represent Worker-only execution or queueing behaviour (e.g. `queuePriority`,
 * `maxRulesPerList`) that do not exist as Prisma columns.
 *
 * @see prisma/schema.prisma — SubscriptionPlan billing context
 * @see docs/billing/README.md — billing model overview
 */
export const SUBSCRIPTION_TIER_LIMITS = {
    [UserTier.Pro]: {
        requestsPerMinute: 300,
        requestsPerDay: 10_000,
        maxRulesPerList: 200_000,
        maxSourcesPerCompile: 20,
        maxListSizeBytes: 52_428_800,
        maxConcurrentJobs: 10,
        queuePriority: 'high' as const,
        queueTimeoutMs: 120_000,
        retentionDays: 90,
        maxStoredOutputs: 500,
        astStorageEnabled: true,
        translationEnabled: false,
        globalSharingEnabled: true,
        batchApiEnabled: true,
        webhooksEnabled: true,
        versionHistoryEnabled: true,
        cdnDistributionEnabled: false,
    },
    [UserTier.Vendor]: {
        requestsPerMinute: 600,
        requestsPerDay: 50_000,
        maxRulesPerList: 500_000,
        maxSourcesPerCompile: 50,
        maxListSizeBytes: 104_857_600,
        maxConcurrentJobs: 25,
        queuePriority: 'high' as const,
        queueTimeoutMs: 300_000,
        retentionDays: 365,
        maxStoredOutputs: 2_000,
        astStorageEnabled: true,
        translationEnabled: true,
        globalSharingEnabled: true,
        batchApiEnabled: true,
        webhooksEnabled: true,
        versionHistoryEnabled: true,
        cdnDistributionEnabled: true,
    },
    [UserTier.Enterprise]: {
        requestsPerMinute: null,
        requestsPerDay: null,
        maxRulesPerList: null,
        maxSourcesPerCompile: null,
        maxListSizeBytes: null,
        maxConcurrentJobs: null,
        queuePriority: 'high' as const,
        queueTimeoutMs: 600_000,
        retentionDays: null,
        maxStoredOutputs: null,
        astStorageEnabled: true,
        translationEnabled: true,
        globalSharingEnabled: true,
        batchApiEnabled: true,
        webhooksEnabled: true,
        versionHistoryEnabled: true,
        cdnDistributionEnabled: true,
    },
} as const;

export type SubscriptionTierLimits = typeof SUBSCRIPTION_TIER_LIMITS;

// ---------------------------------------------------------------------------
// Scope Registry — single source of truth for API scopes
// ---------------------------------------------------------------------------

export enum AuthScope {
    Compile = 'compile',
    Rules = 'rules',
    Admin = 'admin',
    /** Access to AI agent endpoints (admin-only) */
    Agents = 'agents',
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
    [AuthScope.Agents]: {
        displayName: 'Agents',
        description: 'Access to AI agent endpoints (admin-only)',
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
    // Static assets (optional — absent when the API worker is deployed without an [assets] binding)
    ASSETS?: Fetcher;
    // Queue bindings (optional - queues must be created in Cloudflare dashboard first)
    ADBLOCK_COMPILER_QUEUE?: Queue<QueueMessage>;
    ADBLOCK_COMPILER_QUEUE_HIGH_PRIORITY?: Queue<QueueMessage>;
    // Dedicated error dead-letter queue — isolated from compile queues.
    // Receives error events from app.onError and persists them to ERROR_BUCKET.
    ERROR_QUEUE?: Queue<ErrorQueueMessage>;
    // Turnstile configuration
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;

    /**
     * Stripe webhook signing secret for verifying webhook signatures.
     * Required for production Stripe integration.
     * Local dev:  add `STRIPE_WEBHOOK_SECRET=whsec_...` to .dev.vars
     * Production: `wrangler secret put STRIPE_WEBHOOK_SECRET`
     */
    STRIPE_WEBHOOK_SECRET?: string;
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
    /**
     * Durable email delivery workflow binding.
     *
     * Creates a step-checkpointed `EmailDeliveryWorkflow` instance for each email
     * job, providing automatic retry with exponential back-off, crash recovery,
     * and delivery-receipt storage in KV.
     *
     * wrangler.toml:
     * ```toml
     * [[workflows]]
     * name       = "email-delivery-workflow"
     * binding    = "EMAIL_DELIVERY_WORKFLOW"
     * class_name = "EmailDeliveryWorkflow"
     * ```
     *
     * @see worker/workflows/EmailDeliveryWorkflow.ts
     */
    EMAIL_DELIVERY_WORKFLOW?: Workflow<import('./workflows/EmailDeliveryWorkflow.ts').EmailDeliveryParams>;
    /**
     * Email delivery queue producer binding.
     *
     * `QueuedEmailService.sendEmail()` enqueues jobs here.  The queue consumer
     * (`handleEmailQueue`) reads messages and creates `EmailDeliveryWorkflow`
     * instances for durable delivery.
     *
     * wrangler.toml:
     * ```toml
     * [[queues.producers]]
     * queue   = "adblock-compiler-email-queue"
     * binding = "EMAIL_QUEUE"
     * ```
     *
     * @see worker/handlers/email-queue.ts
     * @see worker/services/email-service.ts — QueuedEmailService
     */
    EMAIL_QUEUE?: Queue<EmailQueueMessage>;
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
    // R2 bucket for error dead-letter logs (NDJSON batches written by handleErrorQueue).
    // Maps to wrangler.toml [[r2_buckets]] binding = "ERROR_BUCKET".
    ERROR_BUCKET?: R2Bucket;
    // R2 bucket for compiler logs
    COMPILER_LOGS?: R2Bucket;
    // Playwright MCP Agent Durable Object namespace
    MCP_AGENT?: DurableObjectNamespace;
    // Adblock Compiler container Durable Object namespace
    ADBLOCK_COMPILER?: DurableObjectNamespace;
    // Compilation Coordinator Durable Object namespace (global request deduplication)
    COMPILATION_COORDINATOR?: DurableObjectNamespace;
    // RateLimiterDO — Durable Object for atomic per-identity rate limiting.
    // Replaces KV-based rate limiting with strongly-consistent DO shards.
    // When bound, checkRateLimitTiered() uses this DO; falls back to RATE_LIMIT KV if absent.
    // @see worker/rate-limiter-do.ts
    // @see docs/architecture/durable-objects.md
    RATE_LIMITER_DO?: DurableObjectNamespace;
    // WsHibernationDO — Durable Object for hibernatable WebSocket connections.
    // Keeps long-lived WebSocket connections open across Worker isolate teardowns.
    // Also provides session presence tracking via DO Storage.
    // @see worker/ws-hibernation-do.ts
    // @see docs/architecture/durable-objects.md
    WS_HIBERNATION_DO?: DurableObjectNamespace;
    // Dynamic Dispatch Namespace binding (optional — add to wrangler.toml to enable)
    // [[dynamic_dispatch_namespaces]], binding = "LOADER", namespace = "adblock-compiler-dynamic"
    // @see https://developers.cloudflare.com/dynamic-workers/
    // @see https://github.com/jaypatrick/adblock-compiler/issues/1386
    LOADER?: DynamicDispatchNamespace;
    // Dynamic Workers loader binding (optional — add to wrangler.toml to enable)
    // type = "dynamic_worker_loader", name = "DYNAMIC_WORKER_LOADER"
    // @see https://developers.cloudflare.com/dynamic-workers/
    // @see https://github.com/jaypatrick/adblock-compiler/issues/1386
    DYNAMIC_WORKER_LOADER?: import('./dynamic-workers/types.ts').DynamicWorkerLoader;
    // KV namespace for persisted user rule sets (POST/GET/PUT/DELETE /api/rules)
    RULES_KV?: KVNamespace;
    // Dedicated KV namespace for user-created configuration files (POST /api/configuration/create).
    // Isolates config lifecycle (24h TTL) from short-lived compilation cache entries.
    // Create with: wrangler kv:namespace create CONFIG_STORE
    // Falls back to COMPILATION_CACHE when absent.
    CONFIG_STORE?: KVNamespace;
    // Feature flag KV namespace — stores simple on/off flags for the Worker.
    // Create with: wrangler kv:namespace create FEATURE_FLAGS
    // Toggle flags at runtime: wrangler kv:key put --binding FEATURE_FLAGS flag:ENABLE_BATCH_STREAMING '{"enabled":true,"updatedAt":"2025-01-01T00:00:00.000Z"}'
    FEATURE_FLAGS?: KVNamespace;
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
    /**
     * Better Auth Dash API key for the dash.better-auth.com dashboard integration.
     * Enables the `dash()` plugin to connect to the monitoring dashboard.
     * Local dev:  add `BETTER_AUTH_API_KEY=<key>` to .dev.vars
     * Production: `wrangler secret put BETTER_AUTH_API_KEY`
     */
    BETTER_AUTH_API_KEY?: string;
    /**
     * KV namespace used as Better Auth secondary storage (sessions, rate-limit counters,
     * verification tokens).  Offloads short-lived data from Postgres/Neon to the edge.
     * Create with: `wrangler kv:namespace create BETTER_AUTH_KV`
     * Then add the resulting binding entry to `wrangler.toml [[kv_namespaces]]`.
     */
    BETTER_AUTH_KV?: KVNamespace;
    /**
     * REST API URL for the BETTER_AUTH_KV namespace.
     * Used by `dash()` and `sentinel()` `kvUrl` option for high-performance
     * rate-limit counter storage at the edge.
     * Local dev:  add `BETTER_AUTH_KV_URL=<url>` to .dev.vars
     * Production: `wrangler secret put BETTER_AUTH_KV_URL`
     */
    BETTER_AUTH_KV_URL?: string;
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
    /** Public URL of the landing / marketing page. Set in wrangler.toml [vars]. */
    URL_LANDING?: string;
    /** Canonical root domain (e.g. "bloqr.dev"). Used for crawl-protection noindex logic. */
    CANONICAL_DOMAIN?: string;
    // --- Cloudflare Page Shield ---
    /**
     * Cloudflare zone ID. Only required once the Page Shield sync cron job
     * (`handleScheduled` → `syncPageShieldScripts`) is enabled.
     * Production: `wrangler secret put CF_ZONE_ID`
     */
    CF_ZONE_ID?: string;
    /**
     * Scoped Cloudflare API token with Page Shield read permissions.
     * Only required once the Page Shield sync cron job is enabled.
     * Production: `wrangler secret put CF_PAGE_SHIELD_API_TOKEN`
     */
    CF_PAGE_SHIELD_API_TOKEN?: string;
    // --- Cloudflare Containers ---
    // Shared secret for Worker→Container auth (X-Container-Secret). Must match container env. Set via `wrangler secret put CONTAINER_SECRET`.
    CONTAINER_SECRET?: string;
    // --- Neon (admin reporting) ---
    /** Neon API key for admin reporting endpoints. Set via `wrangler secret put NEON_API_KEY`. */
    NEON_API_KEY?: string;
    /** Default Neon project ID for admin reporting endpoints. */
    NEON_PROJECT_ID?: string;
    /**
     * Stripe publishable key (non-secret, safe to expose to frontend).
     * Set in wrangler.toml [vars].
     */
    STRIPE_PUBLISHABLE_KEY?: string;
    /**
     * Stripe secret key for server-side Stripe API calls.
     * Local dev: add to .dev.vars
     * Production: wrangler secret put STRIPE_SECRET_KEY
     */
    STRIPE_SECRET_KEY?: string;
    /**
     * Price per PAYG API call in USD cents (e.g. "1" = $0.01).
     * Set in wrangler.toml [vars]. Defaults to 1 cent if not set.
     */
    PAYG_PRICE_PER_CALL_USD_CENTS?: string;
    /**
     * PAYG spend threshold in USD cents at which a customer is flagged
     * for subscription conversion upsell (e.g. "2000" = $20).
     * Set in wrangler.toml [vars]. Defaults to 2000.
     */
    PAYG_CONVERSION_THRESHOLD_USD_CENTS?: string;
    /**
     * Stripe PAYG product/price ID for the Checkout Session.
     * Set in wrangler.toml [vars].
     */
    STRIPE_PAYG_PRICE_ID?: string;
    // ─── Email (CF Email Workers binding — adblock-email) ────────────────────
    /**
     * Cloudflare Email Workers outbound send binding.
     *
     * Configured via `[[send_email]]` in `wrangler.toml` with the `adblock-email`
     * email worker. When present, {@link createEmailService} uses this binding
     * directly as the priority-2 provider.
     *
     * wrangler.toml:
     * ```toml
     * [[send_email]]
     * name = "SEND_EMAIL"
     * ```
     *
     * @see https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
     */
    SEND_EMAIL?: SendEmail;

    // ─── Email (Resend — critical auth path) ─────────────────────────────────
    /**
     * Resend API key for critical auth-path email delivery.
     *
     * Used exclusively by ResendEmailService for email verification,
     * password reset, and security alerts where silent delivery failure
     * is unacceptable.
     *
     * Local dev:  add `RESEND_API_KEY=re_test_...` to .dev.vars
     * Production: `wrangler secret put RESEND_API_KEY`
     *
     * @see worker/services/email-service.ts — ResendEmailService
     * @see https://resend.com/api-keys
     */
    RESEND_API_KEY?: string;

    // ─── Email (Cloudflare Email Service REST — transactional) ───────────────
    /**
     * Cloudflare API token scoped to Email Send permissions.
     *
     * Used by CfEmailServiceRestService for transactional notification emails
     * (compilation complete, bulk alerts, etc.).
     *
     * Endpoint: POST /accounts/{CF_ACCOUNT_ID}/email/sending/send
     *
     * Local dev:  add `CF_EMAIL_API_TOKEN=...` to .dev.vars
     * Production: `wrangler secret put CF_EMAIL_API_TOKEN`
     *
     * @see https://developers.cloudflare.com/email-service/api/send-emails/
     */
    CF_EMAIL_API_TOKEN?: string;

    /**
     * Cloudflare account ID — required for CfEmailServiceRestService.
     *
     * Non-secret: safe to store in wrangler.toml [vars] or .dev.vars.
     * Find at: https://dash.cloudflare.com → account overview → Account ID.
     */
    CF_ACCOUNT_ID?: string;
}

/**
 * Least-privilege binding subset permitted for dynamic Workers loaded via `LOADER`.
 *
 * Only KV namespaces and read-only config values are allowed — never auth secrets,
 * D1 databases, Durable Object namespaces, or R2 buckets. This makes it
 * structurally impossible to accidentally grant privileged bindings to an isolate.
 *
 * Used as the `bindings` field type in `DynamicWorkerLoadOptions`.
 *
 * @see DynamicWorkerLoadOptions
 * @see DynamicWorkerBindings — equivalent type for the DYNAMIC_WORKER_LOADER model
 */
export type DynamicWorkerSafeBindings = Partial<Pick<Env, 'COMPILATION_CACHE' | 'RATE_LIMIT' | 'METRICS' | 'COMPILER_VERSION'>>;

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

// ============================================================================
// Error Queue Message Types
// ============================================================================

/**
 * Error severity levels for filtering and alerting.
 */
export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

/**
 * Error category for classification and metrics.
 */
export type ErrorCategory =
    | 'http_error' // HTTP client/server errors (4xx, 5xx)
    | 'validation_error' // Schema validation failures
    | 'auth_error' // Authentication/authorization failures
    | 'rate_limit_error' // Rate limiting errors
    | 'compilation_error' // Filter list compilation errors
    | 'storage_error' // KV/R2/D1 storage errors
    | 'queue_error' // Queue processing errors
    | 'workflow_error' // Durable Objects Workflow errors
    | 'unknown_error'; // Uncategorized errors

/**
 * Message published to ERROR_QUEUE when an unhandled error occurs in the worker.
 * Batches are consumed by handleErrorQueue() and persisted to ERROR_BUCKET (R2)
 * as NDJSON for long-term durable log storage.
 */
export interface ErrorQueueMessage {
    readonly type: 'error';
    readonly requestId: string;
    readonly timestamp: string;
    readonly path: string;
    readonly method: string;
    /**
     * Short human-readable summary of the error (i.e. `Error.message`).
     * Suitable for dashboards and alert summaries.
     */
    readonly message: string;
    readonly stack?: string;
    /**
     * Full serialised error representation.
     * For `Error` instances this is `Error.stack` (which includes `message`).
     * For non-Error throws this may be a JSON serialisation or `String(err)`.
     * Intended for post-incident analysis where the full context is needed.
     */
    readonly errorDetails: string;
    /**
     * Error severity level for filtering and alerting.
     * Defaults to 'error' if not specified.
     */
    readonly severity?: ErrorSeverity;
    /**
     * Error category for classification and metrics.
     * Defaults to 'unknown_error' if not specified.
     */
    readonly category?: ErrorCategory;
    /**
     * HTTP status code if the error originated from an HTTP response.
     */
    readonly statusCode?: number;
    /**
     * Additional context data for debugging (request headers, query params, etc.).
     * Stored as JSON string to avoid deep object nesting.
     */
    readonly context?: string;
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

/**
 * Message placed on `adblock-compiler-email-queue` by {@link QueuedEmailService}.
 *
 * The queue consumer (`handleEmailQueue`) reads these messages and creates an
 * `EmailDeliveryWorkflow` instance for each one, providing durable, retryable
 * email delivery with step-level checkpointing.
 *
 * @see worker/handlers/email-queue.ts
 * @see worker/services/email-service.ts — QueuedEmailService
 * @see worker/workflows/EmailDeliveryWorkflow.ts
 */
export interface EmailQueueMessage {
    /** Discriminator — always `'email'`. */
    readonly type: 'email';
    /** Optional caller-supplied request ID for tracing. */
    readonly requestId?: string;
    /** Unix ms timestamp when the message was enqueued. */
    readonly timestamp: number;
    /** Email payload to deliver. */
    readonly payload: {
        readonly to: string;
        readonly subject: string;
        readonly html: string;
        readonly text: string;
    };
    /**
     * Stable idempotency key for deduplication.
     *
     * Used as the Workflow instance ID so replayed queue messages never
     * send the same email twice. Recommended format: `email-<requestId>`.
     */
    readonly idempotencyKey?: string;
    /** Human-readable label for the send reason (logged in Workflow steps). */
    readonly reason?: string;
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

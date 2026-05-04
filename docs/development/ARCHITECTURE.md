# Adblock Compiler — System Architecture

> A comprehensive breakdown of the **adblock-compiler** system: modules, sub-modules, services, data flow, and deployment targets.

---

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [System Context Diagram](#system-context-diagram)
3. [Core Compilation Pipeline](#core-compilation-pipeline)
4. [Module Map](#module-map)
5. [Detailed Module Breakdown](#detailed-module-breakdown)
   - [Compiler (`src/compiler/`)](#compiler-srccompiler)
   - [Platform Abstraction (`src/platform/`)](#platform-abstraction-srcplatform)
   - [Transformations (`src/transformations/`)](#transformations-srctransformations)
   - [Downloader (`src/downloader/`)](#downloader-srcdownloader)
   - [Configuration & Validation (`src/configuration/`, `src/config/`)](#configuration--validation)
   - [Storage (`src/storage/`)](#storage-srcstorage)
   - [Services (`src/services/`)](#services-srcservices)
   - [Queue (`src/queue/`)](#queue-srcqueue)
   - [Diagnostics & Tracing (`src/diagnostics/`)](#diagnostics--tracing-srcdiagnostics)
   - [Filters (`src/filters/`)](#filters-srcfilters)
   - [Formatters (`src/formatters/`)](#formatters-srcformatters)
   - [Diff (`src/diff/`)](#diff-srcdiff)
   - [Plugins (`src/plugins/`)](#plugins-srcplugins)
   - [Utilities (`src/utils/`)](#utilities-srcutils)
   - [CLI (`src/cli/`)](#cli-srccli)
   - [Deployment (`src/deployment/`)](#deployment-srcdeployment)
6. [Cloudflare Worker (`worker/`)](#cloudflare-worker-worker)
7. [Angular Frontend (`frontend/`)](#angular-frontend-frontend)
8. [Cross-Cutting Concerns](#cross-cutting-concerns)
9. [Data Flow Diagrams](#data-flow-diagrams)
10. [Deployment Architecture](#deployment-architecture)
11. [Technology Stack](#technology-stack)

---

## High-Level Overview

The **adblock-compiler** is a *compiler-as-a-service* for adblock filter lists. It downloads filter list sources from remote URLs or local files, applies a configurable pipeline of transformations, and produces optimized, deduplicated output. It runs in three modes:

| Mode | Runtime | Entry Point |
|------|---------|-------------|
| **CLI** | Deno | `src/cli.ts` / `src/cli/CliApp.deno.ts` |
| **Library** | Deno / Node.js | `src/index.ts` (JSR: `@jk-com/adblock-compiler`) |
| **Edge API** | Cloudflare Workers | `worker/worker.ts` |

---

## System Context Diagram

```mermaid
flowchart TD
    classDef external fill:#37474f,stroke:#263238,color:#fff
    classDef client fill:#1b5e20,stroke:#0a3010,color:#fff
    classDef system fill:#b8860b,stroke:#8a6208,color:#fff
    classDef infra fill:#1a237e,stroke:#0d1257,color:#fff
    classDef observability fill:#b84000,stroke:#7a2900,color:#fff
    classDef auth fill:#880e4f,stroke:#560930,color:#fff

    subgraph EW["External World"]
        FLS["Filter List Sources\n(EasyList, uBlock, AdGuard URLs)"]:::external
        WB["Browser\n(Angular 21 SPA/SSR)"]:::client
        AC["API Consumers\n(CI/CD, curl, scripts)"]:::client
        CLIA["CLI User\n(Deno)"]:::client
        AIAG["AI Agent / MCP Client\n(GitHub Copilot, etc.)"]:::client
    end

    subgraph ACS["adblock-compiler System"]
        CLI["CLI App\n(src/cli/)"]:::system
        ANGULAR["Angular Frontend\n(frontend/ — SSR + PWA)"]:::system
        CFW["Cloudflare Worker\n(worker/worker.ts + router.ts)"]:::system
        CORE["Core Library\n(FilterCompiler / WorkerCompiler)"]:::system
        DL["Download & Fetch\n(src/downloader/ + src/platform/)"]:::system
        TP["Transform Pipeline\n(src/transformations/)"]:::system
        VS["Validate & Schema\n(src/configuration/)"]:::system
        ST["Storage & Cache\n(src/storage/)"]:::system
        DG["Diagnostics & Tracing\n(src/diagnostics/)"]:::system
        MCP["MCP Agent\n(worker/mcp-agent.ts)"]:::system
        TW["Tail Worker\n(worker/tail.ts)"]:::observability
    end

    subgraph CF["Cloudflare Platform"]
        KV["KV Store\n(Cache, Rate Limit, Metrics)"]:::infra
        D1["D1 (SQLite)\n(Metadata, History, Auth)"]:::infra
        QQ["Queues\n(Std + High Priority)"]:::infra
        AE["Analytics Engine"]:::observability
        HD["Hyperdrive\n(PostgreSQL proxy)"]:::infra
        BR["Browser Rendering\n(Playwright)"]:::infra
        CFAC["Cloudflare Access\n(Zero Trust WAF)"]:::auth
    end

    subgraph EXT["External Services"]
        CLERK["Clerk\n(Auth / User Mgmt)"]:::auth
        SENTRY["Sentry\n(Error Tracking)"]:::observability
        PROM["Prometheus / OTel\n(Metrics Scraping)"]:::observability
        PG["PostgreSQL\n(via Hyperdrive)"]:::infra
    end

    WB --> ANGULAR
    WB --> CFAC
    AC --> CFAC
    AIAG --> MCP
    CLIA --> CLI
    CFAC --> CFW
    ANGULAR --> CFW
    CLI --> CORE
    CFW --> CORE
    MCP --> BR
    CORE --> DL
    CORE --> TP
    CORE --> VS
    CORE --> ST
    CORE --> DG
    DL --> FLS
    ST --> KV
    ST --> D1
    ST --> HD
    HD --> PG
    CFW --> QQ
    CFW --> AE
    CFW --> CLERK
    CFW --> SENTRY
    DG --> SENTRY
    TW --> SENTRY
    CFW --> PROM
```

---

## Core Compilation Pipeline

Every compilation—CLI, library, or API—follows this pipeline:

```mermaid
flowchart LR
    classDef step fill:#1a237e,stroke:#0d1257,color:#fff
    A["1. Config<br/>Loading"]:::step --> B["2. Validate<br/>(Zod)"]:::step
    B --> C["3. Download<br/>Sources"]:::step
    C --> D["4. Per-Source<br/>Transforms"]:::step
    D --> E["5. Merge<br/>All Sources"]:::step
    E --> F["6. Global<br/>Transforms"]:::step
    F --> G["7. Checksum<br/>& Header"]:::step
    G --> H["8. Output<br/>(Rules)"]:::step
```

### Step-by-Step

| Step | Component | Description |
|------|-----------|-------------|
| 1 | `ConfigurationLoader` / API body | Load JSON configuration with source URLs and options |
| 2 | `ConfigurationValidator` (Zod) | Validate against `ConfigurationSchema` |
| 3 | `FilterDownloader` / `PlatformDownloader` | Fetch source content via HTTP, file system, or pre-fetched cache |
| 4 | `SourceCompiler` + `TransformationPipeline` | Apply per-source transformations (e.g., remove comments, validate) |
| 5 | `FilterCompiler` / `WorkerCompiler` | Merge rules from all sources, apply exclusions/inclusions |
| 6 | `TransformationPipeline` | Apply global transformations (e.g., deduplicate, compress) |
| 7 | `HeaderGenerator` + `checksum` util | Generate metadata header, compute checksum |
| 8 | `OutputWriter` / HTTP response / SSE stream | Write to file, return JSON, or stream via SSE |

---

## Module Map

```mermaid
mindmap
  root((src/))
    entry["index.ts · version.ts · cli.ts · cli.deno.ts"]
    compiler["compiler/\nFilterCompiler · SourceCompiler\nIncrementalCompiler · HeaderGenerator"]
    platform["platform/\nWorkerCompiler · HttpFetcher\nCompositeFetcher · PlatformDownloader"]
    transformations["transformations/\nRegistry · Pipeline · 14+ built-in transforms"]
    downloader["downloader/\nFilterDownloader · ContentFetcher\nPreprocessorEvaluator · ConditionalEvaluator"]
    configuration["configuration/\nConfigurationValidator · Zod schemas\nCompileRequest · BatchRequest"]
    config["config/\nNETWORK_DEFAULTS · WORKER_DEFAULTS\nSTORAGE_DEFAULTS · COMPILATION_DEFAULTS"]
    storage["storage/\nIStorageAdapter · D1StorageAdapter\nHyperdriveStorageAdapter · PrismaStorageAdapter\nCachingDownloader · ChangeDetector · SourceHealthMonitor"]
    services["services/\nFilterService · ASTViewerService\nAnalyticsService · PipelineService"]
    queue["queue/\nIQueueProvider · CloudflareQueueProvider\nCompileMessage · BatchCompileMessage\nCacheWarmMessage · HealthCheckMessage"]
    diagnostics["diagnostics/\nTracingContext · DiagnosticsCollector\nOpenTelemetryExporter"]
    filters["filters/\nRuleFilter"]
    formatters["formatters/\nOutputFormatter · BaseFormatter\nadblock · hosts · dnsmasq · domains"]
    diff["diff/\nDiffReport"]
    plugins["plugins/\nPluginRegistry · Plugin\nPluginTransformationWrapper"]
    resources["resources/\nstatic assets · bundled lists"]
    schemas["schemas/\nshared Zod schema definitions"]
    types["types/\npublic interfaces · IConfiguration\nISource · websocket types"]
    utils["utils/\nRuleUtils · ErrorUtils · CircuitBreaker\nAsyncRetry · Logger · checksum\nAGTreeParser · BenchmarkCollector"]
    deployment["deployment/\nversion tracking · D1 history"]
```

---

## Detailed Module Breakdown

### Compiler (`src/compiler/`)

The orchestration layer that drives the entire compilation process.

```mermaid
flowchart TD
    classDef core fill:#b8860b,stroke:#8a6208,color:#fff
    classDef module fill:#1b5e20,stroke:#0a3010,color:#fff
    FC["FilterCompiler\n← Main entry point (has FS access)"]:::core
    FC -->|uses| SC["SourceCompiler"]:::module
    FC -->|uses| HG["HeaderGenerator"]:::module
    FC -->|uses| TP["TransformationPipeline"]:::module
    SC -->|uses| FD["FilterDownloader"]:::module
```

| Class | Responsibility |
|-------|---------------|
| **FilterCompiler** | Orchestrates full compilation: validation → download → transform → header → output. Has file system access via Deno. |
| **SourceCompiler** | Compiles a single source: downloads content, applies per-source transformations. |
| **IncrementalCompiler** | Wraps `FilterCompiler` with content-hash-based caching; only recompiles changed sources. Uses `ICacheStorage`. |
| **HeaderGenerator** | Generates metadata headers (title, description, version, timestamp, checksum placeholder). |

### Platform Abstraction (`src/platform/`)

Enables the compiler to run in environments **without file system access** (browsers, Cloudflare Workers, Deno Deploy).

```mermaid
flowchart TD
    classDef core fill:#b8860b,stroke:#8a6208,color:#fff
    classDef module fill:#1b5e20,stroke:#0a3010,color:#fff
    WC["WorkerCompiler\n← No FS access"]:::core
    WC -->|uses| CF["CompositeFetcher\n← Chain of Responsibility"]:::module
    CF --> PFCF["PreFetchedContentFetcher"]:::module
    CF --> HF["HttpFetcher\n(Fetch API)"]:::module
```

| Class | Responsibility |
|-------|---------------|
| **WorkerCompiler** | Edge-compatible compiler; delegates I/O to `IContentFetcher` chain. |
| **IContentFetcher** | Interface: `canHandle(source)` + `fetch(source)`. |
| **HttpFetcher** | Fetches via the standard `Fetch API`; works everywhere. |
| **PreFetchedContentFetcher** | Serves content from an in-memory map (for pre-fetched content from the worker). |
| **CompositeFetcher** | Tries fetchers in order; first match wins. |
| **PlatformDownloader** | Platform-agnostic downloader with preprocessor directive support. |

### Transformations (`src/transformations/`)

The transformation pipeline uses the **Strategy** and **Registry** patterns.

```mermaid
flowchart TD
    classDef core fill:#b8860b,stroke:#8a6208,color:#fff
    classDef module fill:#1b5e20,stroke:#0a3010,color:#fff
    TP["TransformationPipeline\n← Applies ordered transforms"]:::core
    TP -->|delegates to| TR["TransformationRegistry\n← Maps type → instance"]:::module
    TR -->|contains| ST1["SyncTransformation\n(Deduplicate)"]:::module
    TR -->|contains| ST2["SyncTransformation\n(Compress)"]:::module
    TR -->|contains| AT["AsyncTransformation\n(future async)"]:::module
```

**Base Classes:**

| Class | Description |
|-------|-------------|
| `Transformation` | Abstract base; defines `execute(rules): Promise<string[]>` |
| `SyncTransformation` | For CPU-bound in-memory transforms; wraps sync method in `Promise.resolve()` |
| `AsyncTransformation` | For transforms needing I/O or external resources |

**Built-in Transformations:**

| Transformation | Type | Description |
|---------------|------|-------------|
| `RemoveComments` | Sync | Strips comment lines (`!`, `#`) |
| `Compress` | Sync | Converts hosts → adblock format, removes redundant rules |
| `RemoveModifiers` | Sync | Strips unsupported modifiers from rules |
| `Validate` | Sync | Validates rules for DNS-level blocking, removes IPs |
| `ValidateAllowIp` | Sync | Like Validate but keeps IP address rules |
| `Deduplicate` | Sync | Removes duplicate rules, preserves order |
| `InvertAllow` | Sync | Converts blocking rules to allow (exception) rules |
| `RemoveEmptyLines` | Sync | Strips blank lines |
| `TrimLines` | Sync | Removes leading/trailing whitespace |
| `InsertFinalNewLine` | Sync | Ensures output ends with newline |
| `ConvertToAscii` | Sync | Converts IDN/Unicode domains to punycode |
| `Exclude` | Sync | Applies exclusion patterns |
| `Include` | Sync | Applies inclusion patterns |
| `ConflictDetection` | Sync | Detects conflicting block/allow rules |
| `RuleOptimizer` | Sync | Optimizes and simplifies rules |

### Downloader (`src/downloader/`)

Handles fetching filter list content with preprocessor directive support.

```mermaid
flowchart TD
    classDef core fill:#b8860b,stroke:#8a6208,color:#fff
    classDef module fill:#1b5e20,stroke:#0a3010,color:#fff
    FD["FilterDownloader\n← Static download() method"]:::core
    FD -->|uses| CF["ContentFetcher\n(FS + HTTP)"]:::module
    FD -->|uses| PE["PreprocessorEvaluator\n(!#if, !#include)"]:::module
    PE -->|uses| CE["ConditionalEvaluator\n(boolean expr)"]:::module
```

| Class | Responsibility |
|-------|---------------|
| **FilterDownloader** | Downloads from URLs or local files; supports retries, circuit breaker, exponential backoff. |
| **ContentFetcher** | Abstraction over `Deno.readTextFile` and `fetch()` with DI interfaces (`IFileSystem`, `IHttpClient`). |
| **PreprocessorEvaluator** | Processes `!#if`, `!#else`, `!#endif`, `!#include`, `!#safari_cb_affinity` directives. |
| **ConditionalEvaluator** | Evaluates boolean expressions with platform identifiers (e.g., `windows && !android`). |

### Configuration & Validation

**`src/configuration/`** — Runtime validation:

| Component | Description |
|-----------|-------------|
| `ConfigurationValidator` | Validates `IConfiguration` against Zod schemas; produces human-readable errors. |
| `schemas.ts` | Zod schemas for `IConfiguration`, `ISource`, `CompileRequest`, `BatchRequest`, HTTP options. |

**`src/config/`** — Centralized constants:

| Constant Group | Examples |
|---------------|----------|
| `NETWORK_DEFAULTS` | Timeout (30s), max retries (3), circuit breaker threshold (5) |
| `WORKER_DEFAULTS` | Rate limit (10 req/60s), cache TTL (1h), max batch size (10) |
| `STORAGE_DEFAULTS` | Cache TTL (1h), max memory entries (100) |
| `COMPILATION_DEFAULTS` | Default source type (`adblock`), max concurrent downloads (10) |
| `VALIDATION_DEFAULTS` | Max rule length (10K chars) |
| `PREPROCESSOR_DEFAULTS` | Max include depth (10) |

### Storage (`src/storage/`)

Pluggable persistence layer with multiple backends.

```mermaid
flowchart TD
    classDef interface fill:#1a237e,stroke:#0d1257,color:#fff
    classDef adapter fill:#1b5e20,stroke:#0a3010,color:#fff
    classDef consumer fill:#b8860b,stroke:#8a6208,color:#fff
    classDef infra fill:#1a237e,stroke:#0d1257,color:#fff

    ISA["IStorageAdapter\n← Abstract interface"]:::interface
    ISA --> PSA["PrismaStorageAdapter\n(SQLite · PostgreSQL · MySQL)"]:::adapter
    ISA --> D1A["D1StorageAdapter\n(Cloudflare D1 edge SQLite)"]:::adapter
    ISA --> HDA["HyperdriveStorageAdapter\n(PostgreSQL via Hyperdrive)"]:::adapter
    CD["CachingDownloader"]:::consumer -->|uses| ISA
    SHM["SourceHealthMonitor"]:::consumer -->|uses| ISA
    CD -->|uses| CHD["ChangeDetector"]:::consumer

    subgraph BACKEND["Physical Backends"]
        SQLITE["SQLite\n(local dev)"]:::infra
        D1DB["Cloudflare D1\n(edge)"]:::infra
        PGDB["PostgreSQL\n(via Hyperdrive)"]:::infra
    end

    PSA --> SQLITE
    D1A --> D1DB
    HDA --> PGDB
```

| Component | Description |
|-----------|-------------|
| **IStorageAdapter** | Interface with hierarchical key-value ops, TTL support, filter list caching, compilation history. |
| **PrismaStorageAdapter** | Prisma ORM backend: SQLite (default), PostgreSQL, MySQL, MongoDB, etc. |
| **D1StorageAdapter** | Cloudflare D1 (edge SQLite) backend. |
| **HyperdriveStorageAdapter** | PostgreSQL backend via Cloudflare Hyperdrive connection pooling. |
| **CachingDownloader** | Wraps any `IDownloader` with caching, change detection, and health monitoring. |
| **ChangeDetector** | Tracks content hashes to detect changes between compilations. |
| **SourceHealthMonitor** | Tracks fetch success/failure rates, latency, and health status per source. |

### Services (`src/services/`)

Higher-level business services.

| Service | Responsibility |
|---------|---------------|
| **FilterService** | Downloads exclusion/inclusion sources in parallel; prepares `Wildcard` patterns. |
| **ASTViewerService** | Parses adblock rules into structured AST using `@adguard/agtree`; provides category, type, syntax, properties. |
| **AnalyticsService** | Type-safe wrapper for Cloudflare Analytics Engine; tracks compilations, cache hits, rate limits, workflow events. |
| **PipelineService** | Orchestrates the full compilation pipeline as a reusable service; used by Worker handlers for consistent pipeline execution. Callers are responsible for Zod-validating inputs via `CompileRequest` / `BatchRequest` schemas before passing to the service. |

### Queue (`src/queue/`)

Asynchronous job processing abstraction.

```mermaid
flowchart TD
    classDef interface fill:#1a237e,stroke:#0d1257,color:#fff
    classDef provider fill:#1b5e20,stroke:#0a3010,color:#fff
    classDef message fill:#b8860b,stroke:#8a6208,color:#fff

    IQP["IQueueProvider\n← Abstract interface"]:::interface
    IQP --> CQP["CloudflareQueueProvider\n← Cloudflare Workers Queue binding"]:::provider
    CQP --> CM["CompileMessage\n(type: 'compile')"]:::message
    CQP --> BCM["BatchCompileMessage\n(type: 'batch-compile')"]:::message
    CQP --> CWM["CacheWarmMessage\n(type: 'cache-warm')"]:::message
    CQP --> HCM["HealthCheckMessage\n(type: 'health-check')"]:::message
```

### Diagnostics & Tracing (`src/diagnostics/`)

End-to-end observability through the compilation pipeline.

```mermaid
flowchart LR
    classDef core fill:#b8860b,stroke:#8a6208,color:#fff
    classDef module fill:#1b5e20,stroke:#0a3010,color:#fff
    classDef observability fill:#b84000,stroke:#7a2900,color:#fff
    TC["TracingContext\n(correlation ID, parent spans)"]:::core
    DC["DiagnosticsCollector\n(event aggregation)"]:::core
    OTE["OpenTelemetryExporter\n(Datadog, Honeycomb, Jaeger, etc.)"]:::observability
    TC --> DC
    DC -->|can export to| OTE
```

| Component | Description |
|-----------|-------------|
| **TracingContext** | Carries correlation ID, parent span, metadata through the pipeline. |
| **DiagnosticsCollector** | Records operation start/end, network events, cache events, performance metrics. |
| **OpenTelemetryExporter** | Bridges to OpenTelemetry's `Tracer` API for distributed tracing integration. |

### Filters (`src/filters/`)

| Component | Description |
|-----------|-------------|
| **RuleFilter** | Applies exclusion/inclusion wildcard patterns to rule sets. Partitions into plain strings (fast) vs. regex/wildcards (slower) for optimized matching. |

### Formatters (`src/formatters/`)

| Component | Description |
|-----------|-------------|
| **OutputFormatter** | Converts adblock rules to multiple output formats: adblock, hosts (`0.0.0.0`), dnsmasq, plain domain list. Extensible via `BaseFormatter`. |

### Diff (`src/diff/`)

| Component | Description |
|-----------|-------------|
| **DiffReport** | Generates rule-level and domain-level diff reports between two compilations. Outputs summary stats (added, removed, unchanged, % change). |

### Plugins (`src/plugins/`)

Extensibility system for custom transformations and downloaders.

```mermaid
flowchart TD
    classDef core fill:#b8860b,stroke:#8a6208,color:#fff
    classDef module fill:#1b5e20,stroke:#0a3010,color:#fff
    PR["PluginRegistry\n← Global singleton"]:::core
    PR -->|registers| P["Plugin\n{manifest, transforms, downloaders}"]:::module
    P --> TPLG["TransformationPlugin"]:::module
    P --> DPLG["DownloaderPlugin"]:::module
```

| Component | Description |
|-----------|-------------|
| **PluginRegistry** | Manages plugin lifecycle: load, init, register transformations, cleanup. |
| **Plugin** | Defines a manifest (name, version, author) + optional transformations and downloaders. |
| **PluginTransformationWrapper** | Wraps a `TransformationPlugin` function as a standard `Transformation` class. |

### Utilities (`src/utils/`)

Shared, reusable components used across all modules.

| Utility | Description |
|---------|-------------|
| **RuleUtils** | Rule classification: `isComment()`, `isAdblockRule()`, `isHostsRule()`, `parseAdblockRule()`, `parseHostsRule()`. |
| **StringUtils** | String manipulation: trimming, splitting, normalization. |
| **TldUtils** | TLD validation and extraction. |
| **Wildcard** | Glob-style pattern matching (`*`, `?`) compiled to regex. |
| **CircuitBreaker** | Three-state circuit breaker (Closed → Open → Half-Open) for fault tolerance. |
| **AsyncRetry** | Retry with exponential backoff and jitter. |
| **ErrorUtils** | Typed error hierarchy: `BaseError`, `CompilationError`, `NetworkError`, `SourceError`, `ValidationError`, `ConfigurationError`, `FileSystemError`. |
| **CompilerEventEmitter** | Type-safe event emission for compilation lifecycle. |
| **BenchmarkCollector** | Performance timing and phase tracking. |
| **BooleanExpressionParser** | Parses `!#if` condition expressions. |
| **AGTreeParser** | Wraps `@adguard/agtree` for rule AST parsing. |
| **ErrorReporter** | Multi-target error reporting (console, Cloudflare, Sentry, composite). |
| **Logger** / **StructuredLogger** | Leveled logging with module-specific overrides and JSON output. |
| **checksum** | Filter list checksum computation. |
| **PathUtils** | Safe path resolution to prevent directory traversal. |

### CLI (`src/cli/`)

Command-line interface for local compilation.

| Component | Description |
|-----------|-------------|
| **CliApp** | Main CLI application; parses args, builds/overlays config, runs `FilterCompiler`, writes output (file, stdout, append). |
| **ArgumentParser** | Parses all CLI flags — transformation control, filtering, output modes, networking, and queue options. Validates via `CliArgumentsSchema`. |
| **ConfigurationLoader** | Loads and parses JSON configuration files. |
| **OutputWriter** | Writes compiled rules to the file system. |

See the [CLI Reference](../usage/CLI.md) for the full flag list and examples.

### Deployment (`src/deployment/`)

| Component | Description |
|-----------|-------------|
| **version.ts** | Tracks deployment history with records (version, build number, git commit, status) stored in D1. |

---

## Cloudflare Worker (`worker/`)

The edge deployment target that exposes the compiler as an HTTP/WebSocket API.

```mermaid
flowchart TD
    classDef entry fill:#b8860b,stroke:#8a6208,color:#fff
    classDef router fill:#1a237e,stroke:#0d1257,color:#fff
    classDef handler fill:#1b5e20,stroke:#0a3010,color:#fff
    classDef middleware fill:#6a1fa0,stroke:#4a1570,color:#fff
    classDef infra fill:#37474f,stroke:#1a2327,color:#fff
    classDef observability fill:#b84000,stroke:#7a2900,color:#fff
    classDef auth fill:#880e4f,stroke:#560930,color:#fff

    REQ["Incoming Request\n(HTTP / WebSocket / Queue / Cron)"]:::entry

    subgraph MW["Middleware Stack"]
        CFAC["CF Access JWT\nverification"]:::auth
        CJW["Clerk JWT\nverification"]:::auth
        RL["Rate Limit\n(tiered by user tier)"]:::middleware
        TS["Turnstile\nCAPTCHA"]:::middleware
        BS["Body Size\nvalidation (1MB)"]:::middleware
        AA["Admin Auth\n(X-Admin-Key)"]:::auth
    end

    subgraph WE["worker.ts — Entry Point"]
        W["worker.ts\nfetch · queue · scheduled · tail"]:::entry
    end

    subgraph RT["router.ts — Orchestrator"]
        R["router.ts\n(thin orchestrator)"]:::router
    end

    subgraph WS_BLOCK["Real-time"]
        WS["websocket.ts\n(WS upgrade)"]:::handler
        SSE["SSE streaming\n(compile/stream)"]:::handler
    end

    subgraph COMP["Compilation Handlers"]
        HC["compile.ts\nhandleCompileJson\nhandleCompileStream\nhandleCompileBatch\nhandleCompileAsync\nhandleCompileBatchAsync\nhandleASTParseRequest"]:::handler
    end

    subgraph QUEUE_BLOCK["Queue & Results"]
        HQ["queue.ts\nhandleQueueStats\nhandleQueueResults"]:::handler
        QC["Queue Consumer\n(async compile jobs)"]:::handler
    end

    subgraph OBS["Observability"]
        HM["metrics.ts\nhandleMetrics (aggregated)\nhandlePrometheusMetrics"]:::observability
        TW["tail.ts\nTail Worker\n(log sink · Sentry · webhooks)"]:::observability
    end

    subgraph AUTH_BLOCK["Auth & API Keys"]
        HAA["auth-admin.ts\ncreateUser · createApiKey\nlistApiKeys · revokeApiKey"]:::auth
        HAK["api-keys.ts\nvalidateApiKey"]:::auth
        HCW["clerk-webhook.ts\nuser lifecycle sync"]:::auth
    end

    subgraph ADMIN_BLOCK["Admin"]
        HA["admin.ts\nD1: stats · query · vacuum\nclear-cache · export"]:::handler
        HPG["pg-admin.ts\nPostgres: stats · query\nexport · clear"]:::handler
        HAH["admin-handlers.ts\nroles · flags · tiers · scopes\nannouncements · audit logs\nendpoint overrides"]:::handler
        HMG["migrate.ts\nD1 → PostgreSQL migration"]:::handler
    end

    subgraph UTILS_BLOCK["Utilities"]
        HVR["validate-rule.ts\nAST rule validation"]:::handler
        HRL["rules.ts\nrule set CRUD"]:::handler
        HUR["url-resolver.ts\nproxy URL fetch"]:::handler
        HSM["source-monitor.ts\nfilter source health"]:::handler
        HML["monitor-latest.ts\nlatest monitor results"]:::handler
        HWH["webhook.ts\noutbound webhooks"]:::handler
    end

    subgraph MCP_BLOCK["MCP / AI"]
        MCP["mcp-agent.ts\nPlaywright MCP\n(CF Browser Rendering)"]:::handler
    end

    REQ --> MW
    MW --> W
    W --> R
    W --> WS
    W --> QC
    W --> TW
    R --> COMP
    R --> QUEUE_BLOCK
    R --> OBS
    R --> AUTH_BLOCK
    R --> ADMIN_BLOCK
    R --> UTILS_BLOCK
    R --> MCP_BLOCK
    HC --> SSE
```

### API Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/compile` | `handleCompileJson` | Synchronous JSON compilation |
| POST | `/api/compile/stream` | `handleCompileStream` | SSE streaming compilation |
| POST | `/api/compile/async` | `handleCompileAsync` | Queue-based async compilation |
| POST | `/api/compile/batch` | `handleCompileBatch` | Batch sync compilation |
| POST | `/api/compile/batch/async` | `handleCompileBatchAsync` | Batch async compilation |
| POST | `/api/ast/parse` | `handleASTParseRequest` | Rule AST parsing |
| GET | `/api/version` | inline | Version info |
| GET | `/api/health` | inline | Health check |
| GET | `/api/metrics` | `handleMetrics` | Aggregated metrics |
| GET | `/api/queue/stats` | `handleQueueStats` | Queue statistics |
| GET | `/api/queue/results/:id` | `handleQueueResults` | Async job results |
| GET | `/ws` | `handleWebSocketUpgrade` | WebSocket compilation |

### Admin Endpoints (require `X-Admin-Key`)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/admin/storage/stats` | D1 storage statistics |
| POST | `/api/admin/storage/query` | Raw SQL query |
| POST | `/api/admin/storage/clear-cache` | Clear cached data |
| POST | `/api/admin/storage/clear-expired` | Clean expired entries |
| GET | `/api/admin/storage/export` | Export all data |
| POST | `/api/admin/storage/vacuum` | Optimize database |
| GET | `/api/admin/storage/tables` | List D1 tables |

### Middleware Stack

```mermaid
flowchart LR
    classDef auth fill:#880e4f,stroke:#560930,color:#fff
    classDef security fill:#6a1fa0,stroke:#4a1570,color:#fff
    classDef infra fill:#37474f,stroke:#1a2327,color:#fff
    classDef handler fill:#1b5e20,stroke:#0a3010,color:#fff

    REQ["Request"]:::infra
    CFAC["CF Access JWT\n(Zero Trust)"]:::auth
    CJW["Clerk JWT\n(user auth)"]:::auth
    RL["Rate Limit\n(tiered: anon/free/pro/admin)"]:::security
    TS["Turnstile\n(CAPTCHA, public endpoints)"]:::security
    BS["Body Size\n(1MB max)"]:::infra
    AA["Admin Auth\n(X-Admin-Key, admin routes)"]:::auth
    H["Handler"]:::handler
    RESP["Response"]:::infra

    REQ --> CFAC
    CFAC --> CJW
    CJW --> RL
    RL --> TS
    TS --> BS
    BS --> AA
    AA --> H
    H --> RESP
```

| Middleware | Description |
|-----------|-------------|
| `verifyCfAccessJwt` | Validates Cloudflare Access JWT for zero-trust perimeter |
| `verifyClerkJwt` | Validates Clerk-issued JWT; extracts user tier and ID |
| `checkRateLimitTiered` | Tiered KV sliding-window: anonymous 10/60s · free 60/60s · pro 300/60s · admin unlimited |
| `verifyTurnstileToken` | Cloudflare Turnstile CAPTCHA verification (public endpoints only) |
| `validateRequestSize` | Prevents DoS via oversized payloads (1MB default) |
| `verifyAdminAuth` | API key header (`X-Admin-Key`) for admin-scoped endpoints |

### Durable Workflows

Long-running, crash-resistant compilation pipelines using Cloudflare Workflows:

| Workflow | Description |
|----------|-------------|
| **CompilationWorkflow** | Full compilation with step-by-step checkpointing: validate → fetch → transform → header → cache. |
| **BatchCompilationWorkflow** | Processes multiple compilations with progress tracking. |
| **CacheWarmingWorkflow** | Pre-compiles popular configurations to warm the cache. |
| **HealthMonitoringWorkflow** | Periodically checks source availability and health. |

### Environment Bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `COMPILATION_CACHE` | KV | Compiled rule caching |
| `RATE_LIMIT` | KV | Per-IP rate limit tracking |
| `METRICS` | KV | Endpoint metrics aggregation |
| `ADBLOCK_COMPILER_QUEUE` | Queue | Standard priority async jobs |
| `ADBLOCK_COMPILER_QUEUE_HIGH_PRIORITY` | Queue | High priority async jobs |
| `DB` | D1 | SQLite storage (admin, metadata) |
| `ANALYTICS_ENGINE` | Analytics Engine | Metrics & analytics |
| `ASSETS` | Fetcher | Static web UI assets |

---

## Angular Frontend (`frontend/`)

A full **Angular 21** Single-Page Application with Server-Side Rendering (SSR), deployed to Cloudflare Pages via `wrangler.toml`.

| Technology | Detail |
|-----------|--------|
| Framework | Angular 21 with Signals + Zoneless Change Detection |
| Rendering | SSR (`main.server.ts`) + hydration |
| PWA | `@angular/service-worker` (`ngsw-config.json`) |
| Styling | PostCSS + TailwindCSS (`postcssrc.json`) |
| E2E Tests | Playwright (`e2e/`) |
| Unit Tests | Vitest (`vitest.config.ts`) |
| Deploy | Cloudflare Pages (`wrangler.toml`) |

See [`frontend/ANGULAR_SIGNALS.md`](../../frontend/ANGULAR_SIGNALS.md) for Angular Signals patterns used in this app.

> **Zero Trust:** All authenticated routes in the Angular app are protected by `CanActivateFn` route guards (Clerk Angular SDK) on the frontend and `verifyCfAccessJwt` / `verifyClerkJwt` middleware on the Worker API. Unauthenticated users are redirected before they can access protected views.

> **Note:** The legacy static `public/` directory (plain HTML/CSS/JS) still exists for backwards-compatible API testing pages and the WebSocket test client.

---

## Cross-Cutting Concerns

### Error Handling

```mermaid
flowchart TD
    classDef base fill:#1a237e,stroke:#0d1257,color:#fff
    classDef error fill:#c62828,stroke:#8e1c1c,color:#fff
    BE["BaseError (abstract)"]:::base
    BE --> CE["CompilationError\n— Compilation pipeline failures"]:::error
    BE --> NE["NetworkError\n— HTTP/connection failures"]:::error
    BE --> SE["SourceError\n— Source download/parse failures"]:::error
    BE --> VE["ValidationError\n— Configuration/rule validation failures"]:::error
    BE --> CFE["ConfigurationError\n— Invalid configuration"]:::error
    BE --> FSE["FileSystemError\n— File system operation failures"]:::error
```

Each error carries: `code` (ErrorCode enum), `cause` (original error), `timestamp` (ISO string).

### Event System

The `ICompilerEvents` interface provides lifecycle hooks:

```mermaid
flowchart TD
    classDef event fill:#b8860b,stroke:#8a6208,color:#fff
    classDef hook fill:#1b5e20,stroke:#0a3010,color:#fff
    CS["Compilation Start"]:::event
    CS --> OSS["onSourceStart\n(per source)"]:::hook
    CS --> OSC["onSourceComplete\n(per source, with rule count & duration)"]:::hook
    CS --> OSE["onSourceError\n(per source, with error)"]:::hook
    CS --> OTS["onTransformationStart\n(per transformation)"]:::hook
    CS --> OTC["onTransformationComplete\n(per transformation, with counts)"]:::hook
    CS --> OP["onProgress\n(phase, current/total, message)"]:::hook
    CS --> OCC["onCompilationComplete\n(total rules, duration, counts)"]:::hook
```

### Logging

Two logger implementations:

| Logger | Use Case |
|--------|----------|
| `Logger` | Console-based, leveled (trace → error), with optional prefix |
| `StructuredLogger` | JSON output for log aggregation (CloudWatch, Datadog, Splunk) |

Both implement `ILogger` (extends `IDetailedLogger`): `info()`, `warn()`, `error()`, `debug()`, `trace()`.

### Resilience Patterns

| Pattern | Implementation | Used By |
|---------|---------------|---------|
| Circuit Breaker | `CircuitBreaker.ts` (Closed → Open → Half-Open) | `FilterDownloader` |
| Retry with Backoff | `AsyncRetry.ts` (exponential + jitter) | `FilterDownloader` |
| Rate Limiting | KV-backed sliding window | Worker middleware |
| Request Deduplication | In-memory `Map<key, Promise>` | Worker compile handler |

---

## Data Flow Diagrams

### CLI Compilation Flow

```mermaid
flowchart LR
    classDef input fill:#1b5e20,stroke:#0a3010,color:#fff
    classDef core fill:#b8860b,stroke:#8a6208,color:#fff
    classDef output fill:#1a237e,stroke:#0d1257,color:#fff
    CFG["config.json"]:::input --> CL["ConfigurationLoader"]:::core
    FS["Filter Sources\n(HTTP/FS)"]:::input --> FC
    CL --> FC["FilterCompiler"]:::core
    FC --> SC["SourceCompiler\n(per src)"]:::core
    FC --> TP["TransformationPipeline"]:::core
    FC --> OUT["output.txt"]:::output
```

### Worker API Flow (SSE Streaming)

```mermaid
sequenceDiagram
    box Client
        participant Client
    end
    box Worker
        participant Worker
    end
    box Sources
        participant Sources
    end

    Client->>Worker: POST /api/compile/stream
    Worker->>Sources: Pre-fetch content
    Sources-->>Worker: content
    Note over Worker: WorkerCompiler.compile()
    Worker-->>Client: SSE: event: log
    Worker-->>Client: SSE: event: source-start
    Worker-->>Client: SSE: event: source-complete
    Worker-->>Client: SSE: event: progress
    Note over Worker: Cache result in KV
    Worker-->>Client: SSE: event: complete
```

### Async Queue Flow

```mermaid
sequenceDiagram
    box Client
        participant Client
    end
    box Worker
        participant Worker
    end
    box Queue
        participant Queue
    end
    box Consumer
        participant Consumer
    end

    Client->>Worker: POST /compile/async
    Worker->>Queue: enqueue message
    Worker-->>Client: 202 {requestId}
    Queue->>Consumer: dequeue
    Consumer->>Consumer: compile
    Consumer->>Queue: store result
    Client->>Worker: GET /queue/results/:id
    Worker->>Queue: fetch result
    Worker-->>Client: 200 {rules}
```

---

## Deployment Architecture

```mermaid
flowchart TD
    classDef client fill:#1b5e20,stroke:#0a3010,color:#fff
    classDef edge fill:#b8860b,stroke:#8a6208,color:#fff
    classDef worker fill:#1a237e,stroke:#0d1257,color:#fff
    classDef storage fill:#6a1fa0,stroke:#4a1570,color:#fff
    classDef observability fill:#b84000,stroke:#7a2900,color:#fff
    classDef auth fill:#880e4f,stroke:#560930,color:#fff
    classDef external fill:#37474f,stroke:#1a2327,color:#fff

    subgraph CLIENTS["Clients"]
        BROWSER["Browser\n(Angular 21 SSR/PWA)"]:::client
        CICD["CI/CD Systems\n(GitHub Actions)"]:::client
        CLIUSER["CLI User\n(Deno)"]:::client
        AICLIENT["AI Agent\n(MCP Client)"]:::client
    end

    subgraph CFN["Cloudflare Edge Network"]
        CFAC["Cloudflare Access\n(Zero Trust WAF)"]:::auth
        CFPAGES["Cloudflare Pages\n(Angular SSR)"]:::edge

        subgraph CW["Cloudflare Worker — adblock-compiler"]
            ROUTER["router.ts\n(HTTP/WS routing)"]:::worker
            WSHANDLER["WebSocket Handler\n(websocket.ts)"]:::worker
            QCONSUMER["Queue Consumer\n(async compile)"]:::worker
            DWF["Durable Workflows\n(long-running compile)"]:::worker
            MCPAGENT["MCP Agent\n(mcp-agent.ts)"]:::worker
            TAILWORKER["Tail Worker\n(tail.ts)"]:::observability
        end

        subgraph CFSTORAGE["Cloudflare Storage"]
            KV["KV Store\nCache · Rate Limits · Metrics"]:::storage
            D1["D1 (SQLite)\nMetadata · Auth · History"]:::storage
            CQUEUES["Queues\nStd + High Priority"]:::storage
            AEG["Analytics Engine"]:::observability
        end

        HD["Hyperdrive\n(PostgreSQL Proxy)"]:::edge
        BR["Browser Rendering\n(Playwright)"]:::edge
    end

    subgraph EXTERNAL["External Services"]
        FLS["Filter List Sources\n(EasyList · uBlock · AdGuard)"]:::external
        CLERK["Clerk\n(Auth & User Mgmt)"]:::auth
        SENTRY["Sentry\n(Error Tracking)"]:::observability
        PGDB["PostgreSQL\n(production DB)"]:::storage
        PROM["Prometheus / Grafana\n(metrics scraping)"]:::observability
    end

    BROWSER -->|HTTPS| CFAC
    CICD -->|HTTPS| CFAC
    AICLIENT -->|SSE /agents/mcp| MCPAGENT
    CLIUSER -->|local exec| CLIUSER
    CFAC --> CFPAGES
    CFAC --> ROUTER
    CFPAGES -->|API calls| ROUTER
    ROUTER --> WSHANDLER
    ROUTER --> DWF
    ROUTER --> QCONSUMER
    ROUTER -->|fetch sources| FLS
    ROUTER --> KV
    ROUTER --> D1
    ROUTER --> CLERK
    ROUTER --> SENTRY
    ROUTER --> PROM
    QCONSUMER --> CQUEUES
    MCPAGENT --> BR
    TAILWORKER -->|log sink| SENTRY
    HD --> PGDB
    ROUTER --> HD
    DWF --> KV
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Deno 2.x |
| **Language** | TypeScript 5.9 (strict mode) |
| **Package Registry** | JSR (`@jk-com/adblock-compiler`) |
| **Edge Runtime** | Cloudflare Workers |
| **Validation** | Zod 4 |
| **Rule Parsing** | `@adguard/agtree` |
| **ORM** | Prisma 7 (optional, for local storage) |
| **Database** | SQLite (local), Cloudflare D1 (edge), PostgreSQL (via Hyperdrive) |
| **Caching** | Cloudflare KV |
| **Queue** | Cloudflare Queues |
| **Analytics** | Cloudflare Analytics Engine |
| **Observability** | OpenTelemetry (optional), DiagnosticsCollector, Sentry, Prometheus |
| **Auth** | Clerk (users + JWTs), Cloudflare Access (ZTA), API Keys |
| **Frontend** | Angular 21 (SSR + PWA + Signals + Zoneless), PostCSS, TailwindCSS |
| **AI / MCP** | `@cloudflare/playwright-mcp`, Cloudflare Browser Rendering |
| **CI/CD** | GitHub Actions |
| **Containerization** | Docker + Docker Compose |
| **Formatting** | Deno built-in formatter |
| **Testing** | Deno built-in test framework + `@std/assert`, Vitest 4 (frontend) |

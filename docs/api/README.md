# Adblock Compiler API

**Version:** 2.0.0

## Description

**Compiler-as-a-Service** for adblock filter lists. Transform, optimize, and combine filter lists from multiple sources with real-time progress tracking.

## Features
- 🎯 Multi-Source Compilation
- ⚡ Performance (Gzip compression, caching, request deduplication)
- 🔄 Circuit Breaker with retry logic
- 📊 Visual Diff between compilations
- 📡 Real-time progress via SSE and WebSocket
- 🎪 Batch Processing
- 🌍 Universal (Deno, Node.js, Cloudflare Workers, browsers)

## Links
- [GitHub Repository](https://github.com/jaypatrick/adblock-compiler)
- [Documentation](https://github.com/jaypatrick/adblock-compiler/tree/master/docs)
- [Web UI](https://adblock-compiler.jk-com.workers.dev/)


## Servers

- **Production server**: `https://adblock-compiler.jk-com.workers.dev`
- **Local development server**: `http://localhost:8787`

## Endpoints

### Metrics

#### `GET /api`

**Summary:** Get API information

Returns API version, available endpoints, and usage examples

**Operation ID:** `getApiInfo`

**Responses:**

- `200`: API information

---

#### `GET /metrics`

**Summary:** Get performance metrics

Returns aggregated metrics for the last 30 minutes

**Operation ID:** `getMetrics`

**Responses:**

- `200`: Performance metrics

---

#### `GET /api/version`

**Summary:** Get latest deployment version

Returns the current version from deployment history

**Operation ID:** `getApiVersion`

**Responses:**

- `200`: Version information
- `503`: No description

---

#### `GET /api/deployments`

**Summary:** Get deployment history

Returns deployment history records

**Operation ID:** `getDeployments`

**Parameters:**

- `limit` (query): Maximum number of records to return
- `version` (query): Filter by version
- `status` (query): Filter by deployment status
- `branch` (query): Filter by branch name

**Responses:**

- `200`: Deployment history
- `503`: No description

---

#### `GET /api/deployments/stats`

**Summary:** Get deployment statistics

Returns aggregated deployment statistics

**Operation ID:** `getDeploymentStats`

**Responses:**

- `200`: Deployment statistics
- `503`: No description

---

#### `GET /api/turnstile-config`

**Summary:** Get Turnstile configuration

Returns the Cloudflare Turnstile site key and whether it is enabled

**Operation ID:** `getTurnstileConfig`

**Responses:**

- `200`: Turnstile configuration

---

### Info

#### `GET /api/schemas`

**Summary:** Get JSON Schemas for all public request/response types

Returns JSON Schema representations of all public Zod schemas
(ConfigurationSchema, CompileRequestSchema, SourceSchema, BenchmarkMetricsSchema)
for use by API testers and external tooling.
Anonymous access. Cached for 1 hour.


**Operation ID:** `getApiSchemas`

**Responses:**

- `200`: JSON Schema definitions.
- `429`: No description

---

### Compilation

#### `POST /compile`

**Summary:** Compile filter list (JSON)

Compile filter lists and return results as JSON. Results are cached for 1 hour.
Supports request deduplication for concurrent identical requests.


**Operation ID:** `compileJson`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`CompileRequest`](#compilerequest)

**Responses:**

- `200`: Compilation successful
- `400`: No description
- `429`: No description
- `500`: No description

---

#### `POST /compile/batch`

**Summary:** Batch compile multiple lists

Compile multiple filter lists in parallel (max 10 per batch)

**Operation ID:** `compileBatch`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`BatchCompileRequest`](#batchcompilerequest)

**Responses:**

- `200`: Batch compilation results
- `400`: No description
- `429`: No description

---

#### `POST /ast/parse`

**Summary:** Parse filter rules into AST

Parses adblock filter rules into an Abstract Syntax Tree representation

**Operation ID:** `parseAST`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`ASTParseRequest`](#astparserequest)

**Responses:**

- `200`: Parsed AST
- `400`: Invalid request (must provide rules or text)
- `500`: Parse error

---

### Streaming

#### `POST /compile/stream`

**Summary:** Compile with real-time progress (SSE)

Compile filter lists with real-time progress updates via Server-Sent Events.
Streams events including source downloads, transformations, diagnostics, cache operations, network events, and metrics.


**Operation ID:** `compileStream`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`CompileRequest`](#compilerequest)

**Responses:**

- `200`: Event stream
- `400`: No description
- `429`: No description

---

### Queue

#### `POST /compile/async`

**Summary:** Queue async compilation job

Queue a compilation job for asynchronous processing. Returns immediately with a request ID.
Use GET /queue/results/{requestId} to retrieve results when complete.


**Operation ID:** `compileAsync`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`CompileRequest`](#compilerequest)

**Responses:**

- `202`: Job queued successfully
- `400`: No description
- `500`: No description

---

#### `POST /compile/batch/async`

**Summary:** Queue batch async compilation

Queue multiple compilations for async processing

**Operation ID:** `compileBatchAsync`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`BatchCompileRequest`](#batchcompilerequest)

**Responses:**

- `202`: Batch queued successfully
- `400`: No description
- `500`: No description

---

#### `GET /queue/stats`

**Summary:** Get queue statistics

Returns queue health metrics and job statistics

**Operation ID:** `getQueueStats`

**Responses:**

- `200`: Queue statistics

---

#### `GET /queue/results/{requestId}`

**Summary:** Get async job results

Retrieve results for a completed async compilation job

**Operation ID:** `getQueueResults`

**Parameters:**

- `requestId` (path) (required): Request ID returned from async endpoints

**Responses:**

- `200`: Job results
- `404`: Job not found

---

#### `GET /queue/history`

**Summary:** Get queue job history

Returns job history and queue depth over time

**Operation ID:** `getQueueHistory`

**Responses:**

- `200`: Queue history

---

#### `DELETE /queue/cancel/{requestId}`

**Summary:** Cancel a pending queue job

Cancels a pending queue job by its requestId.
Returns 409 if the job is already completed, failed, or cancelled.
Requires authentication (free tier or above).


**Operation ID:** `cancelQueueJob`

**Parameters:**

- `requestId` (path) (required): The requestId of the queue job to cancel.

**Responses:**

- `200`: Job cancelled successfully.
- `400`: No description
- `401`: No description
- `403`: Cloudflare Access JWT invalid or missing.
- `429`: No description

---

### WebSocket

#### `GET /ws/compile`

**Summary:** WebSocket endpoint for real-time compilation

Bidirectional WebSocket connection for real-time compilation with event streaming.

**Client → Server Messages:**
- `compile` - Start compilation
- `cancel` - Cancel running compilation
- `ping` - Heartbeat ping

**Server → Client Messages:**
- `welcome` - Connection established
- `pong` - Heartbeat response
- `compile:started` - Compilation started
- `event` - Compilation event (source, transformation, progress, diagnostic, cache, network, metric)
- `compile:complete` - Compilation finished successfully
- `compile:error` - Compilation failed
- `compile:cancelled` - Compilation cancelled
- `error` - Error message

**Features:**
- Up to 3 concurrent compilations per connection
- Automatic heartbeat (30s interval)
- Connection timeout (5 minutes idle)
- Session-based compilation tracking
- Cancellation support


**Operation ID:** `websocketCompile`

**Responses:**

- `101`: WebSocket connection established
- `426`: Upgrade required (not a WebSocket request)

---

### Configuration

#### `GET /configuration/defaults`

**Summary:** Get system compilation defaults and limits

Returns the system defaults and hard limits that apply to every compilation.
No authentication required (anonymous tier).


**Operation ID:** `getConfigurationDefaults`

**Responses:**

- `200`: Defaults and limits.
- `429`: No description

---

#### `POST /configuration/validate`

**Summary:** Validate a configuration object against the schema

Validates a configuration object against the Zod `ConfigurationSchema`.
Requires a Cloudflare Turnstile token when `TURNSTILE_SECRET_KEY` is configured.


**Operation ID:** `validateConfiguration`

**Request Body:**

- Content-Type: `application/json`

**Responses:**

- `200`: Validation result.
- `400`: No description
- `403`: Turnstile verification failed.
- `429`: No description

---

#### `POST /configuration/resolve`

**Summary:** Merge configuration layers and return effective IConfiguration

Merges one or more configuration layers (base config + optional override) and
returns the effective `IConfiguration`. Useful for previewing the result of a
config + environment overlay before submitting a compile job.
Requires a Cloudflare Turnstile token when `TURNSTILE_SECRET_KEY` is configured.


**Operation ID:** `resolveConfiguration`

**Request Body:**

- Content-Type: `application/json`

**Responses:**

- `200`: Resolved configuration.
- `400`: No description
- `403`: Turnstile verification failed.
- `429`: No description

---

### Admin

#### `GET /admin/storage/stats`

**Summary:** Get storage statistics

Returns database table counts and expired entry counts

**Operation ID:** `getAdminStorageStats`

**Responses:**

- `200`: Storage statistics
- `401`: No description
- `503`: No description

---

#### `POST /admin/storage/clear-expired`

**Summary:** Clear expired entries

Deletes all expired entries from storage tables

**Operation ID:** `clearExpiredEntries`

**Responses:**

- `200`: Entries cleared
- `401`: No description
- `503`: No description

---

#### `POST /admin/storage/clear-cache`

**Summary:** Clear cache entries

Deletes all cache entries from storage tables

**Operation ID:** `clearCacheEntries`

**Responses:**

- `200`: Cache cleared
- `401`: No description
- `503`: No description

---

#### `GET /admin/storage/export`

**Summary:** Export storage data

Exports storage entries as JSON (includes storage entries, filter cache, and compilation metadata; returned amounts subject to implementation limits)

**Operation ID:** `exportStorage`

**Responses:**

- `200`: Storage export
- `401`: No description
- `503`: No description

---

#### `POST /admin/storage/vacuum`

**Summary:** Vacuum database

Runs VACUUM on the D1 database to reclaim space

**Operation ID:** `vacuumDatabase`

**Responses:**

- `200`: Vacuum completed
- `401`: No description
- `503`: No description

---

#### `GET /admin/storage/tables`

**Summary:** List database tables

Returns all tables and indexes in the D1 database

**Operation ID:** `listStorageTables`

**Responses:**

- `200`: Table listing
- `401`: No description
- `503`: No description

---

#### `POST /admin/storage/query`

**Summary:** Execute read-only SQL query

Executes a SELECT-only SQL query against the D1 database for debugging

**Operation ID:** `queryStorage`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`AdminQueryRequest`](#adminqueryrequest)

**Responses:**

- `200`: Query results
- `400`: Invalid or disallowed SQL
- `401`: No description
- `503`: No description

---

#### `POST /admin/auth/users`

**Summary:** Create user

Creates a new user account. Requires Hyperdrive (PostgreSQL) binding.

**Operation ID:** `createUser`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`CreateUserRequest`](#createuserrequest)

**Responses:**

- `201`: User created
- `400`: No description
- `401`: No description
- `409`: User with this email already exists
- `503`: No description

---

#### `GET /admin/auth/api-keys`

**Summary:** List API keys

Lists API keys for a user (without key hashes). Requires Hyperdrive (PostgreSQL) binding.

**Operation ID:** `listApiKeys`

**Parameters:**

- `userId` (query) (required): User ID to list API keys for

**Responses:**

- `200`: List of API keys
- `400`: No description
- `401`: No description
- `503`: No description

---

#### `POST /admin/auth/api-keys`

**Summary:** Create API key

Creates a new API key for a user. Requires Hyperdrive (PostgreSQL) binding.

**Important:** The raw API key is only returned once. Store it securely.


**Operation ID:** `createApiKey`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`CreateApiKeyRequest`](#createapikeyrequest)

**Responses:**

- `201`: API key created
- `400`: No description
- `401`: No description
- `404`: User not found
- `503`: No description

---

#### `POST /admin/auth/api-keys/revoke`

**Summary:** Revoke API key

Revokes an API key by ID or key prefix. Requires Hyperdrive (PostgreSQL) binding.

**Operation ID:** `revokeApiKey`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`RevokeApiKeyRequest`](#revokeapikeyrequest)

**Responses:**

- `200`: API key revoked
- `400`: No description
- `401`: No description
- `404`: API key not found or already revoked
- `503`: No description

---

#### `POST /admin/auth/api-keys/validate`

**Summary:** Validate API key

Validates an API key without authenticating a full request. Useful for the admin UI to test keys.

**Operation ID:** `validateApiKey`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`ValidateApiKeyRequest`](#validateapikeyrequest)

**Responses:**

- `200`: Validation result
- `400`: No description
- `401`: No description
- `503`: No description

---

#### `POST /admin/migrate/d1-to-pg`

**Summary:** Migrate D1 data to PostgreSQL

One-time migration that reads data from Cloudflare D1 (SQLite) and writes it to PostgreSQL via Hyperdrive.

Migrates the following tables: `storage_entries`, `filter_cache`, `compilation_metadata`.

The migration is:
- **Idempotent**: uses ON CONFLICT DO NOTHING to skip existing rows
- **Batched**: processes rows in chunks of 100
- **Read-only on D1**: never modifies the source database
- **Resumable**: can be re-run safely if interrupted


**Operation ID:** `migrateD1ToPg`

**Parameters:**

- `dryRun` (query): Count rows without writing (dry run)
- `tables` (query): Comma-separated list of tables to migrate (default: all)

**Responses:**

- `200`: Migration result
- `400`: No description
- `401`: No description
- `503`: No description

---

#### `GET /admin/backends`

**Summary:** Backend health status

Returns health and connectivity status of both D1 and PostgreSQL backends

**Operation ID:** `getBackendStatus`

**Responses:**

- `200`: Backend status
- `401`: No description

---

#### `GET /admin/pg/stats`

**Summary:** PostgreSQL storage statistics

Returns storage statistics from the PostgreSQL backend (mirrors /admin/storage/stats for D1)

**Operation ID:** `getPgStorageStats`

**Responses:**

- `200`: PostgreSQL storage statistics
- `401`: No description
- `503`: No description

---

#### `GET /admin/pg/export`

**Summary:** Export PostgreSQL data

Exports data from the PostgreSQL backend (mirrors /admin/storage/export for D1)

**Operation ID:** `exportPgData`

**Responses:**

- `200`: PostgreSQL data export
- `401`: No description
- `503`: No description

---

#### `POST /admin/pg/clear-expired`

**Summary:** Clear expired PostgreSQL entries

Deletes all expired entries from PostgreSQL storage and cache tables

**Operation ID:** `clearPgExpiredEntries`

**Responses:**

- `200`: Entries cleared
- `401`: No description
- `503`: No description

---

#### `POST /admin/pg/clear-cache`

**Summary:** Clear PostgreSQL cache

Deletes all cache entries from PostgreSQL tables

**Operation ID:** `clearPgCache`

**Responses:**

- `200`: Cache cleared
- `401`: No description
- `503`: No description

---

#### `POST /admin/pg/query`

**Summary:** Execute read-only PostgreSQL query

Executes a SELECT-only SQL query against PostgreSQL for debugging (mirrors /admin/storage/query for D1)

**Operation ID:** `queryPg`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`AdminQueryRequest`](#adminqueryrequest)

**Responses:**

- `200`: Query results
- `400`: Invalid or disallowed SQL
- `401`: No description
- `503`: No description

---

#### `GET /admin/local-users`

**Summary:** List local auth users

Returns a paginated list of all local auth users.
Responses never include `password_hash`.
Requires Admin tier + admin role.


**Operation ID:** `adminListLocalUsers`

**Parameters:**

- `limit` (query): Maximum number of users to return
- `offset` (query): Number of users to skip (for pagination)

**Responses:**

- `200`: Paginated user list
- `401`: No description
- `403`: No description
- `503`: No description

---

#### `POST /admin/local-users`

**Summary:** Create a local auth user

Create a new local auth user with any valid role and tier.
Admins can create users with privileged roles (e.g. `admin`) that cannot be self-registered.
Requires Admin tier + admin role.


**Operation ID:** `adminCreateLocalUser`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`AdminCreateLocalUserRequest`](#admincreatelocaluserrequest)

**Responses:**

- `201`: User created
- `400`: No description
- `401`: No description
- `403`: No description
- `409`: An account with this identifier already exists
- `503`: No description

---

#### `GET /admin/local-users/{userId}`

**Summary:** Get a local auth user

Returns the public profile of a single local auth user by UUID.
Requires Admin tier + admin role.


**Operation ID:** `adminGetLocalUser`

**Parameters:**

- `userId` (path) (required): Local auth user UUID

**Responses:**

- `200`: User profile
- `401`: No description
- `403`: No description
- `404`: User not found
- `503`: No description

---

#### `PATCH /admin/local-users/{userId}`

**Summary:** Update a local auth user

Update a user's `tier`, `role`, and/or `api_disabled` flag.
Tier and role are independent fields — changing role does not automatically change tier unless
no explicit tier is provided (in which case the role's default tier is applied).
Requires Admin tier + admin role.


**Operation ID:** `adminUpdateLocalUser`

**Parameters:**

- `userId` (path) (required): Local auth user UUID

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`AdminUpdateLocalUserRequest`](#adminupdatelocaluserrequest)

**Responses:**

- `200`: Updated user profile
- `400`: No description
- `401`: No description
- `403`: No description
- `404`: User not found
- `503`: No description

---

#### `DELETE /admin/local-users/{userId}`

**Summary:** Delete a local auth user

Permanently deletes a local auth user by UUID.
Requires Admin tier + admin role.


**Operation ID:** `adminDeleteLocalUser`

**Parameters:**

- `userId` (path) (required): Local auth user UUID

**Responses:**

- `200`: User deleted
- `401`: No description
- `403`: No description
- `404`: User not found
- `503`: No description

---

#### `GET /admin/auth/config`

**Summary:** Inspect active auth registries

Returns a read-only snapshot of all three extensibility registries at runtime:
- `LOCAL_ROLE_REGISTRY` — all defined roles, their tiers, and self-register flag
- `TIER_REGISTRY` — all tiers with rate limits and ordering
- `ROUTE_PERMISSION_REGISTRY` — all registered route permission rules

Also reports which auth provider is active (`local-jwt` vs `clerk`).
Requires Admin tier + admin role.


**Operation ID:** `adminAuthConfig`

**Responses:**

- `200`: Active auth configuration snapshot
- `401`: No description
- `403`: No description

---

#### `GET /admin/usage/{userId}`

**Summary:** Get per-user API usage statistics

Returns KV-backed API usage counters for a specific user:
- `total` — lifetime request count, first/last seen timestamps
- `days` — per-day breakdown for the requested lookback window (max 90 days)

Requires Admin tier + admin role.


**Operation ID:** `adminGetUserUsage`

**Parameters:**

- `userId` (path) (required): User ID (UUID or Clerk user ID)
- `days` (query): Number of past days to include in the daily breakdown

**Responses:**

- `200`: Per-user usage statistics
- `401`: No description
- `403`: No description

---

### Workflow

#### `POST /workflow/compile`

**Summary:** Start async compilation workflow

Creates a durable Cloudflare Workflow instance for compilation

**Operation ID:** `startWorkflowCompile`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`CompileRequest`](#compilerequest)

**Responses:**

- `202`: Workflow started
- `400`: No description
- `503`: No description

---

#### `POST /workflow/batch`

**Summary:** Start async batch compilation workflow

Creates a durable Cloudflare Workflow instance for batch compilation

**Operation ID:** `startWorkflowBatch`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`BatchCompileRequest`](#batchcompilerequest)

**Responses:**

- `202`: Workflow started
- `400`: No description
- `503`: No description

---

#### `POST /workflow/cache-warm`

**Summary:** Start cache warming workflow

Triggers manual cache warming for specified configurations

**Operation ID:** `startWorkflowCacheWarm`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`CacheWarmRequest`](#cachewarmrequest)

**Responses:**

- `202`: Workflow started
- `400`: No description
- `503`: No description

---

#### `POST /workflow/health-check`

**Summary:** Start health monitoring workflow

Triggers manual health check for specified filter list sources

**Operation ID:** `startWorkflowHealthCheck`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`HealthCheckRequest`](#healthcheckrequest)

**Responses:**

- `202`: Workflow started
- `400`: No description
- `503`: No description

---

#### `GET /workflow/status/{workflowType}/{instanceId}`

**Summary:** Get workflow instance status

Returns the current status and output of a workflow instance

**Operation ID:** `getWorkflowStatus`

**Parameters:**

- `workflowType` (path) (required): Type of workflow
- `instanceId` (path) (required): Workflow instance ID

**Responses:**

- `200`: Workflow status
- `400`: Unknown workflow type
- `404`: Workflow instance not found
- `503`: No description

---

#### `GET /workflow/metrics`

**Summary:** Get workflow metrics

Returns aggregated metrics for all workflow types

**Operation ID:** `getWorkflowMetrics`

**Responses:**

- `200`: Workflow metrics

---

#### `GET /workflow/events/{workflowId}`

**Summary:** Get workflow events

Returns progress events for a specific workflow instance

**Operation ID:** `getWorkflowEvents`

**Parameters:**

- `workflowId` (path) (required): Workflow instance ID
- `since` (query): Return only events after this timestamp

**Responses:**

- `200`: Workflow events

---

### Health

#### `GET /health/latest`

**Summary:** Get latest health check results

Returns the results of the most recent health monitoring workflow run

**Operation ID:** `getLatestHealth`

**Responses:**

- `200`: Latest health check data

---

#### `GET /health`

**Summary:** Basic health check

Returns current service health status and version

**Operation ID:** `getHealth`

**Responses:**

- `200`: Service is healthy

---

### Authentication

#### `GET /api/keys`

**Summary:** List user's API keys

Lists all API keys belonging to the authenticated user.
Returns metadata only — never the key hash or plaintext.
Requires Clerk JWT authentication.


**Operation ID:** `userListApiKeys`

**Responses:**

- `200`: List of API keys
- `401`: No description

---

#### `POST /api/keys`

**Summary:** Create API key

Creates a new API key for the authenticated user.
The raw API key (with `abc_` prefix) is returned **only once** — store it securely.
Requires Clerk JWT authentication.


**Operation ID:** `userCreateApiKey`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`UserCreateApiKeyRequest`](#usercreateapikeyrequest)

**Responses:**

- `201`: API key created
- `400`: No description
- `401`: No description

---

#### `PATCH /api/keys/{keyId}`

**Summary:** Update API key

Updates an API key's name or scopes. Only the key owner can update their own keys.
Requires Clerk JWT authentication.


**Operation ID:** `userUpdateApiKey`

**Parameters:**

- `keyId` (path) (required): ID of the API key to update

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`UserUpdateApiKeyRequest`](#userupdateapikeyrequest)

**Responses:**

- `200`: API key updated
- `400`: No description
- `401`: No description
- `404`: API key not found or already revoked

---

#### `DELETE /api/keys/{keyId}`

**Summary:** Revoke API key

Revokes (soft-deletes) an API key. The key remains in the database for audit
purposes but is no longer valid for authentication.
Only the key owner can revoke their own keys.


**Operation ID:** `userRevokeApiKey`

**Parameters:**

- `keyId` (path) (required): ID of the API key to revoke

**Responses:**

- `200`: API key revoked
- `401`: No description
- `404`: API key not found or already revoked

---

#### `POST /api/webhooks/clerk`

**Summary:** Clerk webhook receiver

Receives Clerk webhook events (user.created, user.updated, user.deleted, session.created).
Verified via Svix webhook signature. This endpoint is called by Clerk's webhook infrastructure
and should not be called directly.


**Operation ID:** `clerkWebhook`

**Parameters:**

- `svix-id` (header) (required): Svix webhook ID
- `svix-timestamp` (header) (required): Svix webhook timestamp
- `svix-signature` (header) (required): Svix webhook signature

**Request Body:**

- Content-Type: `application/json`

**Responses:**

- `200`: Webhook processed successfully
- `400`: Invalid webhook signature or payload
- `401`: Webhook signature verification failed

---

### Browser Rendering

#### `POST /api/browser/resolve-url`

**Summary:** Resolve canonical URL via browser

Navigates to a URL using the Cloudflare Browser Rendering binding and returns the
final canonical URL after all redirects. Useful for discovering the true destination
of redirect chains or URL shorteners before scheduling a filter-list download.

Requires the `BROWSER` binding to be configured in `wrangler.toml`.


**Operation ID:** `browserResolveUrl`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`BrowserResolveRequest`](#browserresolverequest)

**Responses:**

- `200`: Resolved URL
- `400`: Invalid request body
- `502`: Browser navigation failed
- `503`: BROWSER binding not configured

---

#### `POST /api/browser/monitor`

**Summary:** Monitor filter-list sources for reachability

Performs parallel browser-based health checks on a list of filter-list source
URLs. For each URL a headless browser navigates to the page, verifies non-empty
text content, and optionally captures a full-page PNG screenshot stored in R2.

The full result set is persisted under the KV key `browser:monitor:latest`
and is retrievable via `GET /api/browser/monitor/latest`.

Requires the `BROWSER` binding. `FILTER_STORAGE` (R2) is required for
screenshot capture. `COMPILATION_CACHE` (KV) is required for result persistence.


**Operation ID:** `browserMonitor`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`SourceMonitorRequest`](#sourcemonitorrequest)

**Responses:**

- `200`: Per-source reachability results
- `400`: Invalid request body
- `503`: BROWSER binding not configured

---

#### `GET /api/browser/monitor/latest`

**Summary:** Retrieve the latest monitor results

Returns the most recent result set written by `POST /api/browser/monitor`. Reads
the KV key `browser:monitor:latest` from `COMPILATION_CACHE`.

Requires the `COMPILATION_CACHE` binding.


**Operation ID:** `browserMonitorLatest`

**Responses:**

- `200`: Latest monitor results
- `404`: No monitor results available yet
- `503`: COMPILATION_CACHE binding not configured

---

### Rules

#### `POST /validate-rule`

**Summary:** Validate a single adblock rule

Parses and validates a single adblock/DNS rule, returning its AST representation, type, and optional URL match result.

**Operation ID:** `validateRule`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`ValidateRuleRequest`](#validaterulerequest)

**Responses:**

- `200`: Rule validation result
- `400`: Invalid request body

---

### Rule Sets

#### `GET /rules`

**Summary:** List saved rule sets

Returns all saved rule sets stored in the KV namespace.

**Operation ID:** `listRuleSets`

**Responses:**

- `200`: List of rule sets
- `500`: Internal server error

---

#### `POST /rules`

**Summary:** Create a new rule set

Creates and stores a new named rule set in the KV namespace.

**Operation ID:** `createRuleSet`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`RuleSetCreateRequest`](#rulesetcreaterequest)

**Responses:**

- `201`: Rule set created
- `400`: Invalid request body

---

#### `GET /rules/{id}`

**Summary:** Get a rule set by ID

**Operation ID:** `getRuleSet`

**Responses:**

- `200`: Rule set found
- `404`: Rule set not found

---

#### `PUT /rules/{id}`

**Summary:** Update a rule set by ID

**Operation ID:** `updateRuleSet`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`RuleSetUpdateRequest`](#rulesetupdaterequest)

**Responses:**

- `200`: Rule set updated
- `400`: Invalid request body
- `404`: Rule set not found

---

#### `DELETE /rules/{id}`

**Summary:** Delete a rule set by ID

**Operation ID:** `deleteRuleSet`

**Responses:**

- `200`: Rule set deleted
- `404`: Rule set not found

---

### Notifications

#### `POST /notify`

**Summary:** Send a notification event to configured webhook targets

Delivers a notification event (e.g. error, warning, info) to one or more configured targets — generic HTTP webhook (WEBHOOK_URL), Sentry (SENTRY_DSN), and/or Datadog (DATADOG_API_KEY). At least one target must be configured in the worker environment.

**Operation ID:** `notify`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`WebhookNotifyRequest`](#webhooknotifyrequest)

**Responses:**

- `200`: Notification delivered to at least one target
- `400`: Invalid request body
- `502`: All configured notification targets failed to receive the event
- `503`: No notification targets configured (set WEBHOOK_URL, SENTRY_DSN, or DATADOG_API_KEY)

---

### LocalAuth

#### `POST /auth/signup`

**Summary:** Register a new local account

Create a new account using an email address or E.164 phone number and password.
All self-registered users receive the `user` role (Free tier).
Admin role must be granted via `POST /admin/local-users`.

**Rate limited** (anonymous tier). Returns a signed HS256 JWT on success.

> Only active when `CLERK_JWKS_URL` is not configured. When Clerk is live,
> sign up via the Clerk-hosted UI instead.


**Operation ID:** `localSignup`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`LocalSignupRequest`](#localsignuprequest)

**Responses:**

- `201`: Account created — JWT returned
- `400`: No description
- `409`: An account with this identifier already exists
- `429`: No description
- `503`: No description

---

#### `POST /auth/login`

**Summary:** Authenticate and receive a JWT

Authenticate with an identifier (email or phone) and password.
Returns a signed HS256 JWT valid for 24 hours.

Timing-safe: always runs full PBKDF2 derivation even for unknown identifiers
to prevent user enumeration via timing side-channels.

**Rate limited** (anonymous tier).


**Operation ID:** `localLogin`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`LocalLoginRequest`](#localloginrequest)

**Responses:**

- `200`: Authentication successful — JWT returned
- `400`: No description
- `401`: Invalid credentials (generic — no user enumeration)
- `429`: No description
- `503`: No description

---

#### `GET /auth/me`

**Summary:** Get current user profile

Returns the authenticated user's public profile.
Requires a valid `Authorization: Bearer <jwt>` header.


**Operation ID:** `localMe`

**Responses:**

- `200`: Current user profile
- `401`: No description
- `404`: User record not found (deleted since token was issued)
- `503`: No description

---

#### `POST /auth/change-password`

**Summary:** Change the current user's password

Update the authenticated user's password.
Requires a valid `Authorization: Bearer <jwt>` header and the correct current password.


**Operation ID:** `localChangePassword`

**Request Body:**

- Content-Type: `application/json`
  - Schema: [`LocalChangePasswordRequest`](#localchangepasswordrequest)

**Responses:**

- `200`: Password updated successfully
- `400`: No description
- `401`: Not authenticated or current password is wrong
- `503`: No description

---

### Proxy

#### `GET /api/proxy/fetch`

**Summary:** Proxy fetch a single URL

Fetches the content of a remote HTTPS URL on behalf of the client.

This endpoint exists to allow browser-based (local mode) and hybrid mode compilation to download source filter lists that would otherwise be blocked by browser CORS policies.

**SSRF protection** — private/loopback/link-local IP ranges and cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`) are blocked.

**Caching** — responses are cached in KV for 5 minutes to reduce upstream load.

**Auth** — anonymous callers must pass a valid Cloudflare Turnstile token via the `X-Turnstile-Token` request header or `turnstileToken` query parameter. Authenticated (Free+) callers are exempt.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | ✅ | Fully-qualified HTTPS URL to fetch (URL-encoded) |
| `turnstileToken` | `string` | — | Turnstile token for anonymous callers |

**Responses:**

- `200`: Raw text content of the proxied URL (`text/plain`)
- `400`: Invalid or unsafe URL
- `403`: Turnstile verification failed
- `429`: Rate limit exceeded
- `502`: Upstream fetch failed

---

#### `POST /api/proxy/fetch/batch`

**Summary:** Batch proxy fetch multiple URLs

Fetches the content of multiple remote HTTPS URLs in parallel.

Used by **hybrid mode**: the Worker fetches source filter lists and returns the raw content to the browser, which then runs the transformation pipeline locally via `WorkerCompiler`.

Requires **Pro tier**.

Maximum **20 URLs** per request.

**Request Body** (`application/json`):

- `urls` (required): `string[]` — HTTPS URLs to fetch (min 1, max 20)

**Response Body** (`application/json`):

```json
{
  "success": true,
  "results": {
    "https://example.com/list.txt": {
      "content": "! EasyList\n||example.com^"
    },
    "https://bad-url.example.com/": {
      "error": "Fetch failed: upstream HTTP 404"
    }
  }
}
```

**Responses:**

- `200`: Map of URL → `{ content?: string; error?: string }`
- `400`: Invalid request body or unsafe URL detected
- `401`: Authentication required (Pro tier)

---

## Schemas

### ErrorResponse

**Properties:**

- `success`: `boolean` - 
- `error`: `string` - 

---

### CompileRequest

**Properties:**

- `configuration` (required): `Configuration` - 
- `preFetchedContent`: `object` - Map of source keys to pre-fetched content
- `benchmark`: `boolean` - Include detailed performance metrics
- `turnstileToken`: `string` - Cloudflare Turnstile token (if enabled)
- `priority`: `string` - Job processing priority (used for async compilation)

---

### Configuration

**Properties:**

- `name` (required): `string` - Name of the compiled list
- `description`: `string` - Description of the list
- `homepage`: `string` - Homepage URL
- `license`: `string` - License identifier
- `version`: `string` - Version string
- `sources` (required): `array` - 
- `transformations`: `array` - Global transformations to apply
- `exclusions`: `array` - Rules to exclude (supports wildcards and regex)
- `exclusions_sources`: `array` - Files containing exclusion rules
- `inclusions`: `array` - Rules to include (supports wildcards and regex)
- `inclusions_sources`: `array` - Files containing inclusion rules

---

### Source

**Properties:**

- `source` (required): `string` - URL or key for pre-fetched content
- `name`: `string` - Name of the source
- `type`: `string` - Source type
- `transformations`: `array` - 
- `exclusions`: `array` - 
- `inclusions`: `array` - 

---

### Transformation

Available transformations (applied in this order):
- **ConvertToAscii**: Convert internationalized domains to ASCII
- **RemoveComments**: Remove comment lines
- **Compress**: Convert hosts format to adblock syntax
- **RemoveModifiers**: Strip unsupported modifiers
- **Validate**: Remove invalid/dangerous rules
- **ValidateAllowIp**: Like Validate but keeps IP addresses
- **Deduplicate**: Remove duplicate rules
- **InvertAllow**: Convert blocking rules to allowlist
- **RemoveEmptyLines**: Remove blank lines
- **TrimLines**: Remove leading/trailing whitespace
- **InsertFinalNewLine**: Add final newline


**Enum values:**

- `ConvertToAscii`
- `RemoveComments`
- `Compress`
- `RemoveModifiers`
- `Validate`
- `ValidateAllowIp`
- `Deduplicate`
- `InvertAllow`
- `RemoveEmptyLines`
- `TrimLines`
- `InsertFinalNewLine`

---

### BatchCompileRequest

**Properties:**

- `requests` (required): `array` - 

---

### BatchRequestItem

**Properties:**

- `id` (required): `string` - Unique request identifier
- `configuration` (required): `Configuration` - 
- `preFetchedContent`: `object` - 
- `benchmark`: `boolean` - 

---

### CompileResponse

**Properties:**

- `success` (required): `boolean` - 
- `rules`: `array` - Compiled filter rules
- `ruleCount`: `integer` - Number of rules
- `metrics`: `CompilationMetrics` - 
- `compiledAt`: `string` - 
- `previousVersion`: `PreviousVersion` - 
- `cached`: `boolean` - Whether result was served from cache
- `deduplicated`: `boolean` - Whether request was deduplicated
- `error`: `string` - Error message if success=false

---

### CompilationMetrics

**Properties:**

- `totalDurationMs`: `integer` - 
- `sourceCount`: `integer` - 
- `ruleCount`: `integer` - 
- `transformationMetrics`: `array` - 

---

### PreviousVersion

**Properties:**

- `rules`: `array` - 
- `ruleCount`: `integer` - 
- `compiledAt`: `string` - 

---

### BatchCompileResponse

**Properties:**

- `success`: `boolean` - 
- `results`: `array` - 

---

### QueueResponse

**Properties:**

- `success`: `boolean` - 
- `message`: `string` - 
- `requestId`: `string` - 
- `priority`: `string` - 
- `note`: `string` - Informational note about the queued job
- `batchSize`: `integer` - Number of items in the batch (only for batch async requests)

---

### QueueJobStatus

**Properties:**

- `success`: `boolean` - 
- `status`: `string` - 
- `jobInfo`: `object` - 

---

### QueueStats

**Properties:**

- `pending`: `integer` - 
- `completed`: `integer` - 
- `failed`: `integer` - 
- `cancelled`: `integer` - 
- `totalProcessingTime`: `integer` - 
- `averageProcessingTime`: `integer` - 
- `processingRate`: `number` - Jobs per minute
- `queueLag`: `integer` - Average time in queue (ms)
- `lastUpdate`: `string` - 
- `history`: `array` - 
- `depthHistory`: `array` - 

---

### JobHistoryEntry

**Properties:**

- `requestId`: `string` - 
- `configName`: `string` - 
- `status`: `string` - 
- `duration`: `integer` - 
- `timestamp`: `string` - 
- `error`: `string` - 
- `ruleCount`: `integer` - 

---

### MetricsResponse

**Properties:**

- `window`: `string` - 
- `timestamp`: `string` - 
- `endpoints`: `object` - 

---

### ApiInfo

**Properties:**

- `name`: `string` - 
- `version`: `string` - 
- `endpoints`: `object` - 
- `example`: `object` - 

---

### VersionResponse

**Properties:**

- `success` (required): `boolean` - 
- `version` (required): `string` - Semantic version string
- `buildNumber`: `integer` - 
- `fullVersion`: `string` - Full version string including build number
- `gitCommit`: `string` - 
- `gitBranch`: `string` - 
- `deployedAt`: `string` - Deployment timestamp as stored by SQLite datetime('now') in 'YYYY-MM-DD HH:MM:SS' format
- `deployedBy`: `string` - 
- `status`: `string` - 
- `message`: `string` - Present when no deployment history is available

---

### DeploymentHistoryResponse

**Properties:**

- `success` (required): `boolean` - 
- `deployments` (required): `array` - 
- `count` (required): `integer` - Total number of deployments returned

---

### DeploymentStatsResponse

**Properties:**

- `success` (required): `boolean` - 
- `totalDeployments` (required): `integer` - 
- `successfulDeployments` (required): `integer` - 
- `failedDeployments` (required): `integer` - 
- `latestVersion`: `string` - 

---

### TurnstileConfigResponse

**Properties:**

- `siteKey`: `string` - Cloudflare Turnstile site key
- `enabled`: `boolean` - Whether Turnstile verification is enabled

---

### DeploymentInfo

**Properties:**

- `version` (required): `string` - 
- `buildNumber` (required): `integer` - 
- `fullVersion` (required): `string` - 
- `gitCommit` (required): `string` - 
- `gitBranch` (required): `string` - 
- `deployedAt` (required): `string` - Deployment timestamp as stored by SQLite datetime('now') in 'YYYY-MM-DD HH:MM:SS' format
- `deployedBy` (required): `string` - 
- `status` (required): `string` - 
- `metadata`: `object` - 

---

### QueueHistoryResponse

**Properties:**

- `history`: `array` - 
- `depthHistory`: `array` - 

---

### CancelJobResponse

**Properties:**

- `success`: `boolean` - 
- `message`: `string` - 
- `note`: `string` - Note that job may still process if already started

---

### ASTParseRequest

Either 'rules' or 'text' must be provided

**Properties:**

- `rules`: `array` - Array of filter rule strings to parse
- `text`: `string` - Raw text containing filter rules (newline-separated)

---

### ASTParseResponse

**Properties:**

- `success`: `boolean` - 
- `parsedRules`: `array` - Array of parsed rule AST objects
- `summary`: `object` - Summary statistics about the parsed rules (e.g., total rules, rule types, parse errors)

---

### AdminStorageStatsResponse

**Properties:**

- `success`: `boolean` - 
- `stats`: `StorageStats` - 
- `timestamp`: `string` - 

---

### StorageStats

**Properties:**

- `storage_entries`: `integer` - 
- `filter_cache`: `integer` - 
- `compilation_metadata`: `integer` - 
- `expired_storage`: `integer` - 
- `expired_cache`: `integer` - 

---

### AdminOperationResponse

**Properties:**

- `success`: `boolean` - 
- `deleted`: `integer` - Number of entries deleted (for clear operations)
- `message`: `string` - 

---

### AdminExportResponse

**Properties:**

- `success`: `boolean` - 
- `exportedAt`: `string` - 
- `storage_entries`: `array` - 
- `filter_cache`: `array` - 
- `compilation_metadata`: `array` - 

---

### AdminTablesResponse

**Properties:**

- `success`: `boolean` - 
- `tables`: `array` - 

---

### TableInfo

**Properties:**

- `name`: `string` - 
- `type`: `string` - 

---

### AdminQueryRequest

**Properties:**

- `sql` (required): `string` - SELECT-only SQL query to execute

---

### AdminQueryResponse

**Properties:**

- `success`: `boolean` - 
- `rows`: `array` - 
- `rowCount`: `integer` - 
- `meta`: `object` - Query metadata (e.g., column names, types, execution time)

---

### WorkflowStartResponse

**Properties:**

- `success`: `boolean` - 
- `message`: `string` - 
- `workflowId`: `string` - 
- `workflowType`: `string` - 
- `batchSize`: `integer` - Number of items in the batch (batch workflows only)
- `configurationsCount`: `string` - Number of configurations to warm, or 'default' for all default configurations (cache-warming only)
- `sourcesCount`: `string` - Number of sources to check, or 'default' for all default sources (health-monitoring only)

---

### CacheWarmRequest

**Properties:**

- `configurations`: `array` - Configurations to warm (uses defaults if empty)

---

### HealthCheckRequest

**Properties:**

- `sources`: `array` - Sources to health-check (uses defaults if empty)
- `alertOnFailure`: `boolean` - 

---

### WorkflowStatusResponse

**Properties:**

- `success`: `boolean` - 
- `workflowId`: `string` - 
- `workflowType`: `string` - 
- `status`: `string` - 
- `output`: `object` - 
- `error`: `string` - 

---

### WorkflowMetricsResponse

**Properties:**

- `success`: `boolean` - 
- `timestamp`: `string` - 
- `workflows`: `object` - Metrics grouped by workflow type

---

### WorkflowEventsResponse

**Properties:**

- `success`: `boolean` - 
- `workflowId`: `string` - 
- `workflowType`: `string` - 
- `startedAt`: `string` - 
- `completedAt`: `string` - 
- `progress`: `number` - 
- `isComplete`: `boolean` - 
- `events`: `array` - 

---

### WorkflowEvent

**Properties:**

- `type`: `string` - 
- `workflowId`: `string` - 
- `workflowType`: `string` - 
- `timestamp`: `string` - 
- `step`: `string` - 
- `progress`: `number` - 
- `message`: `string` - 
- `data`: `object` - Step-specific data (structure varies by workflow type and step)

---

### HealthLatestResponse

**Properties:**

- `success` (required): `boolean` - 
- `message`: `string` - Present when no health data is available
- `timestamp`: `string` - ISO timestamp of when this health check ran
- `runId`: `string` - Unique identifier for the health monitoring workflow run
- `results`: `array` - Per-source health check results
- `summary`: `object` - Aggregate counts for the health check run

---

### SourceHealthResult

**Properties:**

- `name` (required): `string` - 
- `url` (required): `string` - 
- `healthy` (required): `boolean` - 
- `statusCode`: `integer` - 
- `responseTimeMs`: `number` - 
- `ruleCount`: `integer` - 
- `error`: `string` - 
- `lastChecked` (required): `string` - 

---

### HealthResponse

**Properties:**

- `status`: `string` - 
- `version`: `string` - Current service version

---

### CreateUserRequest

**Properties:**

- `email` (required): `string` - User email address
- `displayName`: `string` - Display name
- `role`: `string` - User role

---

### CreateUserResponse

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### CreateApiKeyRequest

**Properties:**

- `userId` (required): `string` - ID of the user to create the key for
- `name` (required): `string` - Descriptive name for the API key
- `scopes`: `array` - Permission scopes for the key
- `rateLimitPerMinute`: `integer` - Rate limit override for this key
- `expiresAt`: `string` - Expiry date for the key

---

### CreateApiKeyResponse

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### ListApiKeysResponse

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### ApiKeyInfo

**Properties:**

- `id`: `string` - 
- `name`: `string` - 
- `keyPrefix`: `string` - 
- `scopes`: `array` - 
- `rateLimitPerMinute`: `integer` - 
- `createdAt`: `string` - 
- `expiresAt`: `string` - 
- `revokedAt`: `string` - 
- `lastUsedAt`: `string` - 
- `status`: `string` - 

---

### RevokeApiKeyRequest

**Properties:**

- `apiKeyId`: `string` - ID of the API key to revoke
- `keyPrefix`: `string` - Prefix of the API key to revoke

---

### RevokeApiKeyResponse

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### ValidateApiKeyRequest

**Properties:**

- `apiKey` (required): `string` - The API key to validate

---

### ValidateApiKeyResponse

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### UserCreateApiKeyRequest

**Properties:**

- `name` (required): `string` - Human-readable name for the key
- `scopes`: `array` - Permissions granted to this key (defaults to ["compile"])
- `expiresInDays`: `integer` - Days until expiration (omit for no expiry)

---

### UserCreateApiKeyResponse

**Properties:**

- `success`: `boolean` - 
- `id`: `string` - 
- `key`: `string` - The plaintext API key (returned **only once** on creation). Starts with `abc_`.
- `keyPrefix`: `string` - First 8 characters of the key (e.g. abc_XXXX)
- `name`: `string` - 
- `scopes`: `array` - 
- `rateLimitPerMinute`: `integer` - 
- `expiresAt`: `string` - 
- `createdAt`: `string` - 

---

### UserApiKeyInfo

**Properties:**

- `id`: `string` - 
- `keyPrefix`: `string` - 
- `name`: `string` - 
- `scopes`: `array` - 
- `rateLimitPerMinute`: `integer` - 
- `lastUsedAt`: `string` - 
- `expiresAt`: `string` - 
- `revokedAt`: `string` - 
- `createdAt`: `string` - 
- `updatedAt`: `string` - 
- `isActive`: `boolean` - Whether the key is currently usable (not revoked and not expired)

---

### UserListApiKeysResponse

**Properties:**

- `success`: `boolean` - 
- `keys`: `array` - 
- `total`: `integer` - 

---

### UserUpdateApiKeyRequest

At least one of `name` or `scopes` must be provided.

**Properties:**

- `name`: `string` - New name for the key
- `scopes`: `array` - New scopes for the key

---

### UserUpdateApiKeyResponse

**Properties:**

- `success`: `boolean` - 
- `id`: `string` - 
- `keyPrefix`: `string` - 
- `name`: `string` - 
- `scopes`: `array` - 
- `rateLimitPerMinute`: `integer` - 
- `lastUsedAt`: `string` - 
- `expiresAt`: `string` - 
- `createdAt`: `string` - 
- `updatedAt`: `string` - 

---

### MigrationResult

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### MigrationTableStats

**Properties:**

- `table`: `string` - 
- `sourceCount`: `integer` - 
- `migratedCount`: `integer` - 
- `skippedCount`: `integer` - 
- `errorCount`: `integer` - 
- `durationMs`: `integer` - 

---

### BackendStatusResponse

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### BackendHealth

**Properties:**

- `available`: `boolean` - 
- `latencyMs`: `integer` - 
- `host`: `string` - Host name (PostgreSQL only)
- `error`: `string` - Error message if unavailable

---

### PgStorageStatsResponse

**Properties:**

- `success`: `boolean` - 
- `data`: `object` - 

---

### WsCompileRequest

**Properties:**

- `type` (required): `string` - 
- `sessionId` (required): `string` - 
- `configuration` (required): `Configuration` - 
- `preFetchedContent`: `object` - 
- `benchmark`: `boolean` - 

---

### WsCancelRequest

**Properties:**

- `type` (required): `string` - 
- `sessionId` (required): `string` - 

---

### WsPingMessage

**Properties:**

- `type` (required): `string` - 

---

### WsWelcomeMessage

**Properties:**

- `type` (required): `string` - 
- `version` (required): `string` - 
- `connectionId` (required): `string` - 
- `capabilities` (required): `object` - 

---

### WsPongMessage

**Properties:**

- `type` (required): `string` - 
- `timestamp`: `string` - 

---

### WsCompileStartedMessage

**Properties:**

- `type` (required): `string` - 
- `sessionId` (required): `string` - 
- `configurationName` (required): `string` - 

---

### WsEventMessage

**Properties:**

- `type` (required): `string` - 
- `sessionId` (required): `string` - 
- `eventType` (required): `string` - 
- `data` (required): `object` - 

---

### WsCompileCompleteMessage

**Properties:**

- `type` (required): `string` - 
- `sessionId` (required): `string` - 
- `rules` (required): `array` - 
- `ruleCount` (required): `integer` - 
- `metrics`: `object` - 
- `compiledAt`: `string` - 

---

### WsCompileErrorMessage

**Properties:**

- `type` (required): `string` - 
- `sessionId` (required): `string` - 
- `error` (required): `string` - 
- `details`: `object` - 

---

### BrowserWaitUntil

Playwright `waitUntil` navigation event. `networkidle` (default) waits until
there are no more than 0 network connections for at least 500 ms — suitable for
most filter-list sources. Use `load` for fastest navigation.


**Enum values:**

- `load`
- `domcontentloaded`
- `networkidle`

---

### BrowserResolveRequest

**Properties:**

- `url` (required): `string` - The URL to navigate to and resolve.
- `waitUntil`: `BrowserWaitUntil` - 

---

### BrowserResolveResponse

**Properties:**

- `success` (required): `boolean` - 
- `resolvedUrl` (required): `string` - The canonical URL after all JavaScript redirects have settled.
- `originalUrl` (required): `string` - The original URL that was submitted.

---

### SourceMonitorEntry

**Properties:**

- `url` (required): `string` - The source URL that was checked.
- `reachable` (required): `boolean` - Whether the URL was reachable and returned non-empty content.
- `checkedAt` (required): `string` - ISO-8601 timestamp of when this URL was checked.
- `screenshotKey`: `string` - R2 object key for the captured screenshot (only present when captureScreenshots is true).
- `error`: `string` - Error message, present only when the URL could not be fetched.

---

### SourceMonitorRequest

**Properties:**

- `urls` (required): `array` - One or more filter-list source URLs to check (max 10).
- `captureScreenshots`: `boolean` - When true, a full-page PNG screenshot is captured and stored in R2 per URL.
- `screenshotPrefix`: `string` - R2 key prefix for screenshots (alphanumeric, hyphens, underscores only). Defaults to the current ISO date.
- `timeout`: `integer` - Per-URL navigation timeout in milliseconds.
- `waitUntil`: `BrowserWaitUntil` - 

---

### SourceMonitorResponse

**Properties:**

- `success` (required): `boolean` - 
- `results` (required): `array` - 
- `total` (required): `integer` - Total number of URLs checked.
- `reachable` (required): `integer` - Number of reachable URLs.
- `unreachable` (required): `integer` - Number of unreachable URLs.

---

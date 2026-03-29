# API Reference

The adblock-compiler exposes two complementary APIs:

1. **REST/HTTP API** — JSON endpoints for compilation, configuration, queue management, monitoring, and administration.
2. **TypeScript Library API** — JSDoc-annotated classes and functions for direct library usage (Deno / Node.js).

---

## Authentication

All write endpoints require authentication. Three methods are supported:

| Method | Header | Description |
|--------|--------|-------------|
| **Better Auth session** | `Authorization: Bearer <session-token>` | Cookie or bearer session token. Created on sign-up/sign-in via `/api/auth/sign-in/email`. |
| **API Key** | `Authorization: Bearer abc_<key>` | Long-lived programmatic access key (`abc_` prefix). Created via the API keys dashboard. |
| **Anonymous** | _(none)_ | Public read-only endpoints only. Lowest rate limits. |

> **Note:** Clerk JWT is **deprecated** and no longer supported. Use Better Auth session tokens or API keys for all programmatic access. See [`docs/auth/README.md`](auth/README.md) for full authentication documentation.

### Rate Limits by Tier

| Tier | Limit | Description |
|------|-------|-------------|
| `anonymous` | 10 req/min | Public endpoints only |
| `free` | 60 req/min | Registered user |
| `pro` | 300 req/min | Paid subscriber |
| `admin` | Unlimited | Administrator |

---

## REST API Endpoints

Base URL: `https://adblock-compiler.jayson-knight.workers.dev/api`  
Local dev: `http://localhost:8787/api`

All endpoints return JSON. Streaming endpoints (`/compile/stream`) return `text/event-stream`.

### Endpoint Summary

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| `GET` | `/api` | No | API info — version, endpoints, usage examples |
| `GET` | `/api/version` | No | Current deployment version |
| `GET` | `/api/schemas` | No | JSON Schemas for all public Zod types |
| `GET` | `/api/turnstile-config` | No | Cloudflare Turnstile site key |
| `GET` | `/api/sentry-config` | No | Sentry DSN for client-side error reporting |
| `GET` | `/api/openapi.json` | No | Live OpenAPI 3.0 specification |
| `GET` | `/api/deployments` | No | Deployment history |
| `GET` | `/api/deployments/stats` | No | Deployment statistics |
| `GET` | `/api/auth/providers` | No | Active authentication providers |
| `POST` | `/api/auth/sign-up/email` | No | Create account |
| `POST` | `/api/auth/sign-in/email` | No | Sign in (returns session token) |
| `POST` | `/api/auth/sign-out` | Session | Sign out |
| `GET` | `/api/auth/get-session` | No | Current session info |
| **Compilation** | | | |
| `POST` | `/api/compile` | Free+ | Synchronous JSON compilation |
| `POST` | `/api/compile/stream` | Free+ | SSE streaming compilation |
| `POST` | `/api/compile/batch` | Free+ | Synchronous batch compilation (max 10) |
| `POST` | `/api/compile/async` | Free+ | Async compilation (queue) |
| `POST` | `/api/compile/batch/async` | Free+ | Async batch compilation (queue) |
| `POST` | `/api/compile/container` | Free+ | Container-based compilation |
| `POST` | `/api/ast/parse` | Free+ | Parse rules into AST |
| `POST` | `/api/validate` | Free+ | Validate filter list |
| `POST` | `/api/validate-rule` | Free+ | Validate a single rule |
| `GET` | `/api/ws/compile` | Free+ | WebSocket real-time compilation |
| **Queue** | | | |
| `GET` | `/api/queue/stats` | No | Queue health metrics |
| `GET` | `/api/queue/history` | Free+ | Job history |
| `GET` | `/api/queue/results/:id` | Free+ | Async job results |
| `DELETE` | `/api/queue/cancel/:id` | Free+ | Cancel pending job |
| **Configuration** | | | |
| `GET` | `/api/configuration/defaults` | No | System compilation defaults |
| `POST` | `/api/configuration/validate` | No | Validate a configuration object |
| `POST` | `/api/configuration/resolve` | No | Merge and resolve configuration layers |
| **Rules** | | | |
| `GET` | `/api/rules` | Free+ | List cached rule sets |
| `GET` | `/api/rules/:id` | Free+ | Get a specific rule set |
| **Monitoring** | | | |
| `GET` | `/api/health` | No | Health check (cached 30s) |
| `GET` | `/api/health/latest` | No | Latest health snapshot |
| `GET` | `/api/health/db-smoke` | No | Database smoke test |
| `GET` | `/api/metrics` | No | Aggregated performance metrics |
| `GET` | `/api/metrics/prometheus` | No | Prometheus-format metrics |
| `GET` | `/api/container/status` | No | Container (DO) status |
| **API Keys** | | | |
| `GET` | `/api/keys` | Free+ | List API keys |
| `POST` | `/api/keys` | Free+ | Create API key |
| `DELETE` | `/api/keys/:id` | Free+ | Revoke API key |
| **Workflows** | | | |
| `POST` | `/api/workflow/compile` | Free+ | Start compilation workflow |
| `GET` | `/api/workflow/:id` | Free+ | Get workflow status |
| **Admin** | | | |
| `GET` | `/api/admin/users` | Admin | List all users |
| `GET` | `/api/admin/users/:id` | Admin | Get user by ID |
| `PATCH` | `/api/admin/users/:id` | Admin | Update user |
| `DELETE` | `/api/admin/users/:id` | Admin | Delete user |
| `POST` | `/api/admin/users/:id/ban` | Admin | Ban user |
| `POST` | `/api/admin/users/:id/unban` | Admin | Unban user |
| `GET` | `/api/admin/auth/config` | Admin | Auth configuration |
| `GET` | `/api/admin/usage/:userId` | Admin | User API usage |
| `ALL` | `/api/admin/storage/*` | Admin | Storage management |
| `GET` | `/api/admin/neon/project` | Admin | Neon project info |
| `GET` | `/api/admin/neon/branches` | Admin | Neon branches |
| `POST` | `/api/admin/neon/query` | Admin | Run Neon query |
| `GET` | `/api/admin/agents/sessions` | Admin | Agent sessions |
| **tRPC** | | | |
| `ALL` | `/api/trpc/*` | Varies | tRPC v11 endpoint (see [`docs/architecture/trpc.md`](architecture/trpc.md)) |

---

## Usage Examples

### Compile a Filter List (Sync)

```bash
curl -X POST https://adblock-compiler.jayson-knight.workers.dev/api/compile \
  -H "Authorization: Bearer <session-token-or-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "configuration": {
      "name": "My List",
      "sources": [
        {
          "url": "https://raw.githubusercontent.com/easylist/easylist/master/easylist.txt",
          "title": "EasyList"
        }
      ],
      "transformations": ["deduplicate", "validate"]
    }
  }'
```

### Sign In and Get Session Token

```bash
curl -X POST https://adblock-compiler.jayson-knight.workers.dev/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "yourpassword"}'
# Response: { "token": "...", "user": { ... } }
```

### Check API Health

```bash
curl https://adblock-compiler.jayson-knight.workers.dev/api/health
# Response: { "status": "healthy", "version": "<current-version>", "timestamp": "..." }
```

### Queue an Async Compilation

```bash
# 1. Submit job
curl -X POST https://adblock-compiler.jayson-knight.workers.dev/api/compile/async \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "configuration": { "sources": [{ "url": "https://..." }] } }'
# Response: { "requestId": "req_abc123", "status": "queued" }

# 2. Poll for results
curl https://adblock-compiler.jayson-knight.workers.dev/api/queue/results/req_abc123 \
  -H "Authorization: Bearer <token>"
```

---

## TypeScript Library API

> **Tip:** The TypeScript API reference is a separate static site generated from JSDoc annotations.

### What is documented

Every symbol exported from the library's main entry point (`src/index.ts`):

| Category | Key exports |
|----------|-------------|
| **Compiler** | `FilterCompiler`, `SourceCompiler`, `IncrementalCompiler`, `compile()` |
| **Transformations** | `RemoveCommentsTransformation`, `DeduplicateTransformation`, `CompressTransformation`, `ValidateTransformation`, … |
| **Platform** | `WorkerCompiler`, `HttpFetcher`, `CompositeFetcher`, `PlatformDownloader` |
| **Formatters** | `AdblockFormatter`, `HostsFormatter`, `DnsmasqFormatter`, `JsonFormatter`, … |
| **Services** | `FilterService`, `ASTViewerService`, `AnalyticsService` |
| **Diagnostics** | `DiagnosticsCollector`, `createTracingContext`, `traceAsync`, `traceSync` |
| **Utils** | `RuleUtils`, `Logger`, `CircuitBreaker`, `CompilerEventEmitter`, … |
| **Configuration** | `ConfigurationSchema`, `ConfigurationValidator`, all Zod schemas |
| **Types** | All public interfaces (`IConfiguration`, `ILogger`, `ICompilerEvents`, …) |
| **Diff** | `DiffGenerator`, `generateDiff` |
| **Plugins** | `PluginRegistry`, `PluginTransformationWrapper` |

### Generating locally

```bash
# Generate the HTML API reference into book/api-reference/
deno task docs:api

# Build the full mdBook site + API reference in one step
deno task docs:build

# Live-preview the mdBook (does not include API reference)
deno task docs:serve
```

### JSDoc conventions

```typescript
/**
 * Brief one-line description.
 *
 * @param inputRules - The raw rule strings to process.
 * @returns The transformed rule strings.
 * @example
 * ```ts
 * const result = new DeduplicateTransformation().executeSync(rules);
 * ```
 */
```

See [`docs/development/CODE_REVIEW.md`](development/CODE_REVIEW.md) for the full documentation style guide.

---

## Further Reading

- [REST API Reference](api/README.md) — Auto-generated from OpenAPI spec
- [OpenAPI Specification](api/openapi.yaml) — Canonical OpenAPI 3.0 source
- [Authentication Guide](auth/README.md) — Better Auth, API keys, tiers
- [Batch API Guide](api/BATCH_API_GUIDE.md) — Batch and async compilation
- [Configuration API](api/CONFIGURATION_API.md) — Configuration endpoints
- [Streaming API](api/STREAMING_API.md) — SSE and WebSocket streaming
- [tRPC API](architecture/trpc.md) — tRPC v11 procedure catalogue
- [Hono RPC Client](architecture/hono-rpc-client.md) — Typed Angular client


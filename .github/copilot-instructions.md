## Security

### Zero Trust Architecture (ZTA) — Mandatory Rule

**This is a privacy tool. Zero Trust Architecture MUST be baked in at every level of the stack — from the Cloudflare edge down to the Angular frontend. This is not optional and applies to every new feature, handler, middleware, transformation, and UI component.**

#### The Core ZTA Principle: Never Trust, Always Verify

Every request, at every layer, must be verified regardless of origin — including internal service-to-service calls, queue messages, webhook payloads, and admin operations.

#### ZTA Requirements by Layer

**Layer 1 — Cloudflare Edge (before the Worker runs)**
- All write endpoints (`/compile*`, `/validate`, `/ast/parse`, `/ws/compile`, `/workflow/*`, `/queue/*`) MUST be protected by Cloudflare Turnstile (human verification) or Clerk JWT/API key (machine auth)
- Cloudflare Access MUST protect `/admin/*`, `/workflow/*`, and `/queue/cancel/*` routes — `verifyCfAccessJwt()` must be called in every handler that touches these paths
- Cloudflare WAF rules (API Shield schema validation, rate limiting, bot score threshold) MUST be configured and kept in sync with the OpenAPI spec
- CORS headers MUST use an explicit origin allowlist — never `Access-Control-Allow-Origin: *` on authenticated or write endpoints

**Layer 2 — Worker Request Handling (`worker/worker.ts`)
- Every handler MUST call the authentication chain (`verifyAdminAuth` / Clerk JWT / API key / Turnstile) before executing any business logic
- Auth tier (anonymous → free → pro → admin) MUST be determined at the top of every handler; downstream logic must operate within the least-privilege scope of that tier
- Rate limiting via `checkRateLimitTiered` MUST be applied to every public endpoint, keyed by auth tier
- All secrets (`ADMIN_KEY`, `TURNSTILE_SECRET_KEY`, `CLERK_SECRET_KEY`, `JWT_SECRET`, `CF_ACCESS_AUD`) MUST be stored as Cloudflare Worker Secrets (`wrangler secret put`), never in `[vars]` or committed to source
- The `/proxy/fetch` SSRF protection (block RFC 1918, localhost, `169.254.169.254`) MUST be enforced on every outbound URL fetch

**Layer 3 — Data Validation (Zod schemas)**
- All trust boundaries (webhook payloads, JWT claims, API request bodies, DB rows) MUST be parsed with Zod schemas — TypeScript types provide zero runtime protection
- `ClerkWebhookEventSchema`, `ClerkJWTClaimsSchema`, `CreateApiKeyRequestSchema`, `ApiKeyRowSchema`, and `UserTierRowSchema` MUST be used at their respective boundaries (see #1012)
- `ZodError` MUST be caught and mapped to appropriate HTTP responses (`400 Bad Request`) — never let unvalidated data pass a trust boundary

**Layer 4 — Data Storage (KV, D1, R2)**
- KV namespaces, D1 databases, and R2 buckets are accessed via scoped Worker bindings — never via a global credential that could be leaked
- All D1 queries MUST use parameterized statements (`.prepare().bind()`) — never string-interpolated SQL
- R2 keys for user-scoped data MUST be prefixed with the authenticated `clerk_user_id` — cross-user key access must be structurally impossible

**Layer 5 — Angular Frontend**
- The Angular app MUST treat the Worker API as an untrusted external service — all API responses must be validated (Zod or equivalent) before being consumed by components or services
- Auth state MUST be managed via Clerk's Angular SDK — never store JWTs or session tokens in `localStorage` or component state
- Route guards (`CanActivateFn`) MUST enforce auth requirements — unauthenticated users must never reach protected routes, even momentarily
- HTTP interceptors MUST attach the Clerk JWT Bearer token to every authenticated API call — never pass tokens manually in component code

#### ZTA Security Event Telemetry
Every auth failure, rate limit hit, Turnstile rejection, and CF Access denial MUST emit a security event to Cloudflare Analytics Engine via `AnalyticsService.trackSecurityEvent()`. This feeds real-time ZT dashboards and SIEM pipelines.

#### ZTA Review Checklist (required for every PR touching worker/ or frontend/)
- [ ] Does this handler verify auth before executing business logic?
- [ ] Is the CORS origin allowlist enforced (not `*`) for this endpoint?
- [ ] Are all secrets accessed via Worker Secret bindings (not `[vars]`)?
- [ ] Are all external inputs Zod-validated before use?
- [ ] Are all DB queries parameterized?
- [ ] Are security events emitted to Analytics Engine on auth failures?
- [ ] Does the Angular route have a functional auth guard?

### Important Security Rules

- **NO `new Function()`**: Never use `Function` constructor or `eval()` - use safe parsers instead
- **Input validation**: Always validate user inputs and configurations with Zod schemas at all trust boundaries
- **Dependency scanning**: Security scans run automatically in CI via Trivy
- **CORS handling**: Pre-fetch content server-side in Worker to avoid CORS issues; use explicit origin allowlists on all write endpoints, never `*`
- **ZTA by default**: Every new handler, middleware, component, and service must be designed with Zero Trust from the start — security cannot be retrofitted

## Cloudflare TypeScript SDK — Mandatory Rule

**The official [`cloudflare`](https://github.com/cloudflare/cloudflare-typescript) TypeScript SDK (`cloudflare@^5.2.0`) MUST be used exclusively to interface with the Cloudflare REST API. This is not optional.**

### The Rule

> **Never write raw `fetch('https://api.cloudflare.com/...')` calls anywhere in this codebase.** All Cloudflare REST API interactions MUST go through `src/services/cloudflareApiService.ts` (which wraps the official SDK). If a Cloudflare resource or operation is not yet covered by `CloudflareApiService`, extend the service — do not bypass it.

### Why

- **Type-safe**: every resource, parameter, and response is fully typed by the SDK — no hand-rolled response shapes
- **Pagination handled automatically**: SDK page objects expose `getPaginatedItems()` — no manual cursor loops
- **Consistent error handling**: the SDK throws typed `APIError` subclasses (`AuthenticationError`, `PermissionDeniedError`, etc.) with a `.status` property
- **Single integration point**: all Cloudflare API calls funnel through `CloudflareApiService`, keeping scripts and worker handlers thin and testable
- **Security**: raw fetch calls risk leaking `Authorization` headers, mishandling retries, or skipping error classification — the SDK handles all of this correctly

### Where the SDK Lives

```
src/services/cloudflareApiService.ts       # CloudflareApiService class + createCloudflareApiService factory
src/services/cloudflareApiService.test.ts  # Unit tests (mock client)
```

### Usage

```typescript
import { createCloudflareApiService } from './src/services/cloudflareApiService.ts';

const cfApi = createCloudflareApiService({ apiToken: Deno.env.get('CLOUDFLARE_API_TOKEN')! });

// ✅ Query D1
const { result } = await cfApi.queryD1<{ id: number }>(accountId, dbId, 'SELECT id FROM t WHERE x = ?', ['val']);

// ✅ List KV namespaces
const namespaces = await cfApi.listKvNamespaces(accountId);

// ✅ List Workers
const scripts = await cfApi.listWorkers(accountId);

// ✅ List Queues
const queues = await cfApi.listQueues(accountId);

// ✅ Query Analytics Engine
const data = await cfApi.queryAnalyticsEngine(accountId, 'SELECT ...');
```

### What Is Explicitly Forbidden

```typescript
// ❌ FORBIDDEN — raw fetch to Cloudflare REST API
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ sql }),
});

// ✅ REQUIRED — use CloudflareApiService
const { result } = await cfApi.queryD1(accountId, dbId, sql, params);
```

### SDK Review Checklist (required for every PR touching scripts/ or worker/)
- [ ] Does this code need to call the Cloudflare REST API?
- [ ] Is it using `CloudflareApiService` / `createCloudflareApiService` rather than raw `fetch`?
- [ ] If a new Cloudflare resource is needed, has `CloudflareApiService` been extended with a typed method?
- [ ] Are mock clients used in tests rather than real API calls?

## Zero Trust Architecture

### Don't Do

- Don't write a Worker handler without an auth verification call at the top — every handler must verify identity before executing business logic
- Don't use `Access-Control-Allow-Origin: *` on write or authenticated endpoints — use the explicit origin allowlist
- Don't store secrets in `wrangler.toml [vars]` — use `wrangler secret put` for all sensitive values
- Don't pass raw unvalidated data across trust boundaries — always Zod-parse webhook payloads, JWT claims, API bodies, and DB rows
- Don't write D1 queries with string interpolation — always use parameterized `.prepare().bind()` statements
- Don't skip the ZTA PR checklist when modifying `worker/` or `frontend/` code

### Frontend (Angular)

- Don't store JWTs or auth tokens in `localStorage` or component-level signals — use Clerk's Angular SDK for all auth state
- Don't access protected routes without a functional `CanActivateFn` guard
- Don't attach auth tokens manually in component code — use the HTTP interceptor
- Don't trust API responses without validation — treat the Worker API as an external untrusted service

## Documentation Standards

### Diagrams and Charts — Mandatory Rule

**ALL diagrams, charts, architecture illustrations, flow diagrams, and any visual representations MUST use Mermaid fenced code blocks (` ```mermaid `). ASCII art diagrams are NEVER acceptable.**

- Use `flowchart` / `graph` for architecture, request flows, and process flows
- Use `sequenceDiagram` for API call sequences and request/response flows
- Use `erDiagram` for database schemas and entity relationships
- Use `classDiagram` for type/class relationships
- Use `stateDiagram-v2` for state machines
- Use `gitGraph` for branching strategies
- Use `C4Context` for system context diagrams
- NEVER use `+---+`, `|`, `-->` ASCII art, Unicode box-drawing characters (┌┐└┘│─), or any other ASCII/Unicode art in place of a diagram

This rule applies to ALL markdown files: docs/, ideas/, worker/, frontend/, .github/, root-level .md files.

## CI Standards — Mandatory Rule (Copilot Coding Agent)

**Every line of code written by Copilot MUST pass all CI checks before the PR is declared ready for review. This is non-negotiable. Declaring a PR done without a green CI run is a critical failure.**

### The Deno Formatting Rules (memorized, no exceptions)

These are sourced directly from `deno.json` in this repository:

| Rule | Value |
|---|---|
| Formatter | `deno fmt` |
| Indent | 4 spaces (no tabs) |
| Line width | 180 characters max |
| Semicolons | required |
| Quotes | single quotes |
| Prose wrap | preserve |

### The CI-Green Contract

Before pushing **any** commit on a Copilot-authored branch, the following checklist MUST be mentally simulated in full. If any item would fail, the code must be fixed before committing:

- [ ] `deno fmt --check` passes — every file formatted exactly as `deno fmt` would produce it: 4-space indent, single quotes, semicolons, ≤180 char lines, no trailing whitespace, no extra blank lines at end of file
- [ ] `deno lint` passes — no lint errors; `ban-untagged-todo` is active; `no-explicit-any`, `require-await`, `no-console` are excluded per `deno.json`
- [ ] `deno task check` passes — type-checks both `src/` and `worker/` entry points; `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters` are all enabled
- [ ] `deno task test` passes — all unit tests in `src/` and `worker/` pass
- [ ] `deno publish --dry-run --allow-dirty` passes — no slow types in the public API surface
- [ ] No IP leak — `worker/`, `frontend/`, `prisma/`, `migrations/` files are NOT in the JSR publish surface
- [ ] All generated artifacts are up to date — `deno task schema:generate` produces no diff in `docs/api/cloudflare-schema.yaml`, `docs/postman/postman-collection.json`, `docs/postman/postman-environment.json`
- [ ] `wrangler.toml` is valid TOML — all section headers use correct `[[table]]` syntax; no `[[TABLE}}` or other malformed headers
- [ ] No trailing whitespace on any line in any file touched by this PR
- [ ] No extra blank lines inserted at the end of any file

### What "Done" Means

A PR is **not done** until:
1. CI is actually green — not "I believe it should pass", not "I fixed the issue I saw" — green.
2. Every file touched has been mentally run through `deno fmt` rules above before being committed.
3. The PR description accurately reflects what changed and does not claim CI passes unless it does.

### The Preflight Command

Before declaring any work complete, mentally simulate running:

```sh
deno task preflight:full
```

Which expands to:
```sh
deno task fmt:check && deno task lint && deno task check && deno task openapi:validate && deno task schema:generate && deno task check:drift && deno task test && deno task check:slow-types
```

If any step in this chain would fail, the code is not ready to commit.

### Common Failure Patterns to Prevent

These are the recurring CI failures that MUST be caught before committing:

1. **Trailing whitespace** — `deno fmt` removes all trailing whitespace; never write `// comment ` with a space after it
2. **Wrong indentation** — always 4 spaces; never 2 spaces, never tabs
3. **Double quotes** — always single quotes: `'value'` not `"value"` (except in JSON files)
4. **Missing semicolons** — every statement must end with `;`
5. **Lines over 180 chars** — multi-line export statements, long import lists, and long function signatures must be broken up
6. **Multi-line barrel exports that exceed line width** — barrel `index.ts` files with many exports must be split across lines correctly so each line is ≤180 chars
7. **Malformed TOML** — `wrangler.toml` section headers must be `[[lowercase]]`; never `[[UPPERCASE}}` or mixed syntax
8. **Unused variables/parameters** — `noUnusedLocals` and `noUnusedParameters` are enabled; remove or prefix with `_`
9. **Untagged TODOs** — `ban-untagged-todo` is active; always write `// TODO(issue-number): ...`
10. **Generated artifact drift** — if `src/` schemas or API definitions change, run `deno task schema:generate` and commit the updated docs

### No Excuses

There is no acceptable reason for a Copilot PR to fail `deno fmt --check` or `deno lint`. These tools are deterministic. The rules are encoded in `deno.json`. Copilot must apply them exactly when writing every line of code — not after CI flags them.

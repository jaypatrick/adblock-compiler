# AdBlock Compiler Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **database**: Migrate primary database from Cloudflare D1 to Neon PostgreSQL via Cloudflare Hyperdrive — 14 Prisma models, full initial migration, HyperdriveStorageAdapter replaces raw SQL; D1 retained as edge cache layer; see `docs/database-setup/DATABASE_ARCHITECTURE.md`
- **auth**: Integrate Better Auth as the primary authentication provider while retaining Clerk as a temporary fallback in the Worker auth chain (Clerk slated for deprecation) — Prisma adapter, cookie security, bearer token plugin, AuthFacadeService for runtime provider switching; see `docs/auth/auth-chain-reference.md`
- **worker**: Global Hono `app.onError()` handler — unhandled exceptions return structured JSON with `requestId` instead of generic 500
- **worker**: Startup environment validation — `HYPERDRIVE`, `BETTER_AUTH_SECRET`, and `DATABASE_URL` throw actionable error messages when missing
- **worker**: Migrate all 15 POST/PUT/PATCH routes to `zValidator('json', Schema)` middleware with structured 422 error responses
- **dx**: Add `deno task setup` — single-command onboarding (copies env templates, generates Prisma client, installs git hooks)
- **dx**: Docker `db:local:up` now uses `--wait` flag (respects healthcheck instead of hardcoded sleep)
- **infra**: NeonApiService for admin reporting and branch management via Neon REST API
- **infra**: GitHub Actions workflows for Neon branch creation/cleanup on PRs
- **infra**: D1-to-Neon migration script with dry-run and verification modes (`deno task db:migrate:d1-to-neon`)
- **docs**: 8 new guides — user migration, production secrets, disaster recovery, developer onboarding, Neon troubleshooting, database testing, auth chain reference, Prisma schema reference
- **frontend**: Integrate TailwindCSS v4 with Angular Material Design 3 via `@theme inline` bridge — maps key `--mat-sys-*` role tokens to semantic Tailwind utilities (`bg-surface-variant`, `text-primary`, etc.); dark mode handled automatically through CSS variable swapping; see `docs/frontend/TAILWIND_CSS.md`
- **frontend**: Add `scripts/postbuild.js` and `npm postbuild` lifecycle hook — copies `index.csr.html` → `index.html` after `ng build` so the Cloudflare Worker `ASSETS` binding and Cloudflare Pages serve the Angular SPA shell correctly when `RenderMode.Client` routes are used
- **frontend**: Add `src/_redirects` with `/* /index.html 200` for Cloudflare Pages SPA routing fallback; include in Angular build via `assets` array in `angular.json`
- **config**: Expand Zod validation coverage — add `SourceSchema`, `ConfigurationSchema`, `BenchmarkMetricsSchema`, `CompileRequestSchema`, and related schemas to `src/configuration/schemas.ts`; integrate schema validation into `ArgumentParser` and `CliApp`; export all schemas from `src/index.ts`; see `docs/api/ZOD_VALIDATION.md`
- Integrate framework PoCs (React, Vue 3, Angular, Svelte) into the main project as alpha/experimental code: served under `/poc/` in the production build, linked from the admin dashboard with an ⚗️ Alpha label, and documented in `docs/FRAMEWORK_POCS.md`
- Documentation: Add missing v0.16.0 release notes for centralized error reporting (Sentry, Cloudflare Analytics Engine, and console backends)
- Documentation: Add missing v0.16.0 release notes for Zod schema validation for configuration objects and API request bodies
- Documentation: Add missing v0.16.0 release notes for ConfigurationValidator refactor to use Zod
- Inject optional `IBasicLogger` into `CompilerEventEmitter` / `createEventEmitter` for structured error logging when event handlers throw
- Inject optional `IBasicLogger` into `AnalyticsService` to route Analytics Engine write failures through the logger instead of `console.warn`
- Inject optional `IBasicLogger` into `CloudflareQueueProvider` / `createCloudflareQueueProvider` to route queue processing errors through the logger instead of `console.error`
- Add `CloudflareQueueProvider.test.ts` with full test coverage including logger injection tests
- **frontend**: Add `AppTitleStrategy` — custom Angular `TitleStrategy` that formats every page title as `"<Route> | Adblock Compiler"` (WCAG 2.4.2 Page Titled, Level A)
- **frontend**: WCAG 2.1 accessibility improvements — skip navigation link, single `<h1>` per page, `aria-live` toast container, `aria-hidden` on decorative icons, `.visually-hidden` utility class, `prefers-reduced-motion` support
- **frontend**: Angular SPA routing fallback in Cloudflare Worker — extensionless paths not handled by the API are served the Angular shell (`index.html`) for client-side navigation
- **worker**: Add `SPA_SERVER_PREFIXES` constant to prevent API routes from being masked by the Angular SPA fallback

### Changed

- **frontend**: Migrate all Cloudflare Workers API/asset URLs from `*.workers.dev` development domains to the production domain `adblock-compiler-ui.pages.dev` across all documentation, examples, Postman collections, and OpenAPI specs
- **worker**: Update `serveStaticAsset()` to try `index.html` first (served by postbuild), falling back to `index.csr.html` defensively if the postbuild step was skipped
- Migrate `zod` from npm to JSR (`jsr:@zod/zod@^4.3.6`)
- Migrate `@opentelemetry/api` from npm to JSR (`jsr:@opentelemetry/api@^1.9.0`)
- Improve Deno-native architecture by reducing npm dependencies where JSR alternatives are available
- Replace `console.*` calls in `EventEmitter`, `AnalyticsService`, and `CloudflareQueueProvider` with `IBasicLogger` dependency injection, defaulting to `silentLogger` for backward compatibility
- **frontend**: Add async/batch compilation modes, queue stats panel, and supporting services (QueueService, NotificationService, CompilerService extensions, CompilerComponent updates)
- **frontend**: Add structured logging (LogService) to QueueService, NotificationService, and CompilerService
- **frontend**: Expand API Docs with missing endpoints (batch, AST parse, queue management, workflow) and embedded API tester
- **frontend**: Switch `home` and `compiler` routes to `RenderMode.Client` to prevent SSR crash caused by `MatSlideToggle.writeValue()` accessing the DOM during server rendering
- **frontend**: Use `inject()` function throughout Angular services and components in place of constructor parameter injection (`@angular-eslint/prefer-inject`)
- **docs**: Update `ANGULAR_FRONTEND.md` — Routing section (short route titles + `TitleStrategy` docs), SSR render mode table and code example, new Accessibility section

### Fixed

- **frontend**: `REQUEST` injection token imported from `@angular/core` (not `@angular/ssr`) — fixes `TS2305` build error that broke the Docker CI pipeline
- **worker**: Remove dead `hasFileExtension` function and stale `async serveWebUI(env)` overload that referenced a non-existent `serveStaticFile` helper — fixes `TS2393`/`TS6133` type-check failures in CI





















## [0.85.0] - 2026-04-14

### Added- workflow visualization layer — diagram builder + REST endpoints (#1538)

### Fixed

- **wrangler**: change containers instance_type from invalid "basic" to "standard" (#1574)
- **ci**: guard grep credential extraction against no-match exit code (#1569)
- **ci**: separate container push from wrangler deploy
- **ci**: add WRANGLER_LOG=debug to main worker deploy step
- **ci**: use CLOUDFLARE_ACCOUNT_ID as Docker registry username
- **ci**: re-add Docker login for Cloudflare container registry; remove --no-cache
- **ci**: remove --account-id flag dropped in wrangler 4.82.x; fix deploy-frontend pnpm SHA (#1563)
- **ci**: remove broken Docker registry auth steps; fix pnpm lockfile validation (#1561)
- **ci**: three-layer defense against pnpm-lock.yaml drift (#1558)
- regenerate pnpm-lock.yaml to sync wrangler ^4.82.1 specifier (#1557)
- mdbook Pages deploy --no-config + 30s retry; container registry token probe uses /user/tokens/verify (#1543)
- Mermaid diagram errors, dark theme compatibility, and mdhelp scroll reset (#1540)
- harden container registry token validation in deploy-worker action (#1536)
- probe containers/images endpoint in token validation step
- add cloudflare-containers-token input and pre-flight token validation to deploy-worker action
- **worker**: fix sentryItems type annotation and deno fmt violation from d167d09
- **worker**: add request context and extra fields to Sentry envelope items
- **worker**: fix captureSentryException → captureSentryExceptions in comments
- **worker**: apply reviewer feedback - DSN path-segment parsing, exception batching, envelope unit tests
- **worker**: address code review - push Sentry calls to promises array and validate DSN fields
- **worker**: replace @sentry/cloudflare SDK with inline envelope API in tail worker to reduce bundle size
- authenticate Docker with Cloudflare registry and pass --account-id to wrangler deploy
- workers-types regex caret handling; safe nullglob log lookup in deploy action
- remove core-js-pure@3.49.0 from allowScripts — postinstall requires node, not available in Deno Docker build
- move clearTimeout to finally block; rename lock params to lockFile
- apply review feedback — fetchLatestVersion timeout/retry, readDenoLock hard-fail, workerd check vs lock only, core-js-pure@3.49.0, examples wrangler bump
- regenerate pnpm-lock.yaml after wrangler bump to resolve frozen lockfile mismatch
- address code review feedback on cloudflare-upgrade-check.ts and ci.yml
- comprehensive Cloudflare deployment fix - bump wrangler/workerd, add retries, add CI check
- use as unknown as DurableObjectFacets to avoid TS2589 deep instantiation
- use as DurableObjectState to prevent TS2589 from outer satisfies check
- use as DurableObjectFacets to avoid TS2589 deep type instantiation
- use satisfies for DurableObjectFacets and DurableObjectState in mock
- stub DurableObjectFacets in test mock and bump wrangler to ^4.81.1
- cast DurableObjectState mock through unknown for workers-types 4.20260408.1 compat
- delete deno.lock so Deno regenerates it with wrangler 4.81.1 + workerd 1.20260409.1
- upgrade wrangler lock to 4.81.1 and allow workerd 1.20260405.1 + 1.20260409.1 scripts
- **ci**: pin npm:wrangler@^4.81.0 in all deno task wrangler* entries
- bump wrangler lower bound to ^4.81.0 and use deno task wrangler in deploy step


## [0.84.0] - 2026-04-11

### Added- **trpc**: TrpcClientService — typed client + query/createResource/createMutation helpers
- **trpc**: client.ts returns TrpcTypedClient instead of ReturnType<any>
- **trpc**: typed client interface, Zod schemas, Angular signal helpers
- **admin**: Security Overview dashboard — Cloudflare Security Dashboard integration
- **security**: prepare for Cloudflare API Shield Vulnerability Scanner integration
- implement RFC 9457 Problem Details for structured HTTP error responses
- integrate Cloudflare gradual deployments and document Node.js compat, persistent logs, static assets
- add three-environment model with dev build support for Angular DevTools
- subdomain architecture, URL config system, crawl protection, API docs landing page

### Fixed

- normalize trailing-dot hostnames in isSafeUrl and validateProxyUrl
- add *.workers.dev SSRF guard to HttpFetcher and proxy route
- add METRICS null guard in HealthMonitoringWorkflow and explicit robots.txt/sitemap.xml routes
- **record-deployment**: correct misleading comment on deployment_counter upsert
- **deploy**: make tail worker non-fatal and replace Prisma WASM with neon SQL
- resolve three deploy-worker action failures from run #24258399882
- **test**: restore missing finally block in hono-app.test.ts (parse error)
- **worker**: narrow catch to missing-binding only, return actionable message, pre-auth+CORS for browser health, add integration tests
- **worker**: true graceful degradation, /api/browser/health, pure unit tests for resolveBrowserBinding
- **worker**: wrap BROWSER binding check in getBrowserBinding(), improve error message
- **trpc**: address PR review comments
- **trpc**: address PR review comments
- eliminate command injection, add concurrency group, URL validation with timeouts, and fix ASSETS table row
- **security-overview**: address PR review — datetime format, /api prefix, remove unused computed
- **security**: address PR review feedback on API Shield scanner integration
- apply PR review feedback on problem-details factory and hono-app legacy errors
- correct log retention (24h not 30d), ASSETS binding (frontend-only), health-check URL (custom domain), and percentage description
- address code review — singular 'second' for retryAfterSecs=1, ASCII ellipsis in comment
- use configurable health-check URL input and absolute docs link in gradual-deploy workflow
- apply all 6 code review suggestions (crawl protection, pre-auth paths, swap-domain script)
- move logpush before [[routes]] and remove wildcard from custom domain pattern
- improve regex robustness in swap-domain.ts (code review feedback)


## [0.83.0] - 2026-04-08

### Added- **config-builder**: add docs, Neon saved configs, and syntax highlighting
- add standalone diagnostics tool (diag-full.ts, diag-report.ts, diag-full.test.ts)
- **config-builder**: complete configuration creation and validation feature
- complete Hono/Cloudflare integration - DO deduplication + enhanced error logging
- add Scalar and Swagger UI documentation endpoints

### Fixed

- **ci**: correct CF Pages project name adblock-compiler-docs→adblock-docs, remove broken create/verify step
- apply reviewer suggestions to mdbook.yml create step
- **ci**: improve Pages project creation verification in mdbook workflow
- restore FEATURE_FLAGS KV namespace with real ID
- comment out FEATURE_FLAGS KV namespace placeholder to unblock deployment
- move Authentication error to 10000 branch; update KB-006 doc accuracy
- split 7403 and 10000 error handling with accurate per-error guidance
- detect D1 authorization errors (7403) and provide actionable guidance
- detect D1 authorization errors (7403) and provide clearer guidance
- add project verification and better error handling for Pages deployment
- remove pages_build_output_dir from wrangler.toml to fix Worker deploy
- **prisma**: use @std/path and validate relative paths in fix-imports script
- **prisma**: fix prisma-fix-imports converting binary WASM artifacts to .ts
- **worker**: replace @std/yaml with npm:yaml to fix Wrangler bundling failure
- add --allow-read to diag:full tasks and document stdin/version reading patterns
- second review pass (sep export, CORS allowlist, OpenAPI Zod, stdin error handling)
- address code review feedback (dynamic version, shared pad, constants, emoji fix)
- **config-builder**: fix all CI build errors in ConfigBuilderComponent and CacheWarmingWorkflow
- **config-builder**: address PR review feedback
- upgrade @cloudflare/vitest-pool-workers to 0.14.2 (vitest@4.x) to fix frontend CI
- update pnpm-lock.yaml to include missing vitest/cloudflare-pool-workers entries
- remove duplicate section header comment in admin-agents.test.ts
- update admin handler tests to use AppContext pattern
- address review feedback for docs routes wildcard and auth handling
- add missing adblock-compiler-error-queue to deploy-worker action


## [0.82.0] - 2026-04-08

### Added- **diff**: add frontend diff page
- **frontend**: add TrpcClientService for type-safe Worker API consumption
- **diff**: register POST /diff route with Free tier permission
- **diff**: add POST /api/diff handler with AGTree parse-first logic
- **diff**: add DiffRequestSchema, DiffResponseSchema, and openapi types

### Fixed

- **diff**: apply reviewer feedback round 2 — parseRules, test assertions, OpenAPI route, schema fields
- **frontend**: remove localStorage from ZTA JSDoc comment to pass CI auth-storage lint
- **diff**: apply reviewer feedback on route body stream, line numbers, schema defaults, and template types
- **frontend/docs**: address review accuracy fixes from PR review 4072213521
- **frontend**: correct type-safety accuracy in docs, comments, and test headers
- **frontend**: address code review suggestions - type safety docs and storage security warning"
- **frontend**: resolve PR review comments - frontend-safe tRPC factory, doc fixes, security warning


## [0.81.0] - 2026-04-07

### Added- **agtree**: add rule conversion, batch FilterListParser validation, richer diagnostics
- add CORS proxy endpoint and local compilation mode
- scaffold KV-backed feature flag system with DI and OpenFeature extensibility

### Fixed

- add missing trailing newline in chore-frontend-bump-1.1.0.md
- **convert-rule**: add turnstileToken to schema, route body, frontend interface and API docs
- address code review feedback on proxy routes and components


## [0.80.0] - 2026-04-07

### Added- add AST Viewer page with color-coded rule tree display and on/off toggle
- **diff**: integrate AGTree into DiffGenerator for semantic rule analysis
- Prisma Hono context integration + AuthedApiClientService + AppType expansion
- **worker**: implement Cloudflare Queues error dead-lettering and durable R2 logs
- **e2e**: add comprehensive Playwright click-through test suite
- implement Cloudflare Queues for error dead-lettering and durable logs

### Fixed

- **worker**: remove orphaned persistErrorBatch, add buildErrorLogKey, fix empty-batch test
- merge latest main and resolve conflicts in error-queue handlers + fix meta routes mount
- **worker**: resolve type errors in error-queue handler and test
- resolve TS type errors in error-queue.ts and error-queue.test.ts from main merge
- resolve CI TypeScript errors in error-queue handler and tests
- resolve build errors and apply review feedback for monitoring routes
- **diff**: use exhaustive category sum for Rule Type Breakdown visibility check
- **worker**: chain .catch() on ERROR_QUEUE.send() to handle async rejections
- **lint**: remove unused Env import in error-queue.test.ts
- **worker**: address code review feedback on error queue implementation
- **container-status**: use onCleanup instead of destroyRef.onDestroy in effect
- **test**: fix failing app.component test by mocking mobile breakpoint
- **deps**: constrain pnpm-lock.yaml to only @clerk/shared 4.3.0→4.3.2 bump
- resolve mobile header overlap and hide nav tabs on small screens
- correct indentation in worker/hono-app.ts (line 585)


## [0.79.4] - 2026-03-28

### Added
## [0.79.3] - 2026-03-28

### Added- add tRPC v1 + API versioning (X-API-Version header)

### Fixed

- **trpc**: apply review comment fixes — ZTA gate, rate-limit, header order, type inference, docs
- update pnpm-lock.yaml for @trpc/client and @trpc/server deps
- **worker**: correct Turnstile/zValidator ordering in route modules; restore cache middleware
- restore /api/auth/providers to pre-auth section, add pass-through in Better Auth wildcard
- move /api/auth/providers route before Better Auth wildcard to fix HTTP 404


## [0.79.2] - 2026-03-28

### Added### Fixed

- merge main (PR #1440) into branch, resolve all conflicts
- suppress TS2353 on Deno.createHttpClient decompress option (as any cast)
- merge main into branch, resolve ci.yml smoke-test conflict
- address review feedback on compress middleware and diagnostic CLI
- address PR review — fatal validate errors, pinned CI actions, permissions
- exempt health/metrics from compress() middleware; add diagnostic CLI tooling
- scope compress() away from monitoring endpoints, add diag tool, update CI smoke tests
- replace curl -sf || echo 000 with set+e/CURL_EXIT pattern in all smoke tests
- broaden deploy-frontend trigger, add smoke tests, fix server.ts Worker-hang bug


## [0.79.1] - 2026-03-28

### Added### Fixed

- resolve production outage v0.79.0 — compress/logger scoped to routes, CORS credentials, handleDbSmoke timeout


## [0.79.0] - 2026-03-27

### Added- **agents**: Angular frontend for Agent Worker integration (issue #1383)

### Fixed

- **ci**: spy on component snackBar field directly to fix MatSnackBar injector hierarchy issue
- **ci**: resolve 4 agent frontend test failures
- **ci**: resolve all 5 test failures in agent frontend specs
- run deno fmt on og-image.svg to fix CI lint-format check
- **agents**: address round 2 review comments — fixture alignment, cancellation guard, MatSnackBarModule
- add PNG og-image as primary; keep SVG as fallback for modern crawlers
- replace broken og.tailgraph.com URLs with self-hosted og-image.svg
- **agents**: fix CI failures — TS2532 optional chain + prefer-const
- **agents**: address all PR review comments — no double-fetch, route-param reconnect, safeRandomUUID, missing specs
- revert STATIC_ASSETS rename back to ASSETS, remove pages_build_output_dir
- rename ASSETS binding to STATIC_ASSETS and restore pages_build_output_dir
- remove pages_build_output_dir from wrangler.toml to fix reserved ASSETS binding error
- move pages_build_output_dir to TOML root section (before first table header)
- revert wrangler.pages.toml approach; add pages_build_output_dir to wrangler.toml
- eliminate wrangler.toml Pages warning in mdbook deploy workflow
- apply PR review comments - brotli comment, agent diagram, auth bypass regression tests
- reorder middleware to prevent 'Unable to reach API' error


## [0.78.0] - 2026-03-27

### Added- add cache middleware to version, schemas, and config routes
- apply logger and compress middleware globally

### Fixed

- resolve 5 failing hono-middleware tests in CI
- add ExecutionContext to cache middleware tests
- address PR review comments on hono-middleware tests and docs


## [0.77.3] - 2026-03-27

### Added### Fixed

- emit empty token on expiry/error and add tokenChange unit tests
- add token emission effect to TurnstileComponent


## [0.77.2] - 2026-03-27

### Added### Fixed

- **auth**: add Content-Type: application/json to signOut and revokeOtherSessions


## [0.77.1] - 2026-03-26

### Added### Fixed

- move clearTimeout to outer Promise.race().finally() for cleaner timer cleanup
- add 10s timeout guard to /api/auth/* route handler in hono-app.ts
- add Better Auth IP config and getSession timeout guard


## [0.77.0] - 2026-03-26

### Added### Fixed

- restore .ts extensions to all generated Prisma model imports/exports
- change Prisma generator runtime from deno to cloudflare, regenerate client, add KB-004 docs


## [0.76.1] - 2026-03-26

### Added### Fixed

- expand single-line function body and inline type to satisfy deno fmt
- sort imports alphabetically and use @let to fix Angular TS2532 errors
- clear timeout in catch path, use FakeTime for timeout test, Mermaid decision tree in KB-003
- add /api/health/db-smoke + harden databaseProbe + error surfacing in UI + KB-003 docs


## [0.76.0] - 2026-03-25

### Added- Option B1 staging→production promotion pipeline (Neon branching)
- complete D1→Neon migration - port all handlers to Prisma via Hyperdrive

### Fixed

- accept postgres:// scheme in PrismaClientConfigSchema + extended health database probe
- simplify $queryRaw type cast in health.ts probe (code review)
- add prisma/migrations/** to db-migrate.yml path triggers and detect changed Prisma migrations


## [0.75.0] - 2026-03-25

### Added- add Dynamic Workers LOADER model, per-user agent dispatch, and validate fast-path (#1387)
- scaffold Cloudflare Dynamic Workers support (#1386)
- **agents**: add Prisma schema, migration, Zod schemas, agent-auth middleware, and admin endpoints for agent session tracking
- **agents**: implement Cloudflare Agents SDK integration for issue #1377

### Fixed

- revert RegExp.escape to manual replace - native impl over-escapes in Deno
- add missing runAstParseInDynamicWorker and runValidateInDynamicWorker imports to compile.ts
- address PR review — restrict agent fast-path, fix body consumption, add DynamicWorkerSafeBindings, gate LOADER stub, add Model B tests
- **ci**: use literal block scalar for yamllint run step to pass yamllint self-check
- restore handleValidate dynamic worker fast-path, fix import order, and fix yamllint trailing spaces
- add diagnostic logging for LOADER path failures in agent-routing and compile handlers
- **ci**: collapse export type to single line (deno fmt) and fix wrangler.toml TOML syntax
- **fmt**: add blank lines between export statements to satisfy deno fmt
- address review comments — response shape, validation, fallback, tests, and security fixes
- address review comments — response shape, validation, fallback, and tests
- sort named imports alphabetically in compile.ts to satisfy deno fmt
- **ci**: fix test stubbing (non-configurable stub) and workflow template literal injection
- **test**: fix TS2698/TS2352 type errors and deno fmt formatting
- **agents**: CORS/secureHeaders for /agents/*, mcp-agent scope, stale test comment
- **agents**: address all 7 PR review comments
- remove UUID_2 inconsistency in terminate session test
- address review comments -- FK relation on AgentSession, UUID validation, idempotent terminate (409), consolidated Prisma client, null userId guard, unit tests
- address code review feedback -- SQL comment characters, userId null guard removal
- **agents**: address code review feedback
- address PR #1378 review — use agents pkg, lazy-load SDK, fix comments/tests
- **ci**: make frontend version bump idempotent against duplicate tags and re-bumps (#1376)


## [0.74.0] - 2026-03-24

### Added- centralize project URLs as single source of truth via wrangler env vars (#1366)

### Fixed

- add monitoring endpoints to PRE_AUTH_PATHS to resolve permanent "Data may be stale" banner (#1370)
- resolve CI pipeline regressions blocking deploy, JSR publish, release chain, Neon cleanup, and PerformanceComponent health display (#1369)
- broaden idempotency guards to match Cloudflare's "already taken" error (code 11009) (#1367)
- **neon**: add delete trigger, workflow_dispatch, prereq check, and SHA pin to branch cleanup (#1357)
- **ci**: bypass branch protection via PR flow; drop broken PDF steps (#1362)
- **frontend**: Angular 21 engine manifest not set — Cloudflare error 10021 on deploy (#1360)
- **ci**: run frontend-build whenever worker or compiler files change (#1356)
- **ci**: skip Neon branch workflows for Dependabot PRs (#1339)


## [0.73.0] - 2026-03-23

### Added

- Add real-time Cloudflare Container status widget (#1316)
- **observability**: wire tail worker + Sentry server-side SDK to frontend Worker (#1311)
- Complete Better Auth migration — drop Clerk, activate GitHub OAuth + admin plugin, add 2FA/session UI (#1282)

### Fixed

- remove stale `environment = "local"` from frontend service binding (#1317)
- **docker**: update local dev config for split-worker frontend architecture (#1309)
- unblock CI lint and Docker/Angular SSR build on main (#1308)
- **ci**: resolve mdbook.yml workflow failures and supply-chain hardening (#1284)


## [0.72.0] - 2026-03-22

### Added

- tighter Hono + Better Auth + Neon + Cloudflare integration (#1273)
- migrate database to Neon PostgreSQL with Better Auth + Prisma (#1257)

### Fixed

- rename misleading 401 test, fix two_factor migration conflict, and harden Neon Branch workflow (#1278)
- address PR #1273 review comments — ZTA hardening, telemetry, schema, rate limits (#1275) (#1277)
- WorkerConfigurationError class, improved error handler, pin pnpm version (#1268)
- address Better Auth integration gaps (#1263) (#1269)


## [0.71.1] - 2026-03-22

### Added### Fixed

- apply deno fmt to prisma.config.ts (move || to end of line)
- apply review suggestions to prisma.config.ts and prisma/prisma.config.ts
- add node:process import to prisma.config.ts to fix deno lint error
- move prisma.config.ts to project root to fix database migration CI failure


## [0.71.0] - 2026-03-22

### Added- replace local JWT auth with Better Auth (#1241)

### Fixed

- resolve CI failures — fix TS2322 type error and Deno formatting in cloudflareApiService.ts
- remove unused _sessions/_accounts variables in admin-users.test.ts (TS6133)
- health auth status is 'down' when better-auth secret set but DB missing
- resolve CI failures from Better Auth migration (lint, type errors, missing methods)
- apply second-pass review comments on Better Auth (#1251)
- address code review feedback (PII logging, doc clarity, cookie-auth fallback)
- address review comments from PR #1250 (Better Auth improvements)
- replace disallowed secrets context in step if-conditions in db-migrate.yml


## [0.70.2] - 2026-03-21

### Added### Fixed

- apply deno fmt formatting to prisma-fix-imports.ts
- narrow catch to NotFound; fix idempotency doc wording
- remove --sloppy-imports by post-processing Prisma .js specifiers to .ts
- use deno task check/test in release.yml to fix --sloppy-imports for worker tests


## [0.70.1] - 2026-03-21

### Added### Fixed

- resolve CI failures — formatting, TypeScript readonly, and pnpm lockfile


## [0.70.0] - 2026-03-21

### Added- migrate prometheus metrics handler to CloudflareApiService + add queryAnalyticsEngine
- Phase 3 Hono migration - OpenAPIHono, timing, zValidator, ETag, RPC client
- adopt cloudflare TypeScript SDK for deployment & automation tooling
- add cloudflare TypeScript SDK integration via CloudflareApiService

### Fixed

- apply second PR review round — shared OpenAPI constant, middleware order, compile removed from RPC client, docs, test rename
- apply PR review comments — double /api prefix, CORS list, OpenAPI comment, 501 guard, test
- wire Cloudflare Containers for local dev and production request routing


## [0.69.2] - 2026-03-20

### Added### Fixed

- add hono to package.json and pnpm-lock.yaml to resolve wrangler bundling failure
- use string literal in dynamic import for JSR compatibility


## [0.69.1] - 2026-03-20

### Added### Fixed

- remove unused ContainerCompileRequest type alias (TS6196)
- apply reviewer feedback on container config changes
- address all five Cloudflare container configuration issues


## [0.69.0] - 2026-03-20

### Added- ConfigurationManager abstraction (#1208)

### Fixed

- deno fmt formatting on schemas.ts, poc-assets.test.ts, queue-cancel.test.ts (CI fix)
- CI failures - reorder transformations (Deduplicate before Compress) and apply deno fmt
- address ConfigurationManager review feedback - env precedence, validation guards, CLI re-validation
- resolve CI failures (missing SourceType import, IConfigurationSource type annotation, z.record key type, deno fmt)
- address ConfigurationManager PR review feedback with tests and docs


## [0.68.2] - 2026-03-19

### Added### Fixed

- update deno.lock for @cloudflare/workers-types 4.20260317.1
- update pnpm-lock.yaml to match @cloudflare/workers-types ^4.20260317.1
- use path reference for @cloudflare/workers-types to resolve Deno LSP false positives in worker.ts
- address PR review comments on Docker pipeline
- fix Docker build/publish pipeline and update all dependencies


## [0.68.1] - 2026-03-19

### Added### Fixed

- suppress no-this-alias lint error in filter-parser spec
- **test-helpers**: makeInMemoryKv getWithMetadata mirrors get() contract
- **tests**: refactor filter-parser Worker stub and freeze Date.now in metrics tests


## [0.68.0] - 2026-03-19

### Added- raise Codecov coverage gate to 80% and add missing test files
- add database migration workflows (backend-agnostic, all-or-nothing)

### Fixed

- replace ternary statements with if/else in dashboard spec to satisfy no-unused-expressions
- accurate threshold comment in codecov.yml and add unicode compress test
- address review feedback on db-migrate workflow and validator
- add SSR platform short-circuit to guards; change validation to RenderMode.Client
- NG0203 — replace dynamic guard imports with static imports in app.routes.ts


## [0.67.1] - 2026-03-19

### Added### Fixed

- log collect() errors, update stale comment, add --jobs=1 to prevent fetch races
- re-register built-in Prometheus metrics after test registry clear
- serialize fetch-mocking tests with t.step(), fix Promise.all rejection isolation, stub JWKS fetch in clerk-jwt tests


## [0.67.0] - 2026-03-18

### Added- **tests**: add frontend schema validation tests and middleware tests
- **tests**: add 157 new unit tests across worker handlers and utilities

### Fixed

- **deps**: remove npm lockfiles, upgrade wrangler to 4.75.0, document pnpm+Deno convention
- address PR review - correct JSDoc table fallback and Phase 2 re-enable instructions
- **tests**: address PR review comments — deterministic tests, hard codecov gate, correct JWT signing
- wire Sentry end-to-end and disable Grafana/OTel plumbing (Phase 2 deferred)
- **codecov**: add flag_management, checkout, remove silent failures


## [0.66.1] - 2026-03-18

### Added### Fixed

- **tail**: add nodejs_compat flag for @sentry/cloudflare node:async_hooks


## [0.66.0] - 2026-03-18

### Added- **sentry**: audit and enhance Sentry integration across all workers and frontend (#1155)

### Fixed

- add missing unit tests for sentry.ts, response.ts, and cors.ts
- **tail**: correct ExportedHandler and TraceItem cast types for withSentry
- **sentry**: address all PR review comments - lazy import, flush, schema, docstrings
- **tests**: suppress Deno leak detection on mixed-outcome tail test
- refactor tail.ts Sentry init to use withSentry public API
- **sentry**: address PR review feedback — anchor typo, placeholder token, conditional handlers, tag cardinality, optional environment
- **zta**: add rate limiting to pre-auth sentry-config meta routes


## [0.65.0] - 2026-03-17

### Added- secure all API endpoints by tier, remove AuthService, fix sign-up/sign-in UX, add profile page, ZTA periodic re-validation
- remove legacy ADMIN_KEY system, add bootstrap-admin, shorten JWT to 1h (ZTA)

### Fixed

- prefix unused authContext param with _ in routeAdminStorage to fix deno lint/typecheck CI failures
- canonicalize email identifiers, fix revalidation interval, move admin/storage auth telemetry to router
- replace removed verifyAdminAuth with checkRoutePermission in admin.ts; wire up new auth handlers in router.ts
- narrow /api meta route guard; return real 404 for server-handled paths in serveStaticAsset
- run deno fmt on health.ts and workflow.ts to fix CI lint-format failure
- address PR review — consolidate duplicates, harden Turnstile gating on ast/parse, validate, ws/compile
- enforce Admin tier on /admin/storage/* and add bootstrap single-use guard


## [0.64.0] - 2026-03-16

### Added- add local auth + admin user management endpoints to OpenAPI spec and fix role docs
- ZTA token validation, per-user API access control, usage tracking, and api_disabled flag
- route permission registry + admin user management + rename guest→user role
- local JWT auth bridge — signup/login/me/change-password + role registry + ZTA auth fixes

### Fixed

- move dynamic UPDATE SQL to variable to satisfy ZTA lint check
- replace Prisma ORM with raw D1 queries in local auth handlers
- resolve D1 mock type errors after workers-types update (withSession/meta/raw overload)
- resolve CI type check and test failures for local JWT auth
- remove unused signal import from auth-facade.service.spec.ts
- address PR review comments — type safety, error handling, clamping, navigation, and tests
- resolve merge conflicts in local-auth handlers
- regenerate cloudflare-schema.yaml with BearerAuth security scheme
- regenerate cloudflare-schema.yaml with BearerAuth security scheme
- local-auth signup parse with LocalUserPublicSchema, /auth/me consistent shape, OpenAPI BearerAuth on auth endpoints
- apply second round of review feedback — schema alignment, idempotent migration, auth envelope, doc examples
- resolve CI failures on local JWT auth branch
- apply all PR review feedback — security events, tier validation, Clerk mode guard, /admin/storage routing, response shape alignment
- add missing .ts extensions to relative imports in worker/services
- align api_disabled TTL to 90 days and use userId in route permission check
- resolve CI lint and type errors in admin-users, local-jwt, password


## [0.63.0] - 2026-03-16

### Added- **testing**: unified testing strategy — 52 new tests, shared fixtures, docs (#1118)


## [0.62.5] - 2026-03-15

### Added### Performance

- fix CLS, font preloads, immutable cache headers, browserslist (#1113)


## [0.62.4] - 2026-03-15

### Added### Fixed

- move inject(ClerkService) before await to prevent NG0203 crash (#1108)


## [0.62.3] - 2026-03-15

### Added### Fixed

- guard MetricsStore and httpResource() against SSR prerender crash (#1099)


## [0.62.2] - 2026-03-15

### Added### Fixed

- blank page — expand CSP for Clerk/Sentry, SPA routing fallback, harden SSR prerender guards (#1097)


## [0.62.1] - 2026-03-15

### Added### Fixed

- **ci**: add 3-attempt retry to database migrations step (#1093)


## [0.62.0] - 2026-03-15

### Added- **observability**: extensible IDiagnosticsProvider registry + Sentry CF Worker wiring

### Fixed

- extend ci.yml pull_request if-conditions to include workflow_dispatch
- trigger CI after creating auto-version-bump PR
- **ci**: resolve lint, format, and type-check failures from observability PR
- deno fmt formatting in CompositeDiagnosticsProvider.test.ts
- **observability**: address review comments - SENTRY_RELEASE, flush guard, ctx.waitUntil, tests, docs


## [0.61.0] - 2026-03-15

### Added- Phase 3 observability — Sentry RUM, source map CI, Logpush docs (#1071)"
- wire /metrics/prometheus + diagnostics provider into worker.ts fetch handler
- 100% extensible observability — CompositeDiagnosticsProvider, factory, Prometheus registry, tests
- scaffold observability improvements (Phase 1 + Phase 2)

### Fixed

- apply review feedback — release in Sentry.init, misleading SSR comment, upgrade @sentry/angular to v10 (Angular 21)"
- add explicit permissions and --release flag to sentry-sourcemaps workflow
- apply all PR review feedback (type-safety, import style, ZTA telemetry, docs accuracy)
- resolve CI failures — deno fmt and esbuild @sentry/cloudflare import


## [0.60.0] - 2026-03-15

### Added- **admin**: wire 27 admin API routes into router.ts
- **admin**: add remaining 8 UI panel components and fix D1 type compat
- **admin**: add 27 API handlers and 4 UI panel components
- **admin**: add role middleware, dynamic registries, and analytics events
- **admin**: add 5 service-layer modules for admin system
- **admin**: add Zod validation schemas for all admin trust boundaries (#1054)
- add mdbook last-updated preprocessor and build timestamp
- **admin**: add OpenAPI endpoint auto-discovery script (#1054)
- **admin**: add Material sidenav shell with 14 lazy-loaded panel routes (#1054)
- **admin**: add ADMIN_DB binding and initial schema migration (#1054)
- add ClerkAppearanceService to theme Clerk widgets with M3 design system

### Fixed

- **admin**: add takeUntilDestroyed to all 12 admin panel components
- **admin**: address 9 PR review comments — schema, services, docs, frontend
- **admin**: format admin-logger and admin-registry-service test files
- **tests**: address code review feedback on storage, observability, and dashboard specs
- **admin**: resolve CI failures — Deno lint, Angular ESLint, ZTA lint
- **ci**: comment out unprovisioned ADMIN_DB binding to fix Workers Builds check
- short-circuit mountSignIn when clerkInstance null; fix localStorage leaks in clerk-appearance spec
- **ci**: replace PLACEHOLDER database_id in wrangler.toml and harden CI placeholder check
- apply deno fmt single-quote formatting to mdbook-last-updated.ts
- **admin**: use z.record(z.string(), z.unknown()) for Zod v4 compat
- **frontend**: deterministic Clerk mock, doc accuracy, and auth error messaging
- narrow D1 transient error detection, accurate router comment, add retry semantics tests
- **frontend**: ClerkService configLoadFailed recovery + sign-in/up transient error messaging
- apply deno fmt to clerk-webhook.ts (CI format check)
- address review comments - scope catchError, transient D1 retry, zero-delay test
- **frontend**: add configLoadFailed signal to ClerkService and pathMatch: 'full' to alias redirects
- harden Clerk auth subsystem (6 issues)
- **frontend**: Clerk auth links not visible & /log-in blank page (#1047)


## [0.59.0] - 2026-03-14

### Added- **auth**: add CLI auth switches, OpenAPI endpoints, and Postman collection (#1002)

### Fixed

- enforce auth mutual exclusion and stricter API key regex
- quote OpenAPI UserApiKey description to fix YAML parse error
- address PR review feedback on auth CLI flags, OpenAPI/Cloudflare schemas, and Postman collection


## [0.58.0] - 2026-03-14

### Added- **zta**: Phase 4 — PR template, CI lint, and security policy (#1025)
- **zta**: Phase 3 — frontend ZTA hardening with Zod validation (#1025)
- **zta**: Phase 2 — auth gates, rate limiting, and security telemetry (#1025)
- **zta**: Phase 1 — centralized CORS with origin allowlist (#1025)
- **plugins**: Phase 4 — dependency resolution, topological sort, plugin discovery
- **plugins**: Phase 3 — AGTree parser plugin adapter (#992)
- **plugins**: add SubsystemBridge for Phase 2 wiring (#992)
- **plugins**: unified plugin architecture — Phase 1 core API (#992)

### Fixed

- **ci**: exclude comments from secrets lint, add missing CompileResponse fields (#1025)
- **security**: address code review findings on CORS and CI lint (#1025)
- **zta**: address PR review comments — CORS prefixes, WebSocket 101, schema alignment, batch API contract
- **ci**: tighten D1 lint to only flag string interpolation (#1025)
- **ci**: resolve lint and ZTA lint failures (#1025)
- **ci**: remove Deno-only discoverPlugins from publish exports
- address all 5 PR review comments on plugin architecture (#1037)
- add unregisterTransformation to SubsystemBridge for full rollback
- address code review findings on plugin architecture (#1037)


## [0.57.0] - 2026-03-14

### Added- add Zod runtime validation to Clerk auth trust boundaries (#1012)

### Fixed

- **test**: use AuthScope.Admin enum in auth-admin.test.ts
- resolve TS2345 type error and address code review findings
- address PR review feedback on Zod trust boundary validation


## [0.56.5] - 2026-03-14

### Added### Fixed

- make user_email nullable in validateApiKey result type
- use if ! pattern to make D1 migration error handling deterministic under set -e
- automate D1 migrations via wrangler migration tracking (#1030)


## [0.56.4] - 2026-03-14

### Added### Fixed

- address review comments on clerk-webhook upsert (atomic SQL, timestamps, version comment)
- replace Prisma D1 client with native D1 SQL in webhook handler (#1022)


## [0.56.3] - 2026-03-14

### Added### Fixed

- prevent emailVerified corruption on user.updated with no email
- correct D1 migration table name from User to users (#1018)
- allow Clerk webhook users without email address (#1017)


## [0.56.2] - 2026-03-13

### Added### Fixed

- validate tier/role from Clerk public_metadata to prevent privilege escalation
- replace Webhook.prototype stub with _testVerify injection in webhook tests
- address review comments - isLoaded signal, webhook test 503 path, sloppy-imports scope
- define import.meta.url for Cloudflare Workers bundled context
- upgrade Prisma to 7.5.0 and add @prisma/client to package.json
- resolve 3 CI failures on fix/clerk-auth-bugs-1010
- update clerk-webhook signature, wrap PrismaClient init in try/catch, update tests to use D1 mock
- resolve Clerk auth integration bugs (#1010)


## [0.56.1] - 2026-03-13

### Added### Fixed

- **postman**: resolve Postman collection issues from review comments


## [0.56.0] - 2026-03-13

### Added- **auth**: implement returnUrl query param behavior in SignInComponent
- **env**: update .env subsystem with all new vars and direnv-first rule
- **auth**: add extensibility improvements — scope registry, tier config, IAuthProvider, requireScope
- **frontend**: add API key management UI
- Phase 5-6 API key CRUD handlers and CF Access admin middleware
- Phase 4 Angular Clerk integration — ClerkService, auth components, guards, interceptor
- wire auth middleware to protected routes (Phase 3)
- **auth**: add Clerk webhook handler, user service, and Prisma schema updates (Phase 2)
- add Clerk auth integration - Phase 1

### Fixed

- **auth**: use fallbackRedirectUrl in mountSignIn; fix CONTRIBUTING.md formatting
- **auth**: add tier validation tests, fix CLERK_PUBLISHABLE_KEY secret/var docs
- **frontend**: expose Number to ApiKeysComponent template
- **auth**: apply PR review feedback - Angular 21 rules, response shapes, tier validation, docs
- **auth**: resolve Clerk userId for API key management
- **frontend**: resolve Clerk TypeScript compilation errors
- **deps**: update pnpm lockfile for jose 6.2.1
- **worker**: prevent pg bundling during Workers build


## [0.55.0] - 2026-03-12

### Added- Lighthouse CI — Deno-native summary + pnpm integration

### Fixed

- merge main into branch — resolve lighthouse.yml conflict, keep pnpm/Deno/URL-guard/Deno-summary approach
- merge main into branch — resolve lighthouse.yml conflict, add clarifying comment to lhci step
- resolve merge conflicts with main — incorporate workflow comment, if condition fix, --config flag, and doc alignment
- correct deno fmt issues in PULL_REQUESTS/996/body.md (20 trailing spaces on row 12, add trailing newline)
- apply deno fmt to PULL_REQUESTS/996/body.md (table padding, italic syntax)
- address PR review feedback on workflow trigger, URL guard, pnpm detection, and score floor


## [0.54.1] - 2026-03-11

### Added### Fixed

- **docs**: replace mdbook-pdf with headless Chromium PDF generation
- update mdbook-pdf to v0.1.13 with new platform-specific asset URL


## [0.54.0] - 2026-03-11

### Added- add mdbook-pdf PDF generation to documentation build pipeline

### Fixed

- remove merge-multiple from download-artifact to match per-dir loop
- remove manual Chromium install — use pre-installed runner browser
- configure mdbook-pdf to output adblock-compiler.pdf directly


## [0.53.0] - 2026-03-10

### Added- add tar.gz/zip compression to release artifacts (Option B)

### Fixed

- upload compressed/* so archives land at artifact root, not in subdirectory


## [0.52.1] - 2026-03-10

### Added### Fixed

- resolve IPv6 bracket handling and container-server auth in tests
- resolve TS2352 type assertion error in CloudflareQueueProvider
- address 9 follow-up review comments from PR #962
- address 18 code review findings across security, correctness, and robustness


## [0.52.0] - 2026-03-10

### Added- **api-docs**: add all endpoints + JSON syntax highlighting

### Fixed

- **api-docs**: remove unnecessary escape in regex character class


## [0.51.0] - 2026-03-10

### Added- add validate-rule, rule set CRUD, and notify endpoints (#912)

### Fixed

- remove placeholder RULES_KV binding that broke Cloudflare preview builds
- **ci**: regenerate cloudflare schema, add preflight task and pre-push hook
- address code review feedback — rate limit via JsonResponse, accurate total in rule list, clearer strict mode comment
- address all review feedback from PR #947
- **ci**: use single quotes in codecov.yml to pass deno fmt check
- **ci**: add codecov.yml and expand turnstile coverage tests
- **turnstile**: add load-error fallback, gating unit tests, and refine constants
- **turnstile**: add platform guard and timeout to app initializer
- **turnstile**: use correct ToastType 'warning' instead of 'warn'
- **turnstile**: async bootstrap, submit guard, and reactive disabled binding
- **frontend**: remove stale getRouteAnimationData test from app.component.spec.ts
- **frontend**: eliminate navigation flicker on tab switch (#942)


## [0.50.1] - 2026-03-10

### Added### Fixed

- exclude ideas/ folder from deno fmt check in CI


## [0.50.0] - 2026-03-10

### Added- **ui**: add browser rendering visual cues to compiler UI
- browser rendering integration

### Fixed

- update compiler component spec for FormGroup-based URL array
- resolve CI failures in browser rendering integration
- resolve CI failures in browser rendering integration
- align browser rendering docs, schemas, and worker handlers with implementation
- throw on useBrowser without browser deps; sanitize screenshotPrefix


## [0.49.2] - 2026-03-10

### Added### Fixed

- address Copilot code review comments from PR #925
- expose CF_WEB_ANALYTICS_TOKEN secret in deploy job
- address PR review comments — non-blocking Turnstile init, sed portability, safe analytics tag removal, regression tests
- repair Cloudflare Turnstile token plumbing and Web Analytics placeholder


## [0.49.1] - 2026-03-09

### Added### Fixed

- **ci**: move 2>&1 outside retry_command to properly capture stderr
- **ci**: add retry logic for transient Cloudflare API errors in mdbook workflow
- handle transient Cloudflare API 503 errors in mdbook Pages project check


## [0.49.0] - 2026-03-09

### Added- wrap QueueChartComponent and toasts in mat-card for Material Design consistency
- add mdbook-mermaid preprocessor for Mermaid diagram rendering
- add mdbook docs link and fix /docs unthemed page issue

### Fixed

- address review comments on mdbook-mermaid integration
- apply deno fmt formatting to worker.ts if-condition at line 3716
- address PR review feedback on /docs redirect and docs URL coupling
- sync autoRefreshEnabled state and convert validation ngModel bindings for SSR safety
- enable SSR/SSG for home and compiler routes (#914)
- address reviewer feedback on CLI gaps and transformation ordering
- reconcile CLI args, transformation types, and API documentation gaps


## [0.48.1] - 2026-03-09

### Added### Fixed

- rename scorecard workflow to lowercase, add contents:read, pin action SHAs
- remove slow types and enforce via CI (#880)


## [0.48.0] - 2026-03-09

### Added- wire TransformationHookManager into pipeline, add onCompilationStart event, and expose hooks as public API
- auto-generate Postman collection from OpenAPI spec with CI sync enforcement

### Fixed

- apply 6 code-review fixes to hooks wiring (composition, targeted listeners, auto-wire, WorkerCompiler onCompilationStart, fast-path loop)
- add query param support and bound $ref recursion depth in Postman generator
- consolidate OpenAPI specs and update documentation references


## [0.47.2] - 2026-03-09

### Added### Fixed

- add missing @eslint/js dependency to resolve CI frontend lint failure


## [0.47.1] - 2026-03-09

### Added### Fixed

- regenerate pnpm-lock.yaml to match updated dependency versions
- remove unnecessary shell: bash from Windows longpaths step
- enable Git long path support on Windows in release workflow


## [0.47.0] - 2026-03-09

### Added- add comprehensive CLI switches for transformation control, filtering, output, and networking

### Fixed

- apply code review feedback - toNum validation, include/include-from symmetry, stdout stderr routing, transformation validation, format warning, downloaderOptions test


## [0.46.2] - 2026-03-08

### Added### Fixed

- remove duplicate [[containers]] block in wrangler.toml, use correct Dockerfile.container
- **ci**: improve D1 migration error message for authentication failures
- **ci**: address mdbook.yml review feedback
- **ci**: resolve workflow issues with publish/deploy skip and mdbook failures


## [0.46.1] - 2026-03-08

### Added### Fixed

- use explicit needs.ci-gate.result check in publish and deploy jobs
- exclude large generated/external files from deno fmt to fix CI timeout
- handle cancelled jobs gracefully in ci-gate


## [0.46.0] - 2026-03-08

### Added- create enhanced favicon matching header branding (Deep Ink + Electric Amber)

### Fixed

- update Docker action SHA pins to fix CI timeout on BuildKit pull
- update home.component.spec.ts to expect new healthColor value
- exclude postman/ from deno fmt to fix slow Format Check CI job
- ci-gate condition to always() && !cancelled()
- ci-gate - handle cancelled workflow runs gracefully


## [0.45.1] - 2026-03-08

### Added### Fixed

- narrow `ns` correctly in agent-routing.ts to resolve TS18048 errors


## [0.45.0] - 2026-03-08

### Added- add OpenAPI specs and Postman workspace configuration

### Fixed

- address Postman collection review feedback (pullrequestreview-3910962231)
- apply review feedback - fix invalid URLs, placeholders, spelling, and script format
- redact private keys and JWT tokens in cloudflare-openapi.json to fix Trivy security scan
- apply review feedback to Postman/OpenAPI collection files


## [0.44.2] - 2026-03-08

### Added### Fixed

- guard against non-DO bindings and NaN limit in deployment history


## [0.44.1] - 2026-03-08

### Added### Fixed

- regenerate cloudflare-schema.yaml to match updated VersionResponse/DeploymentHistoryResponse schemas (#828)


## [0.44.0] - 2026-03-08

### Added- validate openapi.yaml in CI and update Postman collection with new endpoints
- update Cloudflare container integration with @cloudflare/containers
- **worker**: add Playwright MCP agent via @cloudflare/playwright-mcp (#760)

### Fixed

- replace agents SDK with native DO routing to avoid Node built-ins
- remove incorrect format: date-time from SQLite deployedAt fields in VersionResponse and DeploymentInfo schemas
- update AdblockCompiler comment to accurately describe DO request forwarding
- **review**: apply PR review feedback - type safety, pinned deps, wrangler cleanup
- **wrangler**: add nodejs_compat flag to fix CI worker build errors


## [0.43.1] - 2026-03-08

### Added### Fixed

- regenerate package-lock.json to include wrangler@4.71.0 and dependencies
- use --frozen-lockfile --ignore-workspace in Docker pnpm install
- update Dockerfile and .dockerignore to use pnpm for root dependencies


## [0.43.0] - 2026-03-08

### Added- add JSDoc to all undocumented source files and integrate deno doc API reference with mdBook
- CI pipeline enhancements
- verify worker build on pull requests (#780)

### Fixed

- add wrangler as root devDependency to fix Cloudflare deployment
- narrow run_migration() idempotency check to exact D1 message (#790)
- narrow run_migration() error suppression to exact D1/Wrangler idempotency messages (#789)
- skip wrangler custom build when frontend dist already exists (#778)
- exclude pnpm-lock.yaml from deno fmt check
- clean up wrangler.toml build comment per code review
- use pnpm run build:worker in wrangler.toml to fix Cloudflare Workers build
- add --legacy-peer-deps to wrangler.toml frontend npm ci to fix Cloudflare Workers build
- add pnpm-lock.yaml to fix frontend/worker builds in CI


## [0.42.0] - 2026-03-07

### Added- replace npm/npx with pnpm/deno-native equivalents in deno.json and CI deploy

### Fixed

- address PR review - lockfile, duplicate CI jobs, Pages deploy, and docs
- resolve pnpm version conflict and deno fmt failures in CI
- derive curl example URL from request origin in fallback HTML pages


## [0.41.0] - 2026-03-07

### Added- integrate Cloudflare Tail Worker (adblock-compiler-tail) into CI deploy pipeline

### Fixed

- remove non-idempotent TAIL_LOGS KV namespace create from CI


## [0.40.1] - 2026-03-07

### Added### Fixed

- resolve CI failures in JSR publish and Cloudflare deploy


## [0.40.0] - 2026-03-07

### Added- add Cloudflare Pipelines and log sink integrations (#710) (#749)


## [0.39.0] - 2026-03-07

### Added- add Angular frontend CI gate, artifact reuse, and change detection (#615)

### Fixed

- **ci**: pass needs JSON via env var to fix ci-gate Python heredoc stdin conflict
- address review comments on CI workflow - Python heredoc, detect-changes simplification


## [0.38.0] - 2026-03-07

### Added- integrate Codecov for frontend vitest coverage
- integrate mdBook for project documentation site (#728)

### Fixed

- exclude mdBook content from deno fmt check (#734)
- gate frontend Codecov upload to main pushes only
- exclude README.md from deno fmt check (#732)
- apply PR review feedback for mdBook integration


## [0.37.6] - 2026-03-07

### Added### Fixed

- add trailing newline to DESCRIPTION.md to pass deno fmt check (#726)


## [0.37.5] - 2026-03-07

### Added### Fixed

- address PR review comments — validate endpoint fixes and queue service URL corrections
- update queue.service.spec.ts to use correct URL paths after queue service refactor
- normalize /api prefix in worker to resolve frontend API 404s (#721)


## [0.37.4] - 2026-03-06

### Fixed

- use deno task wrangler:deploy to resolve missing esbuild module


## [0.37.3] - 2026-03-06

### Fixed

- resolve CI #1526 stuck deployment — remove invalid --env=\"\" from wrangler deploy and add timeout


## [0.37.2] - 2026-03-06

### Fixed

- update deno.lock for wrangler 4.71.0, add workerd@1.20260305.0 to allowScripts, pin npx wrangler@4.71.0 in CI
- update wrangler to 4.71.0, fix esbuild allowScripts, fix wrangler.toml environments and CI deploy command


## [0.37.1] - 2026-03-06

### Fixed

- **fmt**: exclude issues/ directory from deno fmt check
- add missing npm deps (zod, @opentelemetry/api, @adguard/agtree) so wrangler can bundle the worker
- use regex to parse HTTP status code from D1 error message for precise permission error detection
- remove dangling git submodule, improve deployment error handling, suppress wrangler Pages warning
- address code review feedback and prevent recurring Cloudflare deploy failure
- add explicit JSR type annotations to schemas to resolve slow types errors


## [0.37.0] - 2026-03-06

### Added

- integrate TailwindCSS v4 with Angular Material Design via `@theme inline` bridge
- expand Zod validation coverage with new schemas and integrations

### Fixed

- resolve CI failures — fmt GRAPHQL_INTEGRATION.md and regen cloudflare schema
- address review feedback on postbuild script and worker asset fetching
- apply PR review suggestions from review thread #3900928199
- resolve dashboard not displaying by generating index.html from index.csr.html
- remove duplicate dev server entry in openapi.yaml and fix README badge link path
- move Deduplicate before Compress in ConfigurationValidator test to satisfy ordering validation
- align markdown table columns in src/storage/README.md for deno fmt
- resolve CI failures - type error in refine path and deno fmt violations


## [0.36.0] - 2026-03-05

### Added

- add automated branch cleanup GitHub Actions workflow


## [0.35.0] - 2026-03-05

### Added

- add PostgreSQL admin endpoints and backend health check (#587)
- add D1 to PostgreSQL migration handler (#587)
- add API key authentication via Hyperdrive (#587)
- add HyperdriveStorageAdapter for PlanetScale PostgreSQL (#587)
- add Zod validation schemas for database models (#587)
- Phase 1 PlanetScale PostgreSQL setup (#587)

### Fixed

- resolve CI failures - format 7 files and fix RFC 4122 UUID in schema tests
- resolve CI format check and test failures
- address PR review comments for Phase 1 PostgreSQL + Hyperdrive setup
- **frontend**: resolve all Angular ESLint warnings for architecture modernization


## [0.34.0] - 2026-03-05

### Added

- **frontend**: Redesign with Deep Ink + Electric Amber design system
- Add SEO and AEO optimizations for frontend

### Fixed

- **tests**: align SSE spec API_BASE_URL with production browser config ('/api')
- **frontend**: tighten dark-theme selectors, fix shadow token, improve SSE test cleanup
- align index.html meta description with home route metaDescription
- **tests**: clear fake timers before restoring real timers in sse.service.spec afterEach
- **frontend**: apply PR review feedback - favicon, CSS tokens, fonts, theme, spinner
- address PR review feedback on SEO/AEO optimizations
- address test mock/timer leaks and SSE URL contract issues
- use RenderMode.Client for home and compiler routes to prevent SSR crash


## [0.33.2] - 2026-03-05

### Added### Fixed

- use inject() function in AppTitleStrategy to satisfy prefer-inject lint rule
- remove dead hasFileExtension and duplicate serveWebUI overload in worker
- import REQUEST from @angular/core not @angular/ssr
- merge main into branch to resolve conflicts
- remove unused _env param from serveWebUI
- merge main, resolve conflicts, consolidate env.ASSETS into serveStaticAsset()
- WCAG accessibility improvements across Angular SSR frontend
- remove unused hasFileExtension function and fix spelling
- resolve merge conflicts between fix/api-html-404 and main
- remove unused API_DOCS_REDIRECT import from worker/router.ts
- remove unused API_DOCS_REDIRECT import from router.ts
- hoist SPA_SERVER_PREFIXES to module constant, use Boolean(env.ASSETS) for explicit boolean
- narrow /admin SPA exclusion, clean router.ts redirect, update JSDoc, add routing E2E tests
- apply review feedback for /api redirect, SPA fallback, and router.ts sync
- scope SPA fallback, gate handleInfo redirect on ASSETS, sync router.ts
- resolve landing page issues #622 #623 #624
- redirect /api to Angular /api-docs route and add SPA fallback
- add tests for API_BASE_URL factory and extract hasFileExtension helper
- address review comments on SPA fallback and SSR API base URL
- restore Angular routing on Cloudflare Workers deployment


## [0.33.1] - 2026-03-04

### Fixed

- apply deno fmt to failing markdown files


## [0.33.0] - 2026-03-04

### Added

- Incorporate Angular Material Design into 4 Angular frontend components (`SkeletonCardComponent`, `SkeletonTableComponent`, `SparklineComponent`, `TurnstileComponent`) — all now use `mat-card appearance="outlined"` wrappers; skeleton components add a `mat-progress-bar` in buffer mode as a loading indicator

### Fixed

- add standalone: true to SparklineComponent, SkeletonTableComponent, TurnstileComponent


## [0.32.2] - 2026-03-04

### Fixed

- apply PR review suggestions — required BootstrapContext, remove MatToolbarModule, add aria attrs
- configure MatIconRegistry to use material-symbols-outlined font set
- change Docker cache mode from max to min to fix 502 on layer blob write
- restore original design — gradient theme, horizontal nav, white card layout
- pass BootstrapContext to bootstrapApplication in main.server.ts


## [0.32.1] - 2026-03-04

### Fixed

- exclude skills/ and .claude/ from deno fmt and deno lint


## [0.32.0] - 2026-03-04

### Added

- **compiler**: Complete phases 6-8 — API docs, logging wiring, and changelog
- **compiler**: Add async/batch compilation modes, queue stats panel, and supporting services

### Fixed

- **review**: apply 7 PR review comments — QueueJobStatus, TERMINAL_JOB_STATUSES, not_found grace, cancelled handling, API path alignment
- **specs**: update service specs to match main's refactored service APIs
- **api-docs**: add MatFormFieldModule and MatInputModule to fix mat-form-field control error in tests
- **api-docs**: fix FormsModule wrong import and update spec assertions for Phase 6 endpoint groups
- **compiler**: address PR review comments — lint error, mat-card structure, chip color, test assertions, and not_found grace period


## [0.31.0] - 2026-03-03

### Added

- Add exception handling, validation, logging & diagnostics

### Fixed

- apply review feedback - logging, SSE, tsconfig, standalone, SQL guard
- align rxResource API, TypeScript types, and siteKey input with main
- rename rxResource loader to stream for Angular 21 compatibility


## [0.30.0] - 2026-03-03

### Added

- **frontend**: Implement 14 enhancement items with CI/Docker updates
- complete Angular migration gaps - MetricsService, a11y, animations, cleanup
- **frontend**: Phases 3-7 — additional pages, services, responsive sidenav, CI, docs
- **frontend**: Phase 2 — core pages with live data, SSE streaming, drag-and-drop
- Phase 1 - scaffold Angular frontend migration (#559)

### Fixed

- remove step-level secrets check from Claude workflows, fix version-bump branch conflict
- add push trigger to Claude workflows to prevent validation errors
- resolve CI workflow failures for Cloudflare deploy
- exclude frontend/ from deno lint/fmt, remove missing public/ from Dockerfile
- resolve all CI failures — exclude frontend from deno lint/fmt, fix Dockerfile, sync package-lock, add cov_profile to gitignore
- remove cov_profile artifacts and fix Dockerfile .npmrc baking


## [0.29.2] - 2026-03-03

### Fixed

- correct deno fmt indentation in src/plugins/index.ts
- address PR review feedback on PluginLoader and loadPlugin stubs
- move loadPlugin to PluginLoader.deno.ts to fix JSR deployment error


## [0.29.1] - 2026-03-03

### Fixed

- correct CHANGELOG.md formatting for 0.29.0 and 0.28.0 entries


## [0.29.0] - 2026-03-03

### Added

- **angular-poc**: Replace Express with Cloudflare Workers + Vitest
- **angular-poc**: Implement all Angular 21 modernizations

### Fixed

- **angular-poc**: Address all automated PR review comments


## [0.28.0] - 2026-03-02

### Added

- Apply styling to /api endpoint with HTML documentation page


## [0.27.0] - 2026-03-02

### Added

- Add comprehensive mobile responsive improvements across all UI pages

### Fixed

- Add missing closing style tags in test.html and e2e-tests.html
- Add retry logic to deno install steps to prevent transient worker build failures


## [0.26.0] - 2026-03-02

### Added

- Migrate Tailwind CSS v3 to v4


## [0.25.3] - 2026-02-27

### Performance

- web performance audit improvements


## [0.25.2] - 2026-02-24

### Fixed

- address CHANGELOG formatting and sync version to HTML/package-lock


## [0.25.1] - 2026-02-24

### Added

### Fixed

- **angular-poc**: readonly availableTransformations and @if-as alias for error signal
- **angular-poc**: safe error message extraction and @if-as alias for results signal

## [0.24.1] - 2026-02-23

### Fixed

- add --allow-write flag to generate-deployment-version.ts deno run commands


## [0.24.0] - 2026-02-22

### Added

- Generate Cloudflare Web Assets schema from OpenAPI spec


## [0.23.2] - 2026-02-22

### Fixed

- sync HTML version fallbacks to 0.23.1 and extend version:sync script


## [0.23.1] - 2026-02-22

### Added

### Fixed

- correct malformed ### Added section header in CHANGELOG.md [0.23.0]
- remove double blank lines in CHANGELOG.md to pass deno fmt check

## [0.23.0] - 2026-02-22

### Added

- add PoC Overview back-navigation links to React and Vue PoC pages

### Fixed

- remove double blank lines in CHANGELOG.md to pass deno fmt check

## [0.22.1] - 2026-02-22

### Added

### Fixed

- correct Zod v4 type annotations in schemas.ts to fix CI type check failures
- add explicit type annotations to all Zod schemas to fix JSR slow types error
- add --allow-slow-types to deno publish to fix JSR deployment error

## [0.22.0] - 2026-02-21

### Added

- Improve openapi.yaml for Cloudflare Web Assets Schema Validation
- Update openapi.yaml - add all missing endpoints and custom domain server

## [0.21.2] - 2026-02-21

### Added

### Fixed

- split malformed markdown headers in CHANGELOG.md 0.21.1 and 0.21.0 sections
- remove double blank lines in CHANGELOG.md to pass deno fmt check

## [0.21.1] - 2026-02-21

### Added

### Fixed

- remove double blank lines in CHANGELOG.md and trailing spaces in README.md to pass deno fmt check

## [0.21.0] - 2026-02-21

### Added

- integrate framework PoCs as experimental/alpha-level code

### Fixed

- remove double blank lines in CHANGELOG.md to pass deno fmt check

## [0.20.0] - 2026-02-21

### Added

- Add PoC project links and Svelte 5 demo client

### Fixed

- remove extra blank lines in CHANGELOG.md to pass deno fmt check

## [0.19.1] - 2026-02-21

### Fixed

- include poc/ directory in dist build and fix redirect handling for /poc route

## [0.19.0] - 2026-02-21

### Added

- inject IBasicLogger into EventEmitter, AnalyticsService, and CloudflareQueueProvider

## [0.18.0] - 2026-02-21

### Added

- centralize version management with scripts/sync-version.ts

### Fixed

- use single quotes in sync-version.ts to pass deno fmt check

## [0.17.0] - 2026-02-20

### Added

- create proof of concept for React, Vue, and Angular framework evaluation

### Fixed

- address PR review comments - Angular 19 naming, RxJS leak, missing files, React CDN warning
- apply deno fmt to fix CI format check failure (18 files)
- upgrade Angular PoC deps from 17.1.0 to 19.2.18 to fix security vulnerabilities
- add validation for changelog line number in version-bump workflow
- make changelog insertion more robust in version-bump workflow

## [0.16.2] - 2026-02-18

### Notes

- No user-facing changes. Internal release and tooling updates only.

## [0.16.1] - 2026-02-16

### Fixed

- update OpenAPI path references after root directory reorganization

## [0.16.0] - 2026-02-15

### Added

- Add circuit breaker pattern for unreliable source downloads

## [0.15.0] - 2026-02-13

### Added

- Add OpenTelemetry integration for distributed tracing

### Fixed

- Correct context usage in OpenTelemetry example
- Fix TypeScript errors in OpenTelemetry implementation

## [0.14.0] - 2026-02-13

### Added

- Add per-module log level configuration

### Fixed

- Address code review feedback

## [0.13.0] - 2026-02-13

### Added

- Implement StructuredLogger for production observability

## [0.12.1] - 2026-02-12

### Fixed

- add pull-requests permission and null check to auto-version-bump workflow
- modify auto-version-bump to create PR instead of direct push
- correct markdown formatting in VERSION_MANAGEMENT.md

### BREAKING CHANGES

- feat!/fix!/BREAKING CHANGE: → major bump (0.12.0 → 1.0.0)

Co-authored-by: jaypatrick <1800595+jaypatrick@users.noreply.github.com>

Add comprehensive version management documentation

- Create VERSION_MANAGEMENT.md with detailed sync process
- Document single source of truth pattern (src/version.ts)
- Add version update checklist
- Include troubleshooting guide
- Update copilot instructions with version management reference

## [0.9.1] - 2026-01-31

### Added

- **@adguard/agtree Integration** - Robust AST-based rule parsing
  - New `AGTreeParser` wrapper module for type-safe rule parsing
  - Type guards for all rule types (network, host, cosmetic, comments)
  - Property extraction methods for structured rule data
  - Modifier utilities (find, check, get value)
  - Validation helpers
  - Syntax detection (AdGuard, uBlock Origin, ABP)

### Changed

- **Refactored `RuleUtils`** to use AGTree internally
  - `isComment()`, `isAllowRule()`, `isEtcHostsRule()` now use AST parsing
  - `loadAdblockRuleProperties()`, `loadEtcHostsRuleProperties()` use AGTree parsing
  - New methods: `parseToAST()`, `isValidRule()`, `isNetworkRule()`, `isCosmeticRule()`, `detectSyntax()`
- **Updated `ValidateTransformation`** for AST-based validation
  - Parse-once, validate-many pattern for better performance
  - Proper handling of all rule categories
  - Better error context with structured errors

### Improved

- Rule parsing moved from regex-based to full AST with location info
- Extended syntax support from basic adblock to AdGuard, uBlock Origin, and Adblock Plus
- Modifier validation now uses compatibility tables instead of hardcoded lists
- Error handling upgraded from string matching to structured errors with positions
- Rule type support expanded to include all cosmetic rules, network rules, and comments
- Maintainability improved through upstream library updates instead of manual regex maintenance

## [0.8.8] - 2026-01-27

### Fixed

- Workflow and build issues
  - Added compiled binaries to `.gitignore` to prevent accidental commits
  - Fixed Workers build by removing undefined PlaywrightMCP Durable Object

## [0.8.0] - 2025-01-14

🎉 **Major Release - Admin Dashboard & Enhanced User Experience**

This release transforms the Adblock Compiler into a comprehensive, user-friendly platform with an intuitive admin dashboard, real-time notifications, and streamlined project organization.

### Added

- **🎯 Admin Dashboard** - New landing page (`/`) showcasing the power of Adblock Compiler
  - Real-time metrics display (requests, queue depth, cache hit rate, response time)
  - Interactive queue depth visualization with Chart.js
  - Quick navigation to all tools and test pages
  - Responsive design with modern UI/UX
  - Auto-refresh every 30 seconds
  - Quick action panel for common tasks

- **🔔 Notification System** for async operations
  - Browser/OS notifications when compilation jobs complete
  - In-page toast notifications with multiple styles (success, error, warning, info)
  - Persistent job tracking across page refreshes via LocalStorage
  - Automatic cleanup of old jobs (1 hour retention)
  - Polling for job completion every 10 seconds
  - Toggle to enable/disable notifications with permission management

- **📚 Enhanced Documentation**
  - New `docs/ADMIN_DASHBOARD.md` - Comprehensive dashboard guide
  - WebSocket usage explanations and comparisons
  - Endpoint selection guide (JSON vs SSE vs WebSocket vs Queue)
  - Benchmark information and instructions
  - Notification system documentation

- **🎨 UI/UX Improvements**
  - Renamed `/index.html` → `/compiler.html` (compilation UI)
  - New `/index.html` as admin dashboard (landing page)
  - Clear visual hierarchy with card-based navigation
  - Informative descriptions for each tool
  - "Why WebSocket?" educational content
  - Endpoint comparison with use case guidance

### Changed

- **📂 Project Organization** - Cleaner root directory
  - Moved `postman-collection.json` → `docs/tools/postman-collection.json`
  - Moved `postman-environment.json` → `docs/tools/postman-environment.json`
  - Moved `prisma.config.ts` → `prisma/prisma.config.ts`
  - Updated all documentation references to new file locations

- **🗑️ Removed Outdated Files**
  - Deleted `CODE_REVIEW.old.md` (superseded by `CODE_REVIEW.md`)
  - Deleted `REVIEW_SUMMARY.md` (info consolidated in `CODE_REVIEW.md`)
  - Added `coverage.lcov` to `.gitignore` (build artifact)

- **📄 Documentation Updates**
  - Updated `docs/POSTMAN_TESTING.md` with new file paths
  - Updated `docs/api/QUICK_REFERENCE.md` with new file paths
  - Updated `docs/OPENAPI_TOOLING.md` with new file paths

### Highlights

This release focuses on **showcasing the power and versatility** of Adblock Compiler:

- **User-Friendly**: New admin dashboard makes it easy to discover features
- **Real-time**: Live metrics and notifications keep users informed
- **Educational**: Built-in guidance on when to use each endpoint
- **Professional**: Polished UI demonstrates production-ready quality
- **Organized**: Clean project structure improves maintainability

## [Unreleased]

### Added

- **Priority Queue Support** for async compilation
  - Two-tier queue system: standard and high priority
  - Separate queues with optimized settings for different priority levels
  - High-priority queue has smaller batch size (5) and shorter timeout (2s) for faster processing
  - Standard priority queue maintains larger batches (10) and normal timeout (5s) for throughput
  - Optional `priority` field in async API endpoints (`/compile/async`, `/compile/batch/async`)
  - Automatic routing to appropriate queue based on priority level
  - Premium users and urgent compilations can use high-priority processing
  - Updated documentation with priority queue examples and deployment instructions
- **Cloudflare Tail Worker** for advanced logging and observability
  - Real-time log capture from main worker (console logs, exceptions, errors)
  - Optional KV storage for log persistence with configurable TTL
  - Webhook integration for forwarding critical errors to external services
  - Support for Slack, Discord, Datadog, Sentry, and custom endpoints
  - Structured event formatting for external log management systems
  - Comprehensive documentation and quick start guide
  - Example integrations for popular monitoring services
  - Unit tests for tail worker logic
- npm scripts for tail worker deployment and management (`tail:deploy`, `tail:dev`, `tail:logs`)
- GitHub Actions workflow for automated testing
- Performance monitoring and analytics integration

## [0.6.0] - 2026-01-01

### Added

- **Gzip Compression** for cache storage (70-80% size reduction)
- **Circuit Breaker** with automatic retry (3 attempts) and exponential backoff for external sources
- **Batch Processing API** (`POST /compile/batch`) for compiling up to 10 lists in parallel
- **Request Deduplication** for concurrent identical requests
- **Visual Diff** component in Web UI showing changes between compilations
- npm package.json for Node.js compatibility
- Comprehensive API documentation in `docs/api/README.md`
- Client library examples for Python, TypeScript/JavaScript, and Go
- Performance features section in documentation
- Status badges in README (JSR, Web UI, API, Deno, License)

### Changed

- Updated JSR package name to `@jk-com/adblock-compiler`
- Improved Web UI with batch endpoint and performance features documentation
- Enhanced README with deployment badges and feature highlights
- Renamed repository to `adblock-compiler` on GitHub
- Updated documentation to emphasize Compiler-as-a-Service model

### Fixed

- Variable scoping issue with `previousCachedVersion`
- Cache decompression error handling
- Rate limiting headers (429 with Retry-After)

## [2.0.0] - 2024-12-15

### Added

- Initial production release as AdBlock Compiler
- Cloudflare Workers deployment support
- Server-Sent Events (SSE) for real-time progress tracking
- Web UI with Simple Mode, Advanced Mode, and Examples
- Rate limiting (10 requests per minute per IP)
- KV caching with 1-hour TTL
- Event pipeline with 9 event types
- Interactive API documentation tab

### Changed

- Zero Node.js dependencies
- Platform-agnostic design (Deno, Node.js, Cloudflare Workers, browsers)


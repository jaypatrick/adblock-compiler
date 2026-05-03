# Dependencies & External Integrations

> **Living Document** — This file must be updated whenever a dependency is added, removed, or has its version pinned/changed. See [Keeping This Document Up to Date](#keeping-this-document-up-to-date) for the update process.

**Project:** `jaypatrick/bloqr-backend`  
**Description:** Adblock/AdGuard Hostlist & Rules Compiler — run locally, via CLI, or as a Compiler-as-a-Service deployed on Cloudflare Workers, Deno Deploy, Vercel Edge Functions, or AWS Lambda@Edge. Aggregates and compiles host blocklists from disparate sources, with AGTree-powered AST parsing, multi-syntax detection and translation across AdGuard, uBlock.  
**Version:** `0.62.2`  
**Package Manager:** `pnpm@10.31.0` (workspace) + `deno` (worker/core)

---

## Table of Contents

1. [Worker / Core Dependencies](#1-worker--core-dependencies-packagejson)
2. [Worker Dev Dependencies](#2-worker-dev-dependencies-packagejson)
3. [Core Library Dependencies (Deno)](#3-core-library-dependencies-denojson-import-map)
4. [Frontend Dependencies](#4-frontend-dependencies-frontendpackagejson)
5. [Frontend Dev Dependencies](#5-frontend-dev-dependencies-frontendpackagejson)
6. [External Service Integrations](#6-external-service-integrations)
7. [Cloudflare Platform Bindings](#7-cloudflare-platform-bindings)
8. [Keeping This Document Up to Date](#keeping-this-document-up-to-date)

---

## 1. Worker / Core Dependencies (`package.json`)

Runtime dependencies used by the Cloudflare Worker.

| Package | Version | Registry | Purpose |
|---|---|---|---|
| `@adguard/agtree` | `^4.0.4` | npm | AdGuard filter list AST parsing and multi-syntax detection |
| `@better-auth/infra` | `^0.2.5` | npm | Better Auth infrastructure utilities (Cloudflare Workers adapter) |
| `@opentelemetry/api` | `^1.9.0` | npm | OpenTelemetry tracing and metrics API |
| `@prisma/adapter-d1` | `^7.5.0` | npm | Prisma ORM adapter for Cloudflare D1 (SQLite) |
| `@prisma/client` | `^7.5.0` | npm | Prisma ORM client for database access |
| `@sentry/cloudflare` | `10.43.0` | npm | Sentry error tracking for Cloudflare Workers runtime |
| `better-auth` | `^1.5.6` | npm | Server-side authentication framework (session management, OAuth, Prisma adapter) |
| `jose` | `^6.2.1` | npm / JSR | JWT verification and JWKS fetching (Clerk auth) |
| `svix` | `^1.88.0` | npm | Clerk webhook signature verification (HMAC) |
| `zod` | `^4.3.6` | npm | Runtime schema validation at all trust boundaries |

> **Sync note:** Dependency versions here must match those pinned in `deno.json`'s import map. Keep them in sync (for example via the existing `version:sync`-style task).

---

## 2. Worker Dev Dependencies (`package.json`)

Development and tooling dependencies for the Worker.

| Package | Version | Registry | Purpose |
|---|---|---|---|
| `@cloudflare/containers` | `^0.1.1` | npm | Cloudflare Containers (Durable Object containers) support |
| `@cloudflare/playwright` | `^1.1.2` | npm | Playwright integration for Cloudflare Browser Rendering |
| `@cloudflare/playwright-mcp` | `^0.0.5` | npm | MCP (Model Context Protocol) integration for Playwright |
| `wrangler` | `^4.73.0` | npm | Cloudflare Workers CLI — local dev, deployment, secret management |

---

## 3. Core Library Dependencies (`deno.json` import map)

Dependencies for the core compiler library (`src/`) and Deno runtime.

| Package | Version | Registry | Purpose |
|---|---|---|---|
| `@adguard/agtree` | `^4.0.4` | npm | AdGuard filter list AST parsing (shared with worker) |
| `@better-auth/infra` | `^0.2.5` | npm | Better Auth infrastructure utilities (Cloudflare Workers adapter) |
| `@luca/cases` | `^1.0.0` | JSR | String case conversion utilities |
| `@opentelemetry/api` | `^1.9.0` | npm | OpenTelemetry tracing API (shared with worker) |
| `@prisma/adapter-d1` | `^7.5.0` | npm | Prisma D1 adapter (shared with worker) |
| `@prisma/client` | `^7.5.0` | npm | Prisma client (shared with worker) |
| `@sentry/cloudflare` | `^10.43.0` | npm | Sentry SDK (shared with worker) |
| `@std/assert` | `^1.0.19` | JSR | Deno standard library — assertions |
| `@std/async` | `^1.2.0` | JSR | Deno standard library — async utilities |
| `@std/fs` | `^1.0.23` | JSR | Deno standard library — file system |
| `@std/path` | `^1.1.4` | JSR | Deno standard library — path utilities |
| `@std/testing` | `^1.0.17` | JSR | Deno standard library — testing utilities |
| `better-auth` | `^1.5.6` | npm | Server-side auth framework — full entry point (type imports, plugin options) |
| `better-auth/minimal` | `^1.5.6` (subpath) | npm | Better Auth minimal build — strips Kysely (not needed with Prisma adapter); used as the runtime `betterAuth` factory to reduce Worker bundle size |
| `jose` | `^6.2.1` | JSR (`@panva/jose`) | JWT verification — JSR version for native Deno compatibility |
| `svix` | `^1.88.0` | npm | Webhook signature verification (shared with worker) |
| `tldts` | (pinned in deno.json) | npm | TLD and domain parsing |
| `zod` | `^4.3.6` | npm | Schema validation (shared with worker) |

---

## 4. Frontend Dependencies (`frontend/package.json`)

Runtime dependencies for the Angular 21 frontend (`frontend/`).

### Framework

| Package | Version | Purpose |
|---|---|---|
| `@angular/animations` | `^21.2.4` | Angular animation engine |
| `@angular/cdk` | `^21.2.2` | Angular Component Dev Kit (accessibility, overlays) |
| `@angular/common` | `^21.2.4` | Angular common utilities and pipes |
| `@angular/compiler` | `^21.2.4` | Angular template compiler |
| `@angular/core` | `^21.2.4` | Angular core (signals, zoneless change detection) |
| `@angular/forms` | `^21.2.4` | Angular reactive and template-driven forms |
| `@angular/material` | `^21.2.2` | Angular Material Design component library |
| `@angular/platform-browser` | `^21.2.4` | Angular browser platform |
| `@angular/platform-browser-dynamic` | `^21.2.4` | Angular JIT compilation platform |
| `@angular/platform-server` | `^21.2.4` | Angular server-side rendering (SSR) platform |
| `@angular/router` | `^21.2.4` | Angular client-side router |
| `@angular/service-worker` | `^21.2.4` | Angular PWA service worker |
| `@angular/ssr` | `^21.2.2` | Angular SSR (server-side rendering) |
| `@analogjs/vite-plugin-angular` | `^2.3.1` | Vite plugin for Angular build tooling |
| `rxjs` | `~7.8.2` | Reactive Extensions — core Angular dependency |
| `tslib` | `^2.8.1` | TypeScript runtime helper library |

### Auth

| Package | Version | Purpose |
|---|---|---|
| `@clerk/clerk-js` | `^6.3.0` | Clerk frontend auth SDK (vanilla JS, loaded into Angular) |
| `@clerk/shared` | `^4.3.0` | Shared Clerk TypeScript types and utilities |

### Observability

| Package | Version | Purpose |
|---|---|---|
| `@sentry/angular` | `^10.43.0` | Sentry error tracking, performance monitoring, and session replay for Angular |

### Validation

| Package | Version | Purpose |
|---|---|---|
| `zod` | `^4.3.6` | Runtime API response validation (shared schema with worker) |

### Fonts & Icons

| Package | Version | Purpose |
|---|---|---|
| `@fontsource/ibm-plex-sans` | `^5.2.8` | IBM Plex Sans — UI body font (self-hosted, no CDN) |
| `@fontsource/jetbrains-mono` | `^5.2.8` | JetBrains Mono — code/monospace font (self-hosted, no CDN) |
| `@fontsource/syne` | `^5.2.7` | Syne — display/heading font (self-hosted, no CDN) |
| `material-symbols` | `^0.40.2` | Material Symbols Outlined icon font |

---

## 5. Frontend Dev Dependencies (`frontend/package.json`)

Development and tooling dependencies for the Angular frontend.

### Angular Tooling

| Package | Version | Purpose |
|---|---|---|
| `@angular/cli` | `^21.2.2` | Angular CLI — `ng serve`, `ng build`, `ng lint` |
| `@angular/compiler-cli` | `^21.2.4` | Angular AOT compiler |
| `@angular-devkit/build-angular` | `^21.2.2` | Angular build system |
| `@angular-eslint/builder` | `^21.3.0` | ESLint integration for Angular CLI |
| `angular-eslint` | `^21.3.0` | ESLint rules for Angular templates and TypeScript |

### Testing

| Package | Version | Purpose |
|---|---|---|
| `@analogjs/vitest-angular` | `^2.3.1` | Vitest integration for Angular unit tests (zoneless) |
| `vitest` | `^4.1.0` | Unit testing framework (replaces Karma/Jasmine) |
| `@vitest/coverage-v8` | `^4.1.0` | V8-based code coverage for Vitest |
| `@playwright/test` | `^1.58.2` | End-to-end testing with Playwright |
| `jsdom` | `^28.1.0` | DOM implementation for Node.js test environments |

### Linting & Formatting

| Package | Version | Purpose |
|---|---|---|
| `eslint` | `^10.0.3` | JavaScript/TypeScript linter |
| `@eslint/js` | `^10.0.1` | ESLint JavaScript rules |
| `typescript-eslint` | `^8.57.0` | ESLint TypeScript parser and rules |
| `typescript` | `~5.9.3` | TypeScript compiler |

### CSS / Styling

| Package | Version | Purpose |
|---|---|---|
| `tailwindcss` | `^4.2.1` | Utility-first CSS framework |
| `@tailwindcss/postcss` | `^4.2.1` | TailwindCSS PostCSS plugin |
| `postcss` | `^8.5.8` | CSS post-processing |

### Cloudflare / Deployment

| Package | Version | Purpose |
|---|---|---|
| `@cloudflare/workers-types` | `^4.20260313.1` | TypeScript type definitions for Cloudflare Workers |

### Observability (Dev)

| Package | Version | Purpose |
|---|---|---|
| `@sentry/cli` | `^3.3.3` | Sentry CLI for source map uploads during CI/CD |

---

## 6. External Service Integrations

Services that the project depends on at runtime or in CI/CD.

| Service | Category | Purpose |
|---|---|---|
| **Clerk** | Auth & Identity | User authentication, JWT issuance, webhook user-sync, RBAC tiers (anonymous → free → pro → admin) |
| **Sentry** | Observability | Error tracking, performance monitoring, session replay (Worker + Angular frontend). DSN stored as Worker Secret (`SENTRY_DSN`). |
| **OpenTelemetry** | Observability | Distributed tracing via OTLP-compatible collectors (e.g. Grafana, Honeycomb). Endpoint configured via `OTEL_EXPORTER_OTLP_ENDPOINT`. |
| **Better Stack / Logtail / Grafana Loki** | Log Management | Tail Worker forwards structured logs to external HTTP log ingestion. Configured via `LOG_SINK_URL` / `LOG_SINK_TOKEN` Worker Secrets. |
| **GitHub Actions** | CI/CD | Build, test, D1 migrations, Worker deployment, Sentry source map uploads. |
| **Filter List Sources** | Data | External adblock filter lists fetched at runtime: EasyList, uBlock Origin, AdGuard filters, and other hostlist sources. |
| **PlanetScale / PostgreSQL** | Database (optional) | External PostgreSQL accessed via Cloudflare Hyperdrive for API key storage. |

---

## 7. Cloudflare Platform Bindings

Cloudflare services consumed as Worker bindings (configured in `wrangler.toml`).

| Service | Binding Name(s) | Status | Purpose |
|---|---|---|---|
| **Workers** | *(runtime)* | ✅ Active | Primary edge compute runtime |
| **KV Namespaces** | `COMPILATION_CACHE`, `RATE_LIMIT`, `METRICS`, `RULES_KV` | ✅ Active | Caching, rate limiting, metrics aggregation, rule set storage |
| **D1 Database** | `DB` | ✅ Active | Compilation history, user records, deployment records (via Prisma) |
| **R2 Storage** | `FILTER_STORAGE` | ✅ Active | Filter list artifact persistence; pipeline sink |
| **Queues** | `BLOQR_BACKEND_QUEUE`, `BLOQR_BACKEND_QUEUE_HIGH_PRIORITY` | ✅ Active | Async and batch compilation job processing |
| **Analytics Engine** | `ANALYTICS_ENGINE` | ✅ Active | Request metrics, cache analytics, security event telemetry |
| **Workflows** | `COMPILATION_WORKFLOW`, `BATCH_COMPILATION_WORKFLOW`, `CACHE_WARMING_WORKFLOW`, `HEALTH_MONITORING_WORKFLOW` | ✅ Active | Durable async execution with retry |
| **Hyperdrive** | `HYPERDRIVE` | ✅ Active | Accelerated connection pooling to external PostgreSQL |
| **Browser Rendering** | `BROWSER` | ✅ Active | Headless Playwright-based browser for JS-rendered filter sources |
| **Pipelines** | `METRICS_PIPELINE` | ✅ Active | Batched metrics and audit event ingestion → R2 |
| **Tail Worker** | `bloqr-tail` | ✅ Active | Log collection and forwarding to external log sink |
| **Containers** | `ADBLOCK_COMPILER` | 🔧 Configured | Durable Object container (production only) |
| **Turnstile** | `TURNSTILE_SECRET_KEY` *(secret)* | ✅ Active | Bot protection / human verification on compilation endpoints |
| **API Shield** | *(Dashboard)* | 📋 Dashboard | OpenAPI schema validation at edge |
| **Web Analytics** | `CF_WEB_ANALYTICS_TOKEN` *(env)* | ✅ Active | Frontend visitor analytics (beacon script in `index.html`) |
| **Cron Triggers** | *(wrangler.toml)* | ✅ Active | Cache warming (every 6h), health monitoring (every 1h) |

---

## Keeping This Document Up to Date

This is a **living document**. It must be updated as part of the same PR that adds, removes, or changes a dependency.

### When to update

- Adding a new `npm`, `JSR`, or `deno.json` import
- Removing a package from any `package.json` or `deno.json`
- Pinning or bumping a package version
- Adding or removing a Cloudflare binding in `wrangler.toml`
- Onboarding or offboarding an external service integration

### How to update

1. Locate the correct section in this file for the change (Worker, Frontend, Deno core, External service, or Cloudflare binding).
2. Add, update, or remove the relevant table row.
3. Update the version number if it changed.
4. Commit the change in the **same PR** as the dependency change — never in a separate cleanup PR.

### Version sync reminder

Worker/core packages that are listed in **both** `package.json` and `deno.json` must be kept in sync. Use the `version:sync` Deno task (or equivalent) to verify alignment before committing.

### ZTA reminder

Per the project's Zero Trust Architecture policy, any new external service integration must be reviewed for:
- Secret storage (Cloudflare Worker Secrets, never `[vars]` or source control)
- Zod schema validation at the trust boundary
- Security event telemetry via `AnalyticsService.trackSecurityEvent()`

---

*Last updated: 2026-05-03 — add `better-auth` (`^1.5.6`), `better-auth/minimal` (subpath, Kysely-free bundle), and `@better-auth/infra` (`^0.2.5`) to Worker and Deno import-map sections (feat(auth): Better Auth performance optimizations).*

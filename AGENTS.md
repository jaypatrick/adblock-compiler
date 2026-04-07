# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Adblock Compiler is a **Compiler-as-a-Service** for adblock filter lists. It transforms, optimizes, and combines filter lists from multiple sources. The project spans three major surfaces: a Deno-based core library (`src/`), a Cloudflare Worker API (`worker/`), and an Angular 21 frontend (`frontend/`).

Currently in **code freeze at v0.79.4** for e2e testing and refactoring.

## Build & Development Commands

### Backend (Deno — `src/` and `worker/`)

```sh
deno task dev                  # Dev mode with watch
deno task test                 # All tests (src/ + worker/)
deno task test:src             # Tests for src/ only
deno task test:worker          # Tests for worker/ only
deno task test:watch           # Watch mode (src/ only)
deno task test:coverage        # Tests with coverage
deno task lint                 # Lint
deno task fmt                  # Auto-format
deno task fmt:check            # Check formatting
deno task check                # Type-check (src + worker)
deno task preflight            # fmt:check + lint + check + openapi:validate + schema:generate + check:drift
deno task preflight:full       # preflight + test + check:slow-types (run before every PR)
```

**Run a single test file** (must pass explicit permissions):

```sh
deno test --allow-read --allow-write --allow-net --allow-env src/cli/ArgumentParser.test.ts
```

**Important:** Always use `deno task test` instead of bare `deno test`. The tasks configure required permissions.

### Frontend (Angular 21 — `frontend/`)

```sh
pnpm --filter adblock-frontend run start   # Dev server on :4200
pnpm --filter adblock-frontend run build   # Production build
pnpm --filter adblock-frontend run test    # Vitest unit tests
pnpm --filter adblock-frontend run lint    # ESLint
```

### Full-Stack Local Dev

```sh
deno task wrangler:dev                              # Worker API on :8787
pnpm --filter adblock-frontend run start            # Angular on :4200, proxies /api → :8787
```

### Database (Prisma + Neon PostgreSQL)

```sh
deno task db:generate     # Generate Prisma client (NEVER use npx prisma generate)
deno task db:migrate      # Run migrations
deno task db:studio       # Open Prisma Studio
deno task db:local:up     # Start local Postgres via Docker Compose
```

### Cloudflare Worker

```sh
deno task wrangler:dev      # Local Worker dev server
deno task wrangler:deploy   # Deploy to Cloudflare
```

### Schema & Artifact Generation

If `src/` schemas or OpenAPI definitions change:

```sh
deno task schema:generate   # Regenerates cloudflare-schema.yaml + postman collection
```

Commit the resulting diff in `docs/api/` and `docs/postman/`. CI checks for drift via `deno task check:drift`.

## Package Manager Rules

- **Backend**: Use `deno` tasks exclusively. Never `npm` or `npx`.
- **Frontend**: Use `pnpm --filter adblock-frontend`. Never bare `npm install`.
- **Wrangler**: Use `deno task wrangler` (wraps `npm:wrangler` via Deno). Never `npx wrangler`.
- If `package-lock.json` appears, delete it — `pnpm-lock.yaml` is the source of truth.

## Architecture

### Three-Surface Design

1. **`src/`** — Pure TypeScript library. Platform-agnostic core: compiler, transformations, downloader, configuration validation, formatters, diff engine, plugin system. Published to JSR as `@jk-com/adblock-compiler`. Tests co-located as `*.test.ts`.

2. **`worker/`** — Cloudflare Worker (production API). Uses Hono (`OpenAPIHono`) for routing, tRPC for typed RPC, Prisma for database, Better Auth for authentication. Entry point: `worker/worker.ts` → `worker/hono-app.ts`. Routes organized in `worker/routes/*.routes.ts`. Middleware in `worker/middleware/`. Cloudflare Workflows in `worker/workflows/`. Tests co-located as `*.test.ts`.

3. **`frontend/`** — Angular 21 SPA. Zoneless change detection, Angular Material 3, SSR on Cloudflare Workers. Signal-first architecture (`rxResource`, `linkedSignal`, `toSignal`). Tests are `*.spec.ts` using Vitest (not Jest).

### Key Architectural Patterns

- **Hono routing**: All API routes live in `worker/routes/*.routes.ts` and are mounted in `worker/hono-app.ts`. Domain-scoped route modules (admin, compile, queue, workflow, etc.).
- **Middleware chain**: CORS → Server-Timing → request ID → rate limiting → unified auth → route handlers. Auth middleware in `worker/middleware/auth.ts`, rate limiting in `worker/middleware/hono-middleware.ts`.
- **Transformation pipeline**: Rules pass through a configurable pipeline (`TransformationPipeline`) of transformations (deduplicate, validate, compress, etc.) defined in `src/transformations/`.
- **Plugin system**: Extensible via `src/plugins/` — supports custom transformations, formatters, downloaders, conflict resolvers.
- **Cloudflare Workflows**: Durable execution for long-running compilations (`CompilationWorkflow`, `BatchCompilationWorkflow`, `CacheWarmingWorkflow`, `HealthMonitoringWorkflow`).
- **Cloudflare Queues**: Async compilation via queue-based processing (`worker/handlers/queue.ts`).
- **Dual database**: Neon PostgreSQL (primary, via Hyperdrive) + Cloudflare D1 (edge cache). Prisma ORM with separate schemas: `prisma/schema.prisma` (Neon) and `prisma/schema.d1.prisma` (D1).
- **Cloudflare SDK**: All Cloudflare REST API calls go through `src/services/cloudflareApiService.ts`. Never use raw `fetch` to `api.cloudflare.com`.

### Import Conventions

- Use `@/` path alias for `src/` imports (e.g., `import { Foo } from '@/foo/foo.ts'`)
- Use mapped specifiers from `deno.json` imports (e.g., `'zod'`, `'hono'`, `'@std/assert'`)
- Never use raw npm/jsr URLs

## Code Style (CI-Enforced)

- **Indentation**: 4 spaces, no tabs
- **Line width**: 180 characters max
- **Quotes**: Single quotes in `.ts` (double quotes in JSON)
- **Semicolons**: Always required
- **Trailing comma**: In multi-line object/array literals
- **Braces**: K&R style, always use braces even for single-line `if`/`else`/`for`/`while`
- **TODOs**: Must be tagged — `// TODO(tag): …` — bare `// TODO:` fails lint
- **Unused vars**: Remove or prefix with `_` (e.g., `_req`)
- **Return types**: Annotate on all exported functions and class methods
- **Naming**: camelCase for vars/functions, PascalCase for classes/types/enums, UPPER_SNAKE_CASE for constants/enum members, Zod schemas get `Schema` suffix
- **Files**: kebab-case in `src/`/`worker/`, Angular conventions in `frontend/`
- **Tests**: Co-located as `*.test.ts` (Deno) or `*.spec.ts` (Angular/Vitest)
- **No Prettier** — `deno fmt` is authoritative for `src/`/`worker/`; ESLint for `frontend/`
- **Diagrams**: Always Mermaid fenced code blocks in `.md` files. Never ASCII art.

## Zero Trust Architecture (ZTA)

Every handler, middleware, and component enforces ZTA. Key rules:

- Auth verification **before** any business logic in every handler
- CORS explicit allowlist only — never `Access-Control-Allow-Origin: *` on write endpoints
- All DB queries use `.prepare().bind()` — never string interpolation
- All trust boundaries (webhooks, JWT claims, API bodies, DB rows) validated with Zod
- Secrets in Worker Secrets only — never in `wrangler.toml [vars]`
- Frontend: No tokens in `localStorage`; `CanActivateFn` guards on protected routes; HTTP interceptor attaches JWT Bearer token
- Security events tracked via `AnalyticsService.trackSecurityEvent()`

## Testing Rules

- Every code change ships with tests
- `src/` and `worker/` tests: Deno native (`@std/assert`), co-located `*.test.ts`
- `frontend/` tests: Vitest + Angular TestBed, co-located `*.spec.ts`
- Coverage target: ≥80% patch coverage per PR
- Use `makeEnv(overrides)` fixture pattern with in-memory KV/DB stubs — never call real Cloudflare bindings in unit tests

## Conventional Commits

Format: `<type>[scope]: <description>`. Types: `feat:` (minor bump), `fix:`/`perf:` (patch bump), `docs:`, `style:`, `refactor:`, `test:`, `chore:`, `ci:`. Breaking changes use `!` suffix or `BREAKING CHANGE:` footer.

## Environment Variables

Two tracks:

- **Shell track** (`.env*` files): Used by Prisma CLI, Deno tasks, scripts
- **Wrangler track** (`.dev.vars`): Used by the Worker at runtime

If the `worker/types.ts` `Env` interface has the variable, it belongs in `.dev.vars`, not `.env*` files.

Setup: `cp .dev.vars.example .dev.vars` then `deno task setup`.

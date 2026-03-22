# Developer Onboarding Guide

> **Audience**: New contributors to the adblock-compiler project.
> **Goal**: Get you from zero to a running local dev environment in under 10 minutes.

---

## Table of Contents

- [1. Quick Start (5 Minutes)](#1-quick-start-5-minutes)
- [2. Prerequisites](#2-prerequisites)
- [3. Environment Setup](#3-environment-setup)
- [4. Project Structure](#4-project-structure)
- [5. Key Development Patterns](#5-key-development-patterns)
  - [Adding a New API Endpoint](#adding-a-new-api-endpoint)
  - [Database Changes](#database-changes)
  - [Authentication](#authentication)
  - [Testing](#testing)
- [6. Common Tasks](#6-common-tasks)
- [7. Troubleshooting](#7-troubleshooting)
- [8. Code Review Checklist](#8-code-review-checklist)
- [9. Useful Links](#9-useful-links)

---

## 1. Quick Start (5 Minutes)

Copy-paste the following blocks in order. Each step must succeed before moving on.

```bash
# 1. Clone and install
git clone https://github.com/jaypatrick/adblock-compiler.git
cd adblock-compiler
deno install
cd frontend && npm install && cd ..

# 2. Set up environment
cp .env.example .env.local
cp .dev.vars.example .dev.vars
# Edit .env.local and .dev.vars with your values (see Section 3)

# 3. Start local database
deno task db:local:up     # Starts Docker PostgreSQL
deno task db:local:push   # Pushes Prisma schema to local DB

# 4. Generate Prisma client
deno task db:generate     # IMPORTANT: never use npx prisma generate directly

# 5. Run tests
deno task test:src        # Backend src tests
deno task test:worker     # Worker tests
cd frontend && npx vitest run  # Frontend tests

# 6. Start development server
deno task dev             # Starts wrangler dev on localhost:8787
```

> **⚠️ Critical**: Always use `deno task db:generate` instead of `npx prisma generate`.
> The Deno task wrapper ensures the generated client uses correct import paths.

If the dev server starts and you see `Ready on http://localhost:8787`, you're good to go.

---

## 2. Prerequisites

| Tool             | Version  | Install                                              |
| ---------------- | -------- | ---------------------------------------------------- |
| **Deno**         | 2.x+     | `curl -fsSL https://deno.land/install.sh \| sh`      |
| **Node.js**      | 20+      | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| **npm**          | 10+      | Bundled with Node.js                                 |
| **Docker Desktop** | Latest | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop) |
| **Git**          | 2.x+     | Pre-installed on most systems                        |

**Optional**:

- **pnpm** — Can be used for the Angular frontend instead of npm.
- **direnv** — Automatically loads environment variables when you `cd` into the project. Highly recommended.

---

## 3. Environment Setup

This project uses a **4-file environment architecture**. Understanding which file does what will save you hours of debugging.

| File                | Copied From           | Git-tracked? | Purpose                                    |
| ------------------- | --------------------- | ------------ | ------------------------------------------ |
| `.env.local`        | `.env.example`        | **No**       | Prisma CLI, shell scripts, local secrets   |
| `.dev.vars`         | `.dev.vars.example`   | **No**       | Wrangler dev runtime (Worker bindings)     |
| `.env.development`  | —                     | Yes          | Shared non-sensitive defaults              |
| `.env.production`   | —                     | Yes          | Production overrides (no secrets)          |

> **How `.envrc` works**: If you use [direnv](https://direnv.net/), the `.envrc` file in the
> project root automatically loads these files in the correct order. Run `direnv allow` once
> after cloning.

### Minimum Required Values for Local Development

Add these to both `.env.local` and `.dev.vars`:

```env
# Database — matches docker-compose.yml defaults
DIRECT_DATABASE_URL=postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev
DATABASE_URL=postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev

# Auth — safe local-only values
BETTER_AUTH_SECRET=local-dev-secret-change-in-prod
ADMIN_KEY=local-admin-key
```

You do **not** need Cloudflare API tokens, Clerk keys, or Neon credentials for basic local
development. The local Docker PostgreSQL and the values above are sufficient to run the full
test suite and dev server.

---

## 4. Project Structure

```mermaid
flowchart TD
    subgraph Edge["Cloudflare Edge"]
        W["worker/<br/>Hono Routes + Middleware"]
        D1["Cloudflare D1<br/>(Edge Cache)"]
    end

    subgraph Backend["Core Library"]
        SRC["src/<br/>Services, Parsers,<br/>Storage Adapters"]
        PRISMA["prisma/<br/>Schema + Generated Client"]
    end

    subgraph Frontend["Angular 19"]
        FE["frontend/<br/>SPA / SSR"]
    end

    subgraph Infra["Infrastructure"]
        DOCKER["docker-compose.yml<br/>Local PostgreSQL"]
        NEON["Neon PostgreSQL<br/>(Production)"]
    end

    FE -->|"HTTP API"| W
    W --> SRC
    W --> D1
    SRC --> PRISMA
    PRISMA --> DOCKER
    PRISMA --> NEON
```

### Directory Overview

```
├── src/               # Core library — storage adapters, services, parsers
├── worker/            # Cloudflare Worker — Hono routes, middleware, auth
├── frontend/          # Angular 19 SPA/SSR (standalone project)
├── prisma/            # Prisma schema + generated client
├── scripts/           # Build, deploy, and utility scripts
├── docs/              # Documentation (you are here)
├── tests/             # Integration and end-to-end tests
├── data/              # Static filter list data
├── migrations/        # Database migration history
├── admin-migrations/  # Admin-specific DB migrations
└── docker-compose.yml # Local PostgreSQL container
```

**Key files at the root**:

- `deno.json` — Deno configuration, task definitions, import map
- `wrangler.toml` — Cloudflare Worker deployment config
- `prisma.config.ts` — Prisma configuration for Deno
- `tsconfig.json` — TypeScript configuration

---

## 5. Key Development Patterns

### Adding a New API Endpoint

Every new endpoint follows this pattern:

```mermaid
sequenceDiagram
    participant Client
    participant Middleware as Hono Middleware Chain
    participant Handler as Route Handler
    participant DB as Prisma / D1

    Client->>Middleware: HTTP Request
    Middleware->>Middleware: bodySizeMiddleware()
    Middleware->>Middleware: rateLimitMiddleware()
    Middleware->>Middleware: zValidator(schema)
    Middleware->>Middleware: turnstileMiddleware()
    Middleware->>Handler: Validated Request
    Handler->>DB: c.get('prisma').model.findMany()
    DB-->>Handler: Results
    Handler-->>Client: JSON Response
```

**Step-by-step**:

1. **Define your Zod schema** in `worker/schemas.ts`:

   ```typescript
   export const MyRequestSchema = z.object({
     name: z.string().min(1).max(255),
     filters: z.array(z.string()).max(100),
   });
   ```

2. **Add the route** in `worker/hono-app.ts` with the full middleware chain:

   ```typescript
   app.post(
     '/api/my-endpoint',
     bodySizeMiddleware(),
     rateLimitMiddleware(),
     zValidator('json', MyRequestSchema),
     turnstileMiddleware(),
     async (c) => {
       const body = c.req.valid('json');
       const prisma = c.get('prisma');
       // Business logic here
       return c.json({ success: true }, 200);
     }
   );
   ```

3. **Access the database** via `c.get('prisma')` — this is set by the Prisma middleware and provides the fully typed Prisma client.

4. **Return proper HTTP status codes**: `200` for success, `201` for created, `400` for validation errors, `401` for unauthorized, `403` for forbidden.

5. **Add tests** in the `worker/` directory alongside the existing test files.

### Database Changes

1. Edit `prisma/schema.prisma`
2. Apply to local database:
   ```bash
   deno task db:local:push    # Fast schema push (dev only)
   ```
3. Regenerate the typed client:
   ```bash
   deno task db:generate      # NEVER use npx prisma generate
   ```
4. For production, create a proper migration:
   ```bash
   npx prisma migrate dev --name describe-your-change
   ```

> **Why not `npx prisma generate`?** The `deno task db:generate` wrapper patches import
> paths in the generated client so they resolve correctly under Deno's module system. Using
> `npx prisma generate` directly produces a client with broken imports.

### Authentication

This project is in an **auth transition period**:

| System          | Role                              | Status      |
| --------------- | --------------------------------- | ----------- |
| **Better Auth** | Primary auth — session management | Active      |
| **Clerk**       | Legacy auth — being phased out    | Transitional |

**For new code**, always use Better Auth patterns:

- The auth middleware sets the current user on the Hono context.
- Access the authenticated user via `c.get('user')` in any handler.
- Auth tiers determine access level: **anonymous → free → pro → admin**.
- All write endpoints (`POST`, `PUT`, `DELETE`) require authentication.
- Admin routes additionally require Cloudflare Access JWT verification.

### Testing

| Scope      | Command                            | Framework  |
| ---------- | ---------------------------------- | ---------- |
| Backend    | `deno task test:src`               | Deno test  |
| Worker     | `deno task test:worker`            | Deno test  |
| Frontend   | `cd frontend && npx vitest run`    | Vitest     |

**Testing principles**:

- Use **Prisma mocks** (not a real database) in unit tests.
- Validate Zod schemas at all trust boundaries in tests.
- See `docs/testing/database-testing.md` for database testing patterns and examples.

---

## 6. Common Tasks

### Run Specific Tests

```bash
# Single backend test file
deno test src/storage/HyperdriveStorageAdapter.test.ts

# Single worker test file
deno test worker/lib/auth.test.ts

# Single frontend test file
cd frontend && npx vitest run src/app/services/auth-facade.service.spec.ts
```

### Inspect the Local Database

```bash
deno task db:local:studio   # Opens Prisma Studio at http://localhost:5555
```

### Reset the Local Database

```bash
deno task db:local:reset    # Drops and recreates all tables + re-seeds
```

### Format Code

```bash
deno fmt                    # Backend (Deno formatter)
cd frontend && npx ng lint  # Frontend (Angular/ESLint)
```

### Check Types

```bash
deno task check             # Full backend type checking
```

### Start the Frontend Dev Server

```bash
cd frontend && npm start    # Angular dev server (typically localhost:4200)
```

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `Cannot find module 'prisma/generated'` | Prisma client not generated or generated with wrong tool | Run `deno task db:generate` |
| Docker port 5432 already in use | Another PostgreSQL instance is running | Stop the other instance, or change `ports` in `docker-compose.yml` |
| `HYPERDRIVE is undefined` | Expected — Hyperdrive only exists on Cloudflare's network | `.dev.vars` provides the `DATABASE_URL` fallback for local dev |
| Import errors with `.js` / `.ts` extensions | Client generated with `npx prisma generate` instead of `deno task` | Run `deno task db:generate` (never use `npx prisma generate`) |
| Frontend build fails with missing dependencies | `node_modules` not installed | Run `cd frontend && npm install` |
| `Error: connect ECONNREFUSED 127.0.0.1:5432` | Local PostgreSQL not running | Run `deno task db:local:up` and wait for the container to be healthy |
| Wrangler dev fails with binding errors | Missing `.dev.vars` file | Copy `.dev.vars.example` to `.dev.vars` and fill in values |

---

## 8. Code Review Checklist

Before submitting a PR, verify each item:

- [ ] All inputs validated with **Zod schemas** at trust boundaries
- [ ] Database queries use **Prisma** (not raw SQL or string interpolation)
- [ ] **Auth is checked before business logic** in every handler
- [ ] Tests written for new code paths
- [ ] No secrets committed (check `.env.local` and `.dev.vars` are gitignored)
- [ ] **Mermaid diagrams** used for any visuals (not ASCII art)
- [ ] CORS uses explicit origin allowlist (never `Access-Control-Allow-Origin: *` on write endpoints)
- [ ] Security events emitted on auth failures via `AnalyticsService.trackSecurityEvent()`

---

## 9. Useful Links

| Document | Path |
| -------- | ---- |
| Architecture Overview | [`docs/development/ARCHITECTURE.md`](./ARCHITECTURE.md) |
| API Reference | [`docs/api/README.md`](../api/README.md) |
| Auth Developer Guide | [`docs/auth/developer-guide.md`](../auth/developer-guide.md) |
| Database Testing Patterns | [`docs/testing/database-testing.md`](../testing/database-testing.md) |
| Neon Database Setup | [`docs/database-setup/neon-setup.md`](../database-setup/neon-setup.md) |
| Contributing Guidelines | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| Code Review Standards | [`docs/development/CODE_REVIEW.md`](./CODE_REVIEW.md) |
| Security Policy | [`SECURITY.md`](../../SECURITY.md) |

---

*Last updated: 2025*

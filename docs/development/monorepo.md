# Monorepo Developer Guide

This guide covers the monorepo layout, the per-ecosystem toolchains, how to add new packages, how CI path filters work, and the commands developers use day-to-day.

> **Authoritative workspace spec:** [`MONOREPO.md`](../../MONOREPO.md) at the repository root contains the canonical workspace layout table. This guide focuses on the **developer workflow** rather than the spec.

---

## Workspace Layout

```
adblock-compiler/
├── src/                        # Core TypeScript library (Deno)
│   └── deno.json               # Package entry point for Deno workspace
├── worker/                     # Cloudflare Worker API (Deno + Hono + Zod + Prisma/D1)
│   ├── deno.json
│   ├── wrangler.toml           # CF Workers deployment config (root)
│   └── services/
├── frontend/                   # Angular 21 SPA (pnpm + Node)
│   ├── package.json
│   └── src/
├── tools/                      # Python operational runbooks (uv)
│   ├── pyproject.toml
│   └── runbooks/
├── examples/
│   └── cloudflare-worker/      # Standalone CF Worker example (pnpm)
├── docs/                       # Developer documentation (this directory)
├── deno.json                   # Deno workspace root + global task runner
├── deno.lock
├── pnpm-workspace.yaml         # pnpm workspace root
├── pnpm-lock.yaml
└── MONOREPO.md                 # Authoritative workspace reference
```

---

## Toolchain Summary

| Ecosystem | Root config | Lock file | Package manager version | Test runner |
|-----------|-------------|-----------|------------------------|-------------|
| **Deno** (`src/`, `worker/`) | `deno.json` | `deno.lock` | Deno ≥ 2.x | `deno test` |
| **pnpm** (`frontend/`, `examples/`) | `pnpm-workspace.yaml` | `pnpm-lock.yaml` | pnpm ≥ 9.x | Vitest via `pnpm test` |
| **uv** (`tools/`) | `tools/pyproject.toml` | `uv.lock` (inside `tools/`) | uv ≥ 0.4 | pytest via `uv run pytest` |

All three ecosystems coexist without interference. Each manages its own lockfile and has its own test command. The Deno workspace task runner (`deno task …`) provides a single entry-point for the most common cross-package operations.

---

## Common Commands

### Deno workspace (src + worker)

```bash
# Check formatting (all Deno packages)
deno fmt --check

# Lint (all Deno packages)
deno lint

# Type-check (all Deno packages)
deno check src/mod.ts worker/mod.ts

# Run all tests
deno test --allow-all

# Full pre-commit preflight (fmt + lint + type-check + openapi validate)
deno task preflight

# Full preflight including slow-type checks and integration tests
deno task preflight:full
```

### pnpm workspace (frontend + examples)

```bash
# Install all pnpm packages (from repo root)
pnpm install

# Lint the Angular frontend
pnpm --filter adblock-frontend run lint

# Run Angular unit tests
pnpm --filter adblock-frontend run test

# Build the Angular frontend
pnpm --filter adblock-frontend run build
```

### uv (tools/)

```bash
# Install Python deps and sync the venv
uv sync --directory tools

# Lint Python runbooks
uv run --directory tools ruff check tools/

# Type-check Python runbooks
uv run --directory tools ty check tools/

# Run a specific runbook
uv run --directory tools python tools/runbooks/resend_sync.py
```

---

## How to Add a New Package

### Deno package

1. Create a directory under the repo root (e.g., `my-deno-lib/`).
2. Add a `deno.json` with `name` and `exports` fields.
3. Register it in the workspace array at the root `deno.json`:

   ```json
   // deno.json (root)
   {
     "workspace": [
       "./src",
       "./worker",
       "./my-deno-lib"      ← add this line
     ]
   }
   ```

4. Add CI path filters (see [CI Path Filters](#ci-path-filters) below).
5. Update [`MONOREPO.md`](../../MONOREPO.md) with the new entry.

### pnpm / Node package

1. Create a directory (e.g., `my-node-lib/`) with a `package.json` that has `"name"` set.
2. Register it in `pnpm-workspace.yaml`:

   ```yaml
   # pnpm-workspace.yaml
   packages:
     - frontend
     - examples/cloudflare-worker
     - my-node-lib            # ← add this line
   ```

3. Run `pnpm install` from the repo root to hoist shared dependencies.
4. Add CI path filters and update `MONOREPO.md`.

### Python package (uv)

1. Create a directory under `tools/` (e.g., `tools/my-runbook/`).
2. Add the package to `tools/pyproject.toml` under `[tool.uv.sources]` if it has local dependencies.
3. Run `uv sync --directory tools` to update the lockfile.
4. Add CI path filters and update `MONOREPO.md`.

> **Note:** Python packages live under `tools/` by convention. Do not create top-level Python directories — this confuses the Deno and pnpm workspace glob patterns.

---

## CI Path Filters

Each package or workspace area has a dedicated path filter in `.github/workflows/ci.yml`. This ensures that a change in `frontend/` does not re-run the Deno test suite, and vice versa.

| Job | Path filter | Notes |
|-----|-------------|-------|
| `deno-core` | `src/**`, `deno.json`, `deno.lock` | Core library tests and lint |
| `deno-worker` | `worker/**`, `wrangler.toml`, `deno.json` | Worker tests, type-check, D1 schema |
| `frontend` | `frontend/**`, `pnpm-workspace.yaml` | Angular lint, tests, build |
| `tools` | `tools/**` | Python lint and type-check |
| `newman` | `postman/**`, `.github/workflows/newman.yml` | Postman collection run (see [Newman CI](../testing/newman-ci.md)) |

When you add a new package, add a corresponding `paths:` filter to the CI job that runs its tests. If you need a new job, copy the nearest existing job in `ci.yml` and adjust the `working-directory`, `paths`, and run commands.

---

## Dependency Management Conventions

### Deno imports

- All third-party imports use JSR (`jsr:`) or deno.land/x (`https://deno.land/x/`) specifiers.
- Pin versions with exact specifiers in the package's `deno.json` `imports` map. Do not rely on `@latest`.
- Prefer `jsr:` over `https://deno.land/x/` for packages that are available on JSR.

### pnpm packages

- Use `pnpm add --filter <package-name> <dep>` to add a dependency to a specific workspace package.
- Shared dev tooling (ESLint, TypeScript, Vitest) is hoisted to the root. Run `pnpm add -D -w <dep>` to add root-level dev deps.
- Lock file must always be committed. Run `pnpm install --frozen-lockfile` in CI.

### Python (uv)

- All dependencies are declared in `tools/pyproject.toml` under `[project.dependencies]`.
- Run `uv add --directory tools <package>` to add a new dependency; this updates both `pyproject.toml` and `uv.lock`.
- The lockfile (`tools/uv.lock`) is committed.

---

## Environment Variables

Each ecosystem has its own mechanism for environment variables:

| Ecosystem | Local dev mechanism | CI mechanism |
|-----------|--------------------|----|
| Deno (Worker) | `.dev.vars` (Wrangler local) | GitHub Actions secrets → `wrangler secret put` |
| pnpm (Frontend) | `.env` / `.env.local` (Angular) | GitHub Actions secrets → Angular env build |
| uv (Tools) | `.env` file loaded by runbook | GitHub Actions secrets |

See [Developer Onboarding](./DEVELOPER_ONBOARDING.md) for the complete environment setup instructions.

---

## Linting and Formatting Cheat Sheet

| Action | Command |
|--------|---------|
| Deno format (auto-fix) | `deno fmt` |
| Deno format (check only) | `deno fmt --check` |
| Deno lint | `deno lint` |
| Angular lint (ESLint) | `pnpm --filter adblock-frontend run lint` |
| Python lint (Ruff) | `uv run --directory tools ruff check tools/` |
| Python format (Ruff) | `uv run --directory tools ruff format tools/` |
| Python types | `uv run --directory tools ty check tools/` |

Run `deno task preflight` before every commit — it chains `fmt --check`, `lint`, `check`, and OpenAPI validation in a single command.

---

## Related Documentation

- [`MONOREPO.md`](../../MONOREPO.md) — canonical workspace layout and toolchain spec
- [Developer Onboarding](./DEVELOPER_ONBOARDING.md) — first-time setup, env vars, local dev server
- [Tools README](../tools/README.md) — Python runbook reference
- [Newman CI](../testing/newman-ci.md) — Postman / Newman CI workflow

# Monorepo Developer Guide

← [Back to README](../../README.md)

This repository uses **three co-existing package managers** — Deno, pnpm, and uv — each owning a distinct slice of the monorepo. Understanding which manager governs which workspace prevents dependency confusion and incorrect task invocations.

---

## Table of Contents

1. [Workspace Layout](#workspace-layout)
2. [Deno Workspace](#deno-workspace)
3. [pnpm Workspace](#pnpm-workspace)
4. [uv Workspace (Python)](#uv-workspace-python)
5. [Task Routing](#task-routing)
6. [Adding a New Package](#adding-a-new-package)
7. [Preflight Checks](#preflight-checks)

---

## Workspace Layout

```
bloqr-backend/
├── deno.json                     ← Root Deno workspace config + all task definitions
├── pnpm-workspace.yaml           ← pnpm workspace config
├── package.json                  ← minimal; bridges npm scripts for pnpm workspace
│
├── worker/                       ← Deno sub-workspace (Cloudflare Worker / Hono)
│   └── deno.json
├── examples/
│   └── cloudflare-worker/        ← Deno sub-workspace + pnpm package
│       ├── deno.json
│       └── package.json
│
├── frontend/                     ← pnpm package (Angular 21)
│   └── package.json
│
├── docs-docusaurus/              ← pnpm package (Docusaurus 3)
│   └── package.json
├── docs-starlight/               ← pnpm package (Astro / Starlight)
│   └── package.json
│
└── tools/                        ← uv workspace (Python 3.11+)
    ├── pyproject.toml
    └── .marimo.toml
```

### Manager Ownership

| Path | Manager | Package name |
|---|---|---|
| `worker/` | Deno | `@jk-com/adblock-compiler-worker` (Deno sub-workspace) |
| `examples/cloudflare-worker/` | Deno + pnpm | `adblock-compiler-worker-example` |
| `frontend/` | pnpm | `bloqr-frontend` |
| `docs-docusaurus/` | pnpm | `@bloqr/docs-docusaurus` |
| `docs-starlight/` | pnpm | `@bloqr/docs-starlight` |
| `tools/` | uv | `bloqr-backend-tools` |

> **Note:** `tools/` is intentionally excluded from the pnpm workspace. It has its own `uv.lock` and is managed entirely by uv. Do not add it to `pnpm-workspace.yaml`.

---

## Deno Workspace

Declared in `deno.json` at the root:

```json
{
    "workspace": ["./worker", "./examples/cloudflare-worker"]
}
```

Sub-workspaces share the root `deno.json` import map (the `"imports"` section) so both `worker/` and `examples/cloudflare-worker/` resolve the same pinned versions of `hono`, `zod`, `better-auth`, etc.

### Running Deno tasks from the root

All tasks in `deno.json` are invoked from the repository root:

```bash
# Compile the CLI
deno task compile

# Run all tests (src/ + worker/)
deno task test

# Run only worker tests
deno task test:worker

# Type-check
deno task check

# Lint
deno task lint

# Format
deno task fmt

# Full preflight (format, lint, type-check, OpenAPI validate, schema drift check)
deno task preflight
```

### Wrangler (Cloudflare Worker deployment)

Wrangler is invoked through Deno to use the pinned version from the import map (`npm:wrangler@^4.86.0`):

```bash
# Local dev server
deno task wrangler:dev

# Deploy to production
deno task wrangler:deploy

# Deploy to dev environment
deno task wrangler:deploy:dev

# Dry-run / verify bundle
deno task wrangler:verify

# Stream real-time logs
deno task wrangler:tail
```

### Schema & OpenAPI Tasks

```bash
# Regenerate Cloudflare API Shield schema + Postman collection
deno task schema:generate

# Validate OpenAPI spec
deno task openapi:validate

# Upload Cloudflare API Shield schema
deno task schema:upload

# Check generated files are not out of date (run in CI)
deno task check:drift
```

---

## pnpm Workspace

Declared in `pnpm-workspace.yaml`:

```yaml
packages:
    - 'frontend'
    - 'examples/cloudflare-worker'
    - 'docs-docusaurus'
    - 'docs-starlight'
    # tools/ is NOT listed here — it is managed by uv
```

### Running pnpm workspace commands from root

Individual packages are addressed with `--filter <package-name>`:

```bash
# Install all pnpm workspace dependencies
pnpm install

# Build Angular frontend
pnpm --filter bloqr-frontend run build

# Start Angular dev server
pnpm --filter bloqr-frontend run start

# Run Angular tests
pnpm --filter bloqr-frontend run test

# Production build
pnpm --filter bloqr-frontend run build
```

### Convenience aliases via Deno tasks

The root `deno.json` provides `ui:*` aliases that delegate to pnpm under the hood:

```bash
deno task ui:build:ng        # pnpm --filter bloqr-frontend run build
deno task ui:build:ng:dev    # pnpm --filter bloqr-frontend run build:dev
deno task ui:dev:ng          # pnpm --filter bloqr-frontend run start
deno task ui:test:ng         # pnpm --filter bloqr-frontend run test
deno task ui:deploy:ng:dev   # build:dev + deploy:dev
```

This means you can run all development tasks from the repository root using only `deno task`, regardless of which sub-system you are working on.

---

## uv Workspace (Python)

The `tools/` directory is a standalone Python project managed by uv. It is **not** part of the pnpm workspace.

```bash
# First-time setup — install all Python deps into .venv
deno task runbook:setup
# equivalent to: uv sync --directory tools
```

All `runbook:*` tasks delegate to `uv run --directory tools ...`, so uv does not need to be on `PATH` globally — Deno locates the `uv` binary automatically.

### Why uv?

- Lock file (`uv.lock`) guarantees reproducible installs across machines and CI.
- `uv run` creates/activates the virtual environment inline without a separate `activate` step.
- Supports Python 3.11+ target version matching `tools/pyproject.toml`.

For the full Python toolchain guide, see **[`docs/tools/MARIMO_UV_TY.md`](../tools/MARIMO_UV_TY.md)**.

---

## Task Routing

The table below shows which command to run for common developer scenarios, all from the **repository root**:

| Goal | Command |
|---|---|
| Start Worker dev server | `deno task wrangler:dev` |
| Start Angular dev server | `deno task ui:dev:ng` |
| Run all tests | `deno task test` |
| Run Angular tests | `deno task ui:test:ng` |
| Run Worker tests | `deno task test:worker` |
| Lint (Deno/TypeScript) | `deno task lint` |
| Format (Deno/TypeScript) | `deno task fmt` |
| Lint (Python) | `deno task runbook:lint` |
| Format (Python) | `deno task runbook:fmt` |
| Type-check (Python) | `deno task runbook:typecheck` |
| Run a marimo runbook | `deno task runbook:pipeline` |
| Edit a marimo runbook | `deno task runbook:edit:pipeline` |
| Deploy Worker to production | `deno task wrangler:deploy` |
| Build Angular production | `deno task ui:build:ng` |
| Generate schemas | `deno task schema:generate` |
| Full preflight | `deno task preflight` |

---

## Adding a New Package

### Deno sub-workspace

1. Create the directory and add a `deno.json` with at minimum `{ "name": "@jk-com/<name>" }`.
2. Add the directory path to the `"workspace"` array in the root `deno.json`.
3. The new package automatically inherits the root import map.

### pnpm package

1. Create the directory with a `package.json` (`"name"` must be unique in the workspace).
2. Add the directory path to `pnpm-workspace.yaml`.
3. Run `pnpm install` from the root to link the new package.

### Python module (inside `tools/`)

Add the dependency to `tools/pyproject.toml` under `[project] dependencies` (runtime) or `[dependency-groups] dev` (dev-only), then run `deno task runbook:setup` to update the lock file.

---

## Preflight Checks

Before opening a PR, run the full preflight suite:

```bash
deno task preflight
```

This runs in sequence:

1. `deno fmt --check` — format check
2. `deno lint` — lint
3. `deno task check` — type-check `src/` and `worker/`
4. `deno task openapi:validate` — validate OpenAPI spec
5. `deno task schema:generate` — regenerate Cloudflare schema + Postman collection
6. `deno task check:drift` — ensure generated files are committed
7. `deno task check:lockfile` — `pnpm install --frozen-lockfile --ignore-scripts`

For a complete run that also includes tests and slow-type checks:

```bash
deno task preflight:full
```

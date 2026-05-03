# Monorepo Guide

This document provides an orientation to the Adblock Compiler monorepo structure and links to the authoritative reference.

> **Authoritative reference:** [`MONOREPO.md`](../../MONOREPO.md) at the repository root contains the complete workspace layout, toolchain-per-package table, and step-by-step instructions for adding new packages.

---

## Overview

The repository is a **multi-runtime monorepo** combining three package ecosystems:

| Ecosystem | Packages | Toolchain |
|-----------|----------|-----------|
| **Deno** | `src/` (core library), `worker/` (CF Worker API) | `deno.json` workspaces |
| **pnpm** | `frontend/` (Angular 21 SPA), `examples/cloudflare-worker/` | `pnpm-workspace.yaml` |
| **uv** | `tools/` (Python runbooks) | `tools/pyproject.toml` |

All three ecosystems coexist in the same repository without interference. Each package manages its own dependencies and has its own test runner.

---

## Workspace Layout

```
adblock-compiler/
├── src/                    # Core TypeScript library (Deno)
├── worker/                 # Cloudflare Worker API (Deno/Hono/tRPC)
├── frontend/               # Angular 21 SPA (pnpm/Node)
├── tools/                  # Python runbooks (uv)
├── examples/
│   └── cloudflare-worker/  # Example integration (pnpm/Node)
├── deno.json               # Deno workspace root + task runner
├── pnpm-workspace.yaml     # pnpm workspace root
└── MONOREPO.md             # Full reference documentation
```

---

## Running All Checks

```bash
# Full preflight (fmt + lint + type-check + openapi validate + schema drift)
deno task preflight

# Full preflight + tests + slow-type checks (run before every PR)
deno task preflight:full

# Frontend checks
pnpm --filter adblock-frontend run lint
pnpm --filter adblock-frontend run test

# Python tools checks
uv run --project tools ruff check tools/
uv run --project tools ty check tools/
```

---

## Adding a New Package

See [`MONOREPO.md § Adding a New Package`](../../MONOREPO.md) for the full procedure. The summary:

1. **TypeScript/Node package** → add to `pnpm-workspace.yaml`.
2. **Deno package** → add to the `workspace` array in `deno.json`.
3. **Python package** → add under `tools/` with `uv`.
4. Always add CI path filters in `.github/workflows/ci.yml` for the new package.
5. Update `MONOREPO.md` with the new entry.

---

## CI Path Filters

Each package has a dedicated path filter in CI so changes in unrelated packages do not trigger unnecessary jobs:

| Package | CI path filter |
|---------|---------------|
| `src/` | `src/**` |
| `worker/` | `worker/**` |
| `frontend/` | `frontend/**` |
| `tools/` | `tools/**` |

---

## Related Documentation

- [`MONOREPO.md`](../../MONOREPO.md) — authoritative workspace reference
- [Tools README](../tools/README.md) — Python runbook tooling
- [Angular Frontend](../frontend/ANGULAR_FRONTEND.md) — frontend architecture

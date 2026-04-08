# Design: Diff UI, Visual Documentation Artifacts, and Prisma D1 Migration Workflow

**Date:** 2026-04-07
**Status:** Approved

---

## Context

The `DiffGenerator` class (`src/diff/DiffReport.ts`) already compares two filter lists and
produces added/removed rule lists, domain-level breakdowns, summary statistics, and Markdown/JSON
exports. However, there is no API endpoint and no frontend UI exposing this capability.

Additionally, the project lacks visual documentation artifacts for use in presentations,
README files, and other communications.

The user's key constraint: **AGTree is the single source of truth.** Diffs operate on parsed
AST nodes — not raw text — so syntax errors surface before the diff runs, and two textually
different rules that parse to the same AST are treated as identical.

---

## Track 1 — Diff UI

### API Endpoint: `POST /api/diff`

**Location:** `worker/routes/compile.routes.ts` + new handler `worker/handlers/diff.ts`

**Request body:**
```json
{
  "original": ["string"],
  "current":  ["string"],
  "options": {
    "ignoreComments":   true,
    "ignoreEmptyLines": true,
    "analyzeDomains":   true,
    "maxRulesToInclude": 1000
  }
}
```

**Response:**
```json
{
  "success": true,
  "parseErrors": {
    "original": [{ "line": 3, "rule": "...", "message": "..." }],
    "current":  []
  },
  "report": { /* DiffReport */ }
}
```

**Handler logic:**
1. Parse `original` rules through `ASTViewerService.parseRule()` — collect any parse errors
2. Parse `current` rules the same way
3. Run `DiffGenerator.generate()` on the successfully-parsed rule sets
4. Return both `parseErrors` and the `DiffReport` in one response

Parse errors do **not** block the diff — rules that fail to parse are excluded from comparison
and surfaced in a dedicated error panel, consistent with the validation page's behavior.

**Auth:** `minTier: UserTier.Free` (same as `/validate`)

### Angular Component: `DiffComponent`

**Route:** `/diff` (auth-gated via `authGuard`)

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  Filter List Diff                                        │
│  Compare two filter lists via AGTree AST                 │
├───────────────────────┬─────────────────────────────────┤
│  Original             │  Current                         │
│  [textarea]           │  [textarea]                      │
│  [parse errors chips] │  [parse errors chips]            │
├───────────────────────┴─────────────────────────────────┤
│  [Compare]  [Clear]   strict mode toggle                 │
├─────────────────────────────────────────────────────────┤
│  SUMMARY BAR                                             │
│  +N added  -N removed  N unchanged  ±N net (X%)         │
├─────────────────────────────────────────────────────────┤
│  RULE DIFF  (virtual scroll, color-coded)                │
│  + added rule (green)                                    │
│  - removed rule (red)                                    │
├─────────────────────────────────────────────────────────┤
│  DOMAIN CHANGES  (mat-table, sortable)                   │
│  domain | +added | -removed                              │
├─────────────────────────────────────────────────────────┤
│  [Export Markdown]  [Export JSON]                        │
└─────────────────────────────────────────────────────────┘
```

**Angular 21 patterns:** signals, `rxResource`, `@if/@for`, virtual scrolling for large rule
lists, `DestroyRef`, zoneless.

**Service:** New `DiffService` wrapping `POST /api/diff`. Mirrors `ValidationService` pattern.

---

## Track 2 — Visual Documentation Artifacts

**Output location:** `docs/assets/diagrams/`

**Format:** Both SVG (for markdown embedding) and self-contained HTML (for presentations).

### Diagrams to produce

| File | Description |
|------|-------------|
| `system-architecture` | Angular → CF Worker → D1 / R2 / Queues / Better Auth / Sentry |
| `compilation-pipeline` | The 6 compilation modes (JSON, Stream/SSE, Async, Batch, Batch+Async, Container) |
| `feature-map` | All UI pages, their auth requirements, and relationships |
| `api-overview` | All API endpoints grouped by category |
| `diff-workflow` | Before/after: raw text → AGTree parse → AST diff → report |
| `tech-stack` | Language / runtime / infra layer cake |

Each diagram produced as:
- `docs/assets/diagrams/<name>.svg` — embeds cleanly in markdown
- `docs/assets/diagrams/<name>.html` — standalone, presentation-ready

---

## Track 3 — Prisma D1 Migration Workflow

### Problem

`migrations/` contains hand-authored SQL files. The `prisma/schema.d1.prisma` Prisma schema
exists and `@prisma/adapter-d1` is already installed, but the two are not connected by a
generation workflow. Any schema change requires manually writing SQL and keeping the files
in sync — creating drift risk.

### Current state

| | PostgreSQL (Neon) | D1 (SQLite) |
|---|---|---|
| Schema file | `prisma/schema.prisma` ✅ | `prisma/schema.d1.prisma` ✅ |
| Client generation | `db:generate` ✅ | `db:generate:d1` ✅ |
| Migration generation | `prisma migrate dev` ✅ | ❌ hand-written SQL |
| Migration apply | `prisma migrate deploy` ✅ | `wrangler d1 migrations apply` ✅ |
| Drift check | Prisma tracks state ✅ | ❌ none |

### Solution

Wire `prisma migrate diff` into the D1 workflow. All future D1 DDL changes:
1. Edit `prisma/schema.d1.prisma`
2. Run `deno task db:migrate:d1` → generates the next numbered `.sql` file in `migrations/`
3. Run `wrangler d1 migrations apply` to apply

### New `deno.json` tasks

```
db:migrate:d1        # prisma migrate diff → auto-numbered file in migrations/
db:migrate:d1:deploy # wrangler d1 migrations apply --remote (used in CI)
db:check:d1          # drift check: schema.d1.prisma vs applied migrations
```

### Migration script

A small Deno script (`scripts/generate-d1-migration.ts`) wraps `prisma migrate diff`:
- Reads current highest migration number from `migrations/`
- Runs `prisma migrate diff --from-migrations ./migrations --to-schema-datamodel prisma/schema.d1.prisma --script`
- Writes output as `migrations/<next>_<name>.sql`
- Exits with error if diff is empty (no schema changes detected)

### CI integration

`deploy-worker` action already runs `wrangler d1 migrations apply --remote`. No change needed
there — the new tasks only affect how migration files are **generated** locally.

---

## File Manifest

### New files
| Path | Purpose |
|------|---------|
| `worker/handlers/diff.ts` | `POST /api/diff` handler |
| `worker/handlers/diff.test.ts` | Handler tests |
| `frontend/src/app/diff/diff.component.ts` | Angular diff page |
| `frontend/src/app/diff/diff.component.spec.ts` | Component tests |
| `frontend/src/app/services/diff.service.ts` | API wrapper |
| `frontend/src/app/services/diff.service.spec.ts` | Service tests |
| `docs/assets/diagrams/*.svg` | 6 SVG diagrams |
| `docs/assets/diagrams/*.html` | 6 HTML diagrams |
| `scripts/generate-d1-migration.ts` | Auto-numbering D1 migration generator |

### Modified files
| Path | Change |
|------|--------|
| `worker/routes/compile.routes.ts` | Register `POST /diff` |
| `worker/handlers/index.ts` | Export `handleDiff` |
| `worker/utils/route-permissions.ts` | Add `/diff` permission entry |
| `worker/openapi-types.ts` | Add diff request/response types |
| `worker/schemas.ts` | Add `DiffRequestSchema`, `DiffResponseSchema` |
| `frontend/src/app/app.routes.ts` | Add `/diff` route |
| `deno.json` | Add `db:migrate:d1`, `db:migrate:d1:deploy`, `db:check:d1` tasks |

---

## Verification

1. `deno task test` — all existing tests pass
2. `POST /api/diff` with two sample lists returns correct added/removed counts
3. Syntax error in one list surfaces in `parseErrors`, does not crash the diff
4. Angular `/diff` route renders, compares, exports Markdown and JSON
5. All 6 SVG files render correctly embedded in a markdown file
6. All 6 HTML files open standalone in a browser
7. `deno task db:migrate:d1` generates a correctly-numbered `.sql` file from a schema change
8. `deno task db:check:d1` exits 0 when schema and migrations are in sync, non-zero on drift

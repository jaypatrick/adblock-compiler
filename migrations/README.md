# D1 Main Database Migrations (Frozen)

These migrations define the **edge cache** schema for the `bloqr-backend-d1-database` Cloudflare D1 database.

As of the Neon migration (2026-03), this directory is **frozen**:

- No new application schema goes here
- Neon/Prisma schema changes live in `prisma/migrations/`
- `admin-migrations/` remains active for the separate `bloqr-backend-admin-d1` database

## Cache tables (maintained)

| Table             | Purpose                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `storage_entries` | L1 edge cache — write-through from Neon `storage_entries` via `d1-cache-sync.ts` |
| `filter_cache`    | L1 edge cache — write-through from Neon `filter_cache` via `d1-cache-sync.ts`    |

## Retired tables (data lives in Neon)

| Table                  | Replaced by                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `deployment_history`   | `prisma/schema.prisma` → `DeploymentHistory` model (Neon)                       |
| `deployment_counter`   | `prisma/schema.prisma` → `DeploymentCounter` model (Neon)                       |
| `compilation_metadata` | `prisma/schema.prisma` → `CompilationMetadata` / `CompiledOutput` models (Neon) |

If a D1 cache schema change is ever needed (e.g. adding a column to a cached table),
add a new `.sql` file here. Otherwise, all schema work goes in `prisma/migrations/`.

# Neon + Prisma Cheat Sheet

> Quick reference for how the database stack fits together and what to run
> when things break. Start here before digging into longer docs.

---

## 1. How the Stack Fits Together

```mermaid
flowchart LR
    subgraph CF["Cloudflare Edge"]
        W["Worker\n(hono-app.ts)"]
        HD["Hyperdrive\nConnection Pooler"]
    end

    subgraph Neon["Neon PostgreSQL — project: adblock-db"]
        direction TB
        PROD["production branch\n(Default)"]
        MAIN["main branch"]
        PR["pr-N branch\n(per PR)"]
    end

    subgraph CI["GitHub Actions"]
        MIG["prisma migrate deploy\n(direct connection)"]
    end

    subgraph LOCAL["Local Dev"]
        DOCK["Docker PostgreSQL\nadblock_dev"]
        PSTUDIO["Prisma Studio"]
    end

    W -- "env.HYPERDRIVE\n.connectionString" --> HD
    HD -- "pooled TLS\nconnections" --> PROD

    MIG -- "DIRECT_DATABASE_URL\n(non-pooled Neon)" --> PR
    MIG -- "on push to main" --> MAIN

    PSTUDIO -- "DIRECT_DATABASE_URL" --> PROD
    LOCAL -- "DATABASE_URL" --> DOCK
```

### Two Connection Paths — Why?

| Consumer | Connection | Reason |
|---|---|---|
| **Cloudflare Worker** (production) | `env.HYPERDRIVE.connectionString` → Neon | Hyperdrive is Cloudflare-edge-only: warm TCP pool, sub-ms overhead, caching |
| **GitHub Actions** (CI migrations) | `DIRECT_DATABASE_URL` → Neon directly | Hyperdrive is unreachable outside Cloudflare's network |
| **Local dev — Docker** | `postgresql://adblock:localdev@localhost:5432/adblock_dev` | Offline, no credentials needed |
| **Local dev — Neon branch** | `DIRECT_DATABASE_URL` → Neon directly | Same path as CI |

**Hyperdrive is not a general-purpose connection pooler.** It is a Cloudflare edge
service that only runs inside a Worker. `prisma migrate deploy` runs on a standard
Linux VM in GitHub Actions and cannot reach it. This is by design — not a bug.

---

## 2. Key Concepts

### Neon Terminology

| Term | What it is | This project |
|---|---|---|
| **Project** | Top-level Neon container | `adblock-db` (ID: `twilight-river-73901472`) |
| **Branch** | Git-like copy-on-write clone of a project | `production` (Default), `main`, `pr-N` |
| **Database** | PostgreSQL database inside a branch | `adblock-compiler` |
| **Role** | PostgreSQL user/role | `neondb_owner` (Neon default) |
| **Endpoint** | Compute attached to a branch | `ep-winter-term-a8rxh2a9` |

### Connection String Anatomy

```
postgresql://neondb_owner:PASSWORD@ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech/adblock-compiler?sslmode=require
└─────────┘ └────────────────────┘ └─────────────────────────────────────────────────────┘ └──────────────┘
  scheme      role:password          host (add -pooler for app; omit for migrations/psql)    database name
```

- **Pooled** endpoint (app / Hyperdrive): hostname contains `-pooler`
- **Direct** endpoint (migrations / `psql`): hostname has no `-pooler` suffix

### Prisma Migration State

Prisma tracks applied migrations in the `_prisma_migrations` table inside each branch.
`prisma migrate deploy` only applies migrations that have no row in that table.

**`_prisma_migrations`**

| migration_name                        | started_at           | finished_at         | rolled_back_at | status      |
|---------------------------------------|----------------------|---------------------|----------------|-------------|
| `20260322030000_init`                 | 2026-03-22 03:00:00  | 2026-03-22 03:00:01 | `NULL`         | applied ✅  |
| `20260322092000_add_two_factor_table` | 2026-03-22 09:20:00  | `NULL`              | `NULL`         | FAILED ❌   |

`finished_at IS NULL` **and** `rolled_back_at IS NULL` ⇒ migration is considered **failed** and causes **P3009**.

---

## 3. Daily Commands

### Check migration status
```bash
DIRECT_DATABASE_URL="<connection-string>" npx prisma migrate status
```

### Apply pending migrations
```bash
DATABASE_URL="<pooler-url>" DIRECT_DATABASE_URL="<direct-url>" npx prisma migrate deploy
```

### Open Prisma Studio (visual DB browser)
```bash
DIRECT_DATABASE_URL="<direct-neon-url>" npx prisma studio
```

### Connect via psql
```bash
psql "postgresql://neondb_owner:PASSWORD@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/adblock-compiler?sslmode=require"
```

### Inspect migration history
```sql
-- Run inside psql or Prisma Studio
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
ORDER BY started_at;
```

---

## 4. Neon Branch Commands

All examples use the `neonctl` CLI. Install with `npm i -g neonctl`, then authenticate:
```bash
neonctl auth
```

### List all branches
```bash
neonctl branches list --project-id twilight-river-73901472
```

### Get connection string for a branch
```bash
neonctl connection-string pr-1278 \
  --project-id twilight-river-73901472 \
  --database-name adblock-compiler \
  --role-name neondb_owner
```

### Delete a stuck PR branch manually
```bash
neonctl branches delete pr-1278 --project-id twilight-river-73901472
```

### Restore a branch to its parent state (via Neon REST API)
```bash
# Get the branch ID first
BRANCH_ID=$(neonctl branches get pr-1278 --project-id twilight-river-73901472 -o json | jq -r '.id')

# Restore to parent tip (instant — copy-on-write)
curl -sf -X POST \
  "https://console.neon.tech/api/v2/projects/twilight-river-73901472/branches/${BRANCH_ID}/restore" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"source_type":"parent"}'
```

---

## 5. Error Reference

### P3009 — Failed migration blocking deploys

```
Error: P3009
migrate found failed migrations in the target database, new migrations will not be applied.
The `20260322092000_add_two_factor_table` migration started at 2026-03-22 19:14:21 UTC failed
```

**What happened:** A previous CI run failed mid-migration. Prisma wrote a row to
`_prisma_migrations` with `started_at` set but `finished_at` NULL. Every subsequent
`prisma migrate deploy` sees the failed row and refuses to proceed.

> **Important — `prisma migrate status` exit codes:**
> - Exit **0**: schema is in sync, nothing pending
> - Exit **1**: migrations are pending *or* failed — both cases exit 1
>
> A non-zero exit code alone does **not** mean P3009. On every fresh PR branch there
> will always be pending migrations that haven't been applied yet, and `migrate status`
> exits 1 for those too. Only look for the literal string `P3009` in the output.

**Automatic fix:** The `neon-branch-create.yml` workflow detects P3009 by grepping for
the literal string `P3009` in the `migrate status` output (never by exit code alone)
and restores the PR branch to its `production` parent before re-running migrations.
Push a new commit or click **Re-run jobs** to trigger recovery.

**Manual fix (Option A — resolve single migration):**
```bash
DIRECT_DATABASE_URL="<branch-url>" \
  npx prisma migrate resolve --rolled-back 20260322092000_add_two_factor_table
# Then re-run migrations
DIRECT_DATABASE_URL="<branch-url>" DATABASE_URL="<pooler-url>" npx prisma migrate deploy
```

**Manual fix (Option B — restore entire PR branch):**
```bash
# Safest for PR branches: wipes schema + migration history, re-forks from production
curl -sf -X POST \
  "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}/restore" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"source_type":"parent"}'
```

---

### "relation already exists"

```
ERROR: relation "two_factor" already exists
```

**What happened:** A table was created by one migration, and a second migration
tries to create the same table (e.g. duplicate migrations, or a migration file
was renamed/re-added after the table already exists in the branch).

**Fix:**
```bash
# 1. Drop the orphaned table
psql "$DIRECT_DATABASE_URL" -c 'DROP TABLE IF EXISTS "two_factor" CASCADE;'

# 2. Remove the orphaned migration record (if the file no longer exists on disk)
psql "$DIRECT_DATABASE_URL" \
  -c "DELETE FROM _prisma_migrations WHERE migration_name = 'old_migration_name';"

# 3. Re-run migrations
npx prisma migrate deploy
```

---

### Migration drift — applied but not on disk

```
Drift detected: Your database schema is not in sync with your migration history.
The following migration(s) are applied to the database but missing from the local migrations directory:
• 20260322030001_add_two_factor
```

**What happened:** A migration was applied to the branch, then the `.sql` file was
deleted from the repo. Prisma sees the row in `_prisma_migrations` but finds no file.

**Fix for PR branches (simplest):** Restore the branch to parent (see P3009 Option B above).

**Fix without branch restore:**
```bash
# Delete the orphaned record — lets Prisma treat the schema as the baseline
psql "$DIRECT_DATABASE_URL" \
  -c "DELETE FROM _prisma_migrations WHERE migration_name = '20260322030001_add_two_factor';"
```

---

### NEON_DATABASE_URL not set / can't parse

```
::error::Could not parse database name or role from NEON_DATABASE_URL.
```

**Fix:** Add the secret in GitHub → repository **Settings → Secrets and variables →
Actions → New repository secret**:

| Secret name | Value format |
|---|---|
| `NEON_DATABASE_URL` | `postgresql://neondb_owner:PASSWORD@ep-xxx.eastus2.azure.neon.tech/adblock-compiler?sslmode=require` |
| `NEON_API_KEY` | Neon API token from [console.neon.tech → Account → API Keys](https://console.neon.tech/app/settings/api-keys) |
| `NEON_PROJECT_ID` | `twilight-river-73901472` |

> **Note:** Use the **direct** (non-pooled) endpoint in `NEON_DATABASE_URL` — the
> URL must not contain `-pooler` in the hostname. Prisma requires a direct connection
> for schema operations.

---

## 6. GitHub Actions Secrets Reference

| Secret | Required by | Value |
|---|---|---|
| `NEON_API_KEY` | `neon-branch-create.yml`, `neon-branch-cleanup.yml` | Neon API token |
| `NEON_PROJECT_ID` | both Neon workflows | `twilight-river-73901472` |
| `NEON_DATABASE_URL` | `neon-branch-create.yml` | Direct connection string (non-pooled) pointing to `adblock-compiler` database |
| `DIRECT_DATABASE_URL` | `db-migrate.yml` | Same direct connection string — used by production migration jobs |

The workflow derives the database name (`adblock-compiler`) and role (`neondb_owner`)
from `NEON_DATABASE_URL` at runtime. If the database is ever renamed, update only
that secret — nothing else needs to change.

---

## 7. Related Docs

| Document | What it covers |
|---|---|
| [neon-setup.md](./neon-setup.md) | Full Neon project setup, Hyperdrive config, PrismaClient factory |
| [neon-branching.md](./neon-branching.md) | PR branch lifecycle, workflow details, troubleshooting |
| [local-dev.md](./local-dev.md) | Local Docker PostgreSQL setup |
| [migration-checklist.md](./migration-checklist.md) | D1 → Neon one-time migration checklist |
| [prisma-deno-compatibility.md](./prisma-deno-compatibility.md) | Why `deno task db:generate` must be used instead of `npx prisma generate` |

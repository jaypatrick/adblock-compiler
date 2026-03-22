# Neon Database Branching for PR Workflows

> **Phase 0** of the Neon PostgreSQL migration. Every pull request automatically
> receives an isolated, copy-on-write database branch so that schema changes and
> integration tests never touch the production dataset.

## Overview

When a pull request is opened (or updated), a GitHub Actions workflow creates a
**Neon database branch** forked from `production`. Prisma migrations are applied to the
new branch, and the connection string is posted as a PR comment. When the PR is
closed or merged the branch is deleted automatically.

Because Neon branches are copy-on-write, they share storage with the parent until
data diverges — making them essentially free to create and fast to spin up.

## How It Works

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant GH as GitHub
    participant GA as GitHub Actions
    participant Neon as Neon API
    participant DB as Neon Branch DB
    participant Prisma as Prisma CLI

    Dev->>GH: Opens / updates Pull Request
    GH->>GA: Triggers neon-branch-create workflow
    GA->>Neon: Create branch pr-<number> (parent: production)
    Neon-->>GA: Returns connection string
    GA->>Prisma: npx prisma migrate deploy
    Prisma->>DB: Applies pending migrations
    DB-->>Prisma: Migrations applied ✅
    GA->>GH: Posts PR comment with connection details
    GH-->>Dev: Sees branch info in PR comment

    Note over Dev,DB: Developer works on the PR…

    Dev->>GH: Merges / closes Pull Request
    GH->>GA: Triggers neon-branch-cleanup workflow
    GA->>Neon: Delete branch pr-<number>
    Neon-->>GA: Branch deleted ✅
```

## Workflow Files

| File | Trigger | Purpose |
|------|---------|---------|
| `.github/workflows/neon-branch-create.yml` | `pull_request: [opened, reopened, synchronize]` | Creates the Neon branch + runs migrations |
| `.github/workflows/neon-branch-cleanup.yml` | `pull_request: [closed]` | Deletes the Neon branch |

## Required GitHub Repository Secrets

The following secrets must be configured in **Settings → Secrets and variables →
Actions** for the repository:

| Secret | Description | Where to find it |
|--------|-------------|-------------------|
| `NEON_API_KEY` | Neon API authentication token | [Neon Console → Account → API Keys](https://console.neon.tech/app/settings/api-keys) |
| `NEON_PROJECT_ID` | Neon project identifier (e.g. `twilight-river-73901472`) | [Neon Console → Project Settings](https://console.neon.tech/) |
| `NEON_DATABASE_URL` | Connection string for the **main** branch | Neon Console → Connection Details (select the `main` branch) |

> **Note:** The `NEON_DATABASE_URL` secret stores the connection string for the
> *main* branch. The PR workflows dynamically override this with the branch-
> specific URL returned by the create-branch action — the secret is used as a
> baseline for other workflows (e.g. scheduled jobs, production deploys).

## Branch Naming Convention

All PR branches follow the pattern:

```
pr-<pull_request_number>
```

For example, PR #42 creates a Neon branch called `pr-42`.

## Connecting to a PR Branch for Debugging

When a PR branch is created, a comment is posted on the PR with the connection
string. You can use this to connect from any PostgreSQL client:

### Using psql

```bash
# Copy the connection string from the PR comment
psql "postgresql://neondb_owner:****@ep-xyz-123.eastus2.azure.neon.tech/adblock-compiler?sslmode=require"
```

### Using your local `.env`

```bash
# Override DATABASE_URL in your local .env to point at the PR branch
DATABASE_URL="postgresql://neondb_owner:****@ep-xyz-123.eastus2.azure.neon.tech/adblock-compiler?sslmode=require"

# Then run your local dev server — it will use the PR's isolated database
pnpm run dev
```

### Using Prisma Studio

```bash
DATABASE_URL="<connection-string-from-pr-comment>" npx prisma studio
```

## Architecture Decisions

### Why Neon Branching?

```mermaid
flowchart LR
    subgraph Traditional["Traditional Approach"]
        direction TB
        A[Shared staging DB] --> B[Schema conflicts]
        A --> C[Test data pollution]
        A --> D[Manual cleanup]
    end

    subgraph NeonBranch["Neon Branching"]
        direction TB
        E[Branch per PR] --> F[Full isolation]
        E --> G[Production-like data]
        E --> H[Auto-cleanup on merge]
    end

    Traditional -.->|replaced by| NeonBranch

    style Traditional fill:#fee,stroke:#c33
    style NeonBranch fill:#efe,stroke:#3c3
```

- **Isolation** — each PR gets its own database; no cross-contamination between
  feature branches.
- **Production parity** — branches fork from `production`, so they contain the same
  schema and (optionally) the same data as production.
- **Zero cost at rest** — Neon branches use copy-on-write storage; unchanged pages
  are shared with the parent.
- **Automatic lifecycle** — branches are created and destroyed by CI with no
  manual intervention.

### Relationship to Existing `db-migrate.yml`

The existing `db-migrate.yml` workflow handles migration validation and deployment
to production backends (D1, PostgreSQL). The Neon branching workflows are
complementary:

| Workflow | Scope | When |
|----------|-------|------|
| `db-migrate.yml` | Validate + deploy to production DBs | Push to `main` or PR touching `migrations/` |
| `neon-branch-create.yml` | Create isolated PR branch + migrate | Any PR opened/updated |
| `neon-branch-cleanup.yml` | Destroy PR branch | Any PR closed |

## Git Branching Strategy

### Your current workflow is correct

```mermaid
flowchart LR
    F["fix/ feature/ docs branch"] -->|PR + merge| M["main"]
    M -->|deploy| P["production"]

    F -.->|"Neon creates pr-N branch\n(forked from Neon production)"| NP["Neon pr-N\n(ephemeral)"]
    NP -.->|"PR closed/merged:\nNeon deletes pr-N"| X["🗑️ deleted"]
```

The standard git flow — `fix/`, `feature/`, or `docs/` branches → PR → merge into
`main` → deploy to production — does **not** need to change. Neon branches are
a CI concern only; they live and die with the PR automatically.

### How Neon branches map to your environments

| Git branch | Neon branch | Purpose |
|---|---|---|
| Any open PR | `pr-<number>` (auto-created) | Isolated migration testing for that PR |
| `main` | `main` | Staging / pre-production schema snapshot |
| _production deploy_ | `production` (**Default**) | Live production database |

> **Note:** The `main` Neon branch visible in the console is a legacy branch that
> predates the `production` branch being set as Default. PR branches fork from
> `production` (not `main`) so they always have production-parity schema.
> The `main` Neon branch can be kept as a staging target or deleted once a
> proper staging environment is in place.

### Do you need more Neon branches for multiple environments?

Not yet. The current setup handles two environments:

- **Production** — the `production` Neon branch, connected via Hyperdrive
- **PR preview** — ephemeral `pr-N` branches, auto-created/deleted by CI

If you add a dedicated **staging** environment later (e.g. a staging Cloudflare Worker
deploy), create a persistent `staging` Neon branch and point your staging
`DIRECT_DATABASE_URL` at it. No changes to the PR workflow would be needed.

## Troubleshooting

### Branch already exists

If the Neon branch already exists (e.g. from a previous run), the create action
will update it in place. No action needed.

### Prisma error P3009 — failed migration blocking deploy

**Symptom:**
```
Error: P3009
migrate found failed migrations in the target database, new migrations will not be applied.
The `<migration_name>` migration started at <timestamp> failed
```

**Cause:** A previous CI run failed mid-migration (e.g. due to a duplicate table,
connection drop, or syntax error). Prisma records the migration as "failed" in the
`_prisma_migrations` table and blocks all future deploys until it is resolved.

**Automatic fix:** The `neon-branch-create.yml` workflow detects this condition and
automatically restores the PR branch to its `production` parent tip before re-running
migrations. Simply push a new commit (or click "Re-run jobs") to trigger a fresh run.

**Manual fix (if automatic recovery fails):**
```bash
# Option 1 — resolve via Prisma CLI (marks the migration as rolled-back)
DIRECT_DATABASE_URL="<branch-connection-string>" \
  npx prisma migrate resolve --rolled-back <migration_name>

# Option 2 — restore the entire branch to its parent state via the Neon API
#             (safest for PR branches — completely fresh schema + migration history)
curl -sf -X POST \
  "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}/restore" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"source_type":"parent"}'
```

### Migrations fail on the branch

Check the GitHub Actions log for the `Run Prisma migrations` step. Common causes:

1. **Migration drift** — a migration was applied to the branch but the file was
   later removed from the repo. Push a new commit; the workflow's P3009 recovery
   step will restore the branch and re-apply the canonical migration set.
2. **Invalid migration SQL** — fix the migration in your PR and push again.

### Why can't migrations go through Hyperdrive?

**Hyperdrive is a Cloudflare edge service.** It is only accessible from code running
inside a Cloudflare Worker on Cloudflare's global network. GitHub Actions runners are
standard Linux VMs that live entirely outside Cloudflare's network.

| Consumer | Connection path | Why |
|----------|----------------|-----|
| Cloudflare Worker (production) | `env.HYPERDRIVE.connectionString` → Neon | Edge-local pooling, warm connections, sub-ms overhead |
| GitHub Actions CI (migrations) | `DIRECT_DATABASE_URL` → Neon directly | Hyperdrive unreachable outside Workers |
| Local dev (Docker) | `postgresql://adblock:localdev@localhost:5432/adblock_dev` | Offline, no credentials |
| Local dev (Neon branch) | `DIRECT_DATABASE_URL` → Neon directly | Same as CI path |

This is correct and expected architecture — not a bug.

### Branch not deleted after merge

The cleanup workflow runs on `pull_request: [closed]`. If it fails, you can
manually delete the branch from the Neon Console or via the API:

```bash
curl -X DELETE \
  "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}" \
  -H "Authorization: Bearer ${NEON_API_KEY}"
```

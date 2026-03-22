# Neon Database Branching for PR Workflows

> **Phase 0** of the Neon PostgreSQL migration. Every pull request automatically
> receives an isolated, copy-on-write database branch so that schema changes and
> integration tests never touch the production dataset.

## Overview

When a pull request is opened (or updated), a GitHub Actions workflow creates a
**Neon database branch** forked from `main`. Prisma migrations are applied to the
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
    GA->>Neon: Create branch pr-<number> (parent: main)
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
psql "postgresql://neondb_owner:****@ep-xyz-123.eastus2.azure.neon.tech/neondb?sslmode=require"
```

### Using your local `.env`

```bash
# Override DATABASE_URL in your local .env to point at the PR branch
DATABASE_URL="postgresql://neondb_owner:****@ep-xyz-123.eastus2.azure.neon.tech/neondb?sslmode=require"

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
- **Production parity** — branches fork from `main`, so they contain the same
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

## Troubleshooting

### Branch already exists

If the Neon branch already exists (e.g. from a previous run), the create action
will update it in place. No action needed.

### Migrations fail on the branch

Check the GitHub Actions log for the `Run Prisma migrations` step. Common causes:

1. **Migration drift** — the PR branch was created from `main` but `main` has
   since received new migrations. Re-running the workflow (push a new commit or
   use the "Re-run jobs" button) will recreate the branch from the latest `main`.
2. **Invalid migration SQL** — fix the migration in your PR and push again.

### Branch not deleted after merge

The cleanup workflow runs on `pull_request: [closed]`. If it fails, you can
manually delete the branch from the Neon Console or via the API:

```bash
curl -X DELETE \
  "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}" \
  -H "Authorization: Bearer ${NEON_API_KEY}"
```

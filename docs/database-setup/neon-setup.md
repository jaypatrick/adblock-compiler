# Neon PostgreSQL Setup

> **Phase 1 — Database Migration Documentation**
>
> This document covers the production Neon PostgreSQL configuration, Cloudflare Hyperdrive
> connection pooling, Prisma ORM integration, and local development workflow.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Neon Project Details](#neon-project-details)
- [Hyperdrive Configuration](#hyperdrive-configuration)
- [PrismaClient Factory](#prismaclient-factory)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Prisma Schema & Migrations](#prisma-schema--migrations)
- [Troubleshooting](#troubleshooting)

---

## Overview

The adblock-compiler uses **Neon PostgreSQL** as its primary production database. Neon provides:

| Capability | What It Means |
|---|---|
| **Serverless PostgreSQL** | Compute scales to zero when idle, scales up automatically under load |
| **Branching** | Create instant copy-on-write database branches for previews, CI, and testing |
| **Auto-scaling** | No capacity planning — Neon adjusts compute units (CU) based on query load |
| **Azure Integration** | Hosted in Azure East US 2, colocated with our Cloudflare Worker placement |

Connections from the Cloudflare Worker never go directly to Neon. Instead, they pass
through **Cloudflare Hyperdrive**, which provides connection pooling, caching, and
latency reduction by keeping persistent TCP connections to the database.

---

## Architecture

```mermaid
flowchart LR
    A["Client Request"] --> B["Cloudflare Worker<br/>(Hono)"]
    B --> C["createPrismaClient()"]
    C --> D["@prisma/adapter-pg<br/>(PrismaPg)"]
    D --> E["Cloudflare Hyperdrive<br/>(Connection Pool)"]
    E --> F["Neon PostgreSQL<br/>(Azure East US 2)"]

    style A fill:#e8f4f8,stroke:#2196F3
    style B fill:#fff3e0,stroke:#FF9800
    style C fill:#f3e5f5,stroke:#9C27B0
    style D fill:#f3e5f5,stroke:#9C27B0
    style E fill:#e8f5e9,stroke:#4CAF50
    style F fill:#e3f2fd,stroke:#1565C0
```

### How Data Flows

1. **Client request** arrives at the Cloudflare Worker edge
2. **Smart Placement** routes the Worker to a colo near Neon (Azure East US 2)
3. The Hono route handler calls **`createPrismaClient()`** with the Hyperdrive connection string
4. Prisma uses **`@prisma/adapter-pg`** (the `PrismaPg` driver adapter) to issue SQL
5. The connection targets **Hyperdrive's local proxy socket** — not Neon directly
6. Hyperdrive maintains a **warm pool of TCP connections** to Neon and multiplexes queries
7. Neon processes the query and returns results back through the chain

> **Key insight:** Because Hyperdrive *is* the connection pool, creating a new
> `PrismaClient` per request is safe and expected. Each `new PrismaClient()` connects
> to Hyperdrive's local proxy socket, not to PostgreSQL over the network.

---

## Neon Project Details

| Property | Value |
|---|---|
| **Organization** | `org-frosty-tree-11961273` |
| **Project name** | `adblock-db` _(the Neon project container)_ |
| **Project ID** | `twilight-river-73901472` |
| **Region** | Azure East US 2 |
| **PostgreSQL database** | `adblock-compiler` _(the database inside the project)_ |
| **Default branch** | `production` |
| **REST API Endpoint** | `ep-winter-term-a8rxh2a9.apirest.eastus2.azure.neon.tech/adblock-compiler/rest/v1` |
| **Pooled Endpoint** | `ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech` |
| **Dashboard** | [console.neon.tech](https://console.neon.tech) → org-frosty-tree-11961273 |

> **Project vs Database:** In Neon, a _project_ (`adblock-db`) is the top-level container
> that holds branches and compute. A _database_ (`adblock-compiler`) is the actual
> PostgreSQL database inside a branch. Connection strings always end with the
> **database name**, not the project name:
> `postgresql://…/adblock-compiler?sslmode=require`

### Connection String Format

```
postgresql://<user>:<password>@ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech/adblock-compiler?sslmode=require
```

- Always use the **pooler** endpoint (`-pooler` suffix) for application connections
- Use the **direct** (non-pooler) endpoint only for Prisma migrations
- SSL is required (`sslmode=require`)

---

## Hyperdrive Configuration

[Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/) sits between the
Worker and Neon, providing:

- **Connection pooling** — reuses persistent TCP connections instead of establishing a
  new TLS handshake per query
- **Query caching** — configurable caching of read queries
- **Latency reduction** — Hyperdrive nodes are colocated with Workers via Smart Placement

```mermaid
flowchart TB
    subgraph Worker["Cloudflare Worker (Edge)"]
        P["PrismaClient + PrismaPg"]
    end

    subgraph HD["Hyperdrive (Connection Pool)"]
        direction TB
        LP["Local Proxy Socket"]
        Pool["TCP Connection Pool<br/>Warm connections to Neon"]
    end

    subgraph Neon["Neon PostgreSQL"]
        DB["adblock-compiler<br/>Azure East US 2"]
    end

    P -->|"Connects to<br/>local socket"| LP
    LP --> Pool
    Pool -->|"Persistent<br/>TLS connections"| DB

    style Worker fill:#fff3e0,stroke:#FF9800
    style HD fill:#e8f5e9,stroke:#4CAF50
    style Neon fill:#e3f2fd,stroke:#1565C0
```

### wrangler.toml Reference

The Hyperdrive binding and Smart Placement are configured in `wrangler.toml`:

```toml
# ─── Placement ───────────────────────────────────────────────────────────────
# Smart placement: prefer colos near Neon (Azure East US 2)
[placement]
mode = "smart"

# ─── Hyperdrive ──────────────────────────────────────────────────────────────
# Production connection string is set via `wrangler hyperdrive update`.
# For local dev, set the connection string in .dev.vars (gitignored):
#   CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://...
# Do NOT put credentials in localConnectionString here.
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "800f7e2edc86488ab24e8621982e9ad7"
```

| Setting | Purpose |
|---|---|
| `binding = "HYPERDRIVE"` | Exposes `env.HYPERDRIVE` in the Worker runtime with a `.connectionString` property |
| `id = "800f7e2e..."` | The Hyperdrive configuration ID (set via `wrangler hyperdrive create`) |
| `[placement] mode = "smart"` | Cloudflare automatically runs the Worker in a colo near the database, reducing round-trip latency |

### How Smart Placement Works

Without Smart Placement, the Worker runs at the nearest edge to the *user*. With
`mode = "smart"`, Cloudflare analyses the Worker's backend traffic and preferentially
schedules it in a colo near **Neon's Azure East US 2 region**. This trades a few
milliseconds of user→edge latency for significantly lower Worker→database latency,
which is almost always a net win for database-heavy routes.

---

## PrismaClient Factory

The PrismaClient factory lives in **`worker/lib/prisma.ts`** and is the single entry
point for all database access from the Worker.

### Source

```typescript
// worker/lib/prisma.ts

import { PrismaClient } from '../../prisma/generated/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClientConfigSchema } from './prisma-config.ts';

export function createPrismaClient(
    hyperdriveConnectionString: string
): InstanceType<typeof PrismaClient> {
    // Validate the connection string is a valid postgresql:// URL
    PrismaClientConfigSchema.parse({ connectionString: hyperdriveConnectionString });

    const adapter = new PrismaPg({ connectionString: hyperdriveConnectionString });
    return new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
}
```

### Validation Schema

The connection string is validated by a Zod schema in `worker/lib/prisma-config.ts`:

```typescript
// worker/lib/prisma-config.ts

import { z } from 'zod';

export const PrismaClientConfigSchema = z.object({
    connectionString: z.string().url().startsWith('postgresql://'),
});
```

This catches misconfiguration early — if `HYPERDRIVE` is undefined or the connection
string is malformed, you get a clear Zod error instead of a cryptic `pg` driver failure.

### Usage in a Hono Handler

```typescript
import { createPrismaClient } from '../lib/prisma.ts';
import type { HonoContext } from '../types.ts';

app.get('/api/users/:id', async (c: HonoContext) => {
    // Create a PrismaClient for this request
    // Safe to do per-request — Hyperdrive IS the connection pool
    const prisma = createPrismaClient(c.env.HYPERDRIVE!.connectionString);

    try {
        const user = await prisma.user.findUnique({
            where: { id: c.req.param('id') },
        });

        if (!user) return c.json({ error: 'Not found' }, 404);
        return c.json({ user });
    } finally {
        // Disconnect to release the Hyperdrive proxy socket
        await prisma.$disconnect();
    }
});
```

### Type Definition

The `HYPERDRIVE` binding is typed as optional in `worker/types.ts`:

```typescript
export type HyperdriveBinding = globalThis.Hyperdrive;

export interface Env {
    // ... other bindings ...
    HYPERDRIVE?: HyperdriveBinding;
    // ... other bindings ...
}
```

The `Hyperdrive` global type comes from `@cloudflare/workers-types` and exposes a
single property: `.connectionString` (a `postgresql://` URL pointing to the local
Hyperdrive proxy socket).

---

## Local Development

For local development, you have two options:

1. **Docker PostgreSQL** (recommended) — a local PostgreSQL 16 instance
2. **Neon dev branch** — connect to a Neon branch for cloud-based local dev

### Option 1: Docker PostgreSQL (Recommended)

#### Start the Database

```bash
docker compose up postgres -d
```

This starts PostgreSQL 16 Alpine with:

| Property | Value |
|---|---|
| **Host** | `127.0.0.1` |
| **Port** | `5432` |
| **Database** | `adblock_dev` |
| **Username** | `adblock` |
| **Password** | `localdev` |

#### Configure the Local Connection

Add to `.dev.vars` (gitignored):

```bash
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev
```

This tells `wrangler dev` to route Hyperdrive queries to your local PostgreSQL instead
of Neon.

#### Configure Prisma

Add to `.env.local` (gitignored):

```bash
DATABASE_URL=postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev
DIRECT_DATABASE_URL=postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev
```

#### Run Migrations

```bash
# Apply all migrations to the local database
deno task db:migrate

# Or push the schema without creating migration files (for quick iteration)
deno task db:push
```

#### Verify

```bash
# Open Prisma Studio to browse your local data
deno task db:studio
```

### Option 2: Neon Dev Branch

See [neon-branching.md](./neon-branching.md) for creating isolated database branches.

### Local Dev Workflow Summary

```mermaid
flowchart TD
    A["docker compose up postgres -d"] --> B["Configure .dev.vars"]
    B --> C["deno task db:migrate"]
    C --> D["deno task dev"]
    D --> E["Worker → Hyperdrive (local) → Docker PostgreSQL"]

    style A fill:#e3f2fd,stroke:#1565C0
    style B fill:#fff3e0,stroke:#FF9800
    style C fill:#f3e5f5,stroke:#9C27B0
    style D fill:#e8f5e9,stroke:#4CAF50
    style E fill:#fce4ec,stroke:#E91E63
```

---

## Environment Variables

### Worker Runtime (set in `.dev.vars` for local, Cloudflare dashboard for production)

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | Local dev only | PostgreSQL connection string for `wrangler dev` to use instead of Neon. Points to Docker PostgreSQL (`127.0.0.1:5432`) or a Neon dev branch. |

> **Note:** In production, the Hyperdrive binding (`env.HYPERDRIVE`) provides the
> connection string automatically. There is no `DATABASE_URL` needed at runtime.

### Prisma CLI / Migrations (set in `.env.local`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Connection string for `prisma generate`, `prisma db push`, and general Prisma CLI operations. Use the local Docker PostgreSQL URL or a Neon pooled endpoint. |
| `DIRECT_DATABASE_URL` | Recommended | Direct (non-pooled) connection string for `prisma migrate dev`. Bypasses connection pooling which can interfere with migration locks. **Takes priority** over `DATABASE_URL` in `prisma.config.ts`. |

### Neon Management (CI/CD and automation)

| Variable | Required | Description |
|---|---|---|
| `NEON_API_KEY` | CI/CD only | Neon API key for branch creation, deletion, and management. Used in GitHub Actions. |
| `NEON_PROJECT_ID` | CI/CD only | The Neon project ID (`twilight-river-73901472`). Used alongside `NEON_API_KEY` for API calls. |

### How `prisma.config.ts` Resolves the URL

```typescript
// prisma.config.ts — simplified

const datasourceUrl =
    process.env.DIRECT_DATABASE_URL?.trim() ||   // 1st: direct URL (bypasses pooling)
    process.env.DATABASE_URL?.trim();             // 2nd: fallback

export default defineConfig({
    datasource: { url: datasourceUrl },
});
```

**Priority order:**
1. `DIRECT_DATABASE_URL` (if set and non-empty) — best for migrations
2. `DATABASE_URL` — fallback for everything else

---

## Prisma Schema & Migrations

### Schema Location

```
prisma/
├── schema.prisma          # Main schema (PostgreSQL datasource)
├── generated/             # Generated Prisma client (gitignored)
├── migrations/            # Migration history
└── schema.d1.prisma       # Legacy D1/SQLite schema (deprecated)
```

### Generator Configuration

```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated"
}

datasource db {
  provider = "postgresql"
  // URL is configured in prisma.config.ts (Prisma 7+)
}
```

### Database Tasks

| Task | Command | Description |
|---|---|---|
| **Generate client** | `deno task db:generate` | Generates the Prisma client and runs the import fixer script |
| **Run migrations** | `deno task db:migrate` | Creates and applies migration files |
| **Push schema** | `deno task db:push` | Pushes schema changes without creating migration files (dev only) |
| **Open Studio** | `deno task db:studio` | Opens the Prisma Studio web UI |

> ⚠️ **Always use `deno task db:generate`**, not `npx prisma generate`. The deno task
> runs a post-generate script (`scripts/prisma-fix-imports.ts`) that fixes import paths
> for Deno compatibility.

---

## Troubleshooting

### Connection Refused (Local Dev)

**Symptom:** `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Fix:**
```bash
# Is PostgreSQL running?
docker compose ps postgres

# Start it if not
docker compose up postgres -d

# Check logs if it won't start
docker compose logs postgres
```

### "HYPERDRIVE is undefined"

**Symptom:** `TypeError: Cannot read properties of undefined (reading 'connectionString')`

**Fix:** Ensure `.dev.vars` contains the Hyperdrive local connection string:
```bash
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev
```

Then restart `wrangler dev` — it only reads `.dev.vars` at startup.

### Prisma Client Not Found / Import Errors

**Symptom:** `Cannot find module '../../prisma/generated/client.ts'`

**Fix:**
```bash
# Regenerate the client (includes the Deno import fixer)
deno task db:generate
```

Do **not** use `npx prisma generate` — it skips the import path fixer that Deno requires.

### Zod Validation Error on Connection String

**Symptom:** `ZodError: String must be a valid URL / Expected string to start with "postgresql://"`

**Cause:** The Hyperdrive binding returned an invalid or empty connection string.

**Fix:**
- **Local dev:** Check that `.dev.vars` has the correct `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` value starting with `postgresql://`
- **Production:** Verify the Hyperdrive configuration has a valid connection string:
  ```bash
  npx wrangler hyperdrive get 800f7e2edc86488ab24e8621982e9ad7
  ```

### Migration Fails with "prepared statement already exists"

**Symptom:** Prisma migration commands fail with pooling-related errors.

**Fix:** Use `DIRECT_DATABASE_URL` (non-pooled endpoint) for migrations:
```bash
# .env.local
DIRECT_DATABASE_URL=postgresql://<user>:<password>@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/adblock-compiler?sslmode=require
```

Note the **non-pooler** hostname (no `-pooler` suffix). `prisma.config.ts` automatically
prefers `DIRECT_DATABASE_URL` over `DATABASE_URL`.

### SSL / Channel Binding Errors

**Symptom:** `Error: channel binding is required but server did not offer it`

**Fix:** Ensure your connection string includes `sslmode=require`. If connecting to
Neon's pooler endpoint, `channel_binding=require` may also be needed:
```
postgresql://user:pass@...pooler.eastus2.azure.neon.tech/db?sslmode=require&channel_binding=require
```

### Docker PostgreSQL Data Reset

To start fresh with a clean database:

```bash
docker compose down -v   # -v removes the pgdata volume
docker compose up postgres -d
deno task db:migrate     # Re-apply all migrations
```

---

## Further Reading

- [Neon Branching Guide](./neon-branching.md) — database branching for preview deployments
- [Database Architecture](./DATABASE_ARCHITECTURE.md) — overall database design decisions
- [Prisma + Deno Compatibility](./prisma-deno-compatibility.md) — Deno-specific Prisma setup notes
- [Local Dev Guide](./local-dev.md) — broader local development setup
- [Neon Documentation](https://neon.tech/docs)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
- [Prisma + Cloudflare Workers](https://www.prisma.io/docs/orm/overview/databases/neon#cloudflare-workers)

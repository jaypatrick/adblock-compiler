# Local Development Database Setup

This guide covers setting up a local PostgreSQL database for development using Docker.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose)
- [Deno](https://deno.land/) ≥ 2.x (for running Prisma tasks)
- [direnv](https://direnv.net/) (optional, for automatic env loading)

## Quick Start

```bash
# 1. Start the local PostgreSQL container
deno task db:local:up

# 2. Push the Prisma schema to create all tables
deno task db:local:push

# 3. Start the Worker dev server (connects via Hyperdrive local override)
deno task wrangler:dev
```

## Architecture

```mermaid
flowchart LR
    subgraph Local["Local Machine"]
        W["wrangler dev<br/>(Worker)"]
        P["Prisma CLI<br/>(migrations)"]
        S["Prisma Studio<br/>(GUI)"]
    end

    subgraph Docker["Docker"]
        PG["PostgreSQL 16<br/>port 5432"]
    end

    W -->|"Hyperdrive local<br/>override"| PG
    P -->|"DIRECT_DATABASE_URL"| PG
    S -->|"DIRECT_DATABASE_URL"| PG
```

### Custom Port

If port 5432 is in use, override with the `POSTGRES_PORT` environment variable:

```bash
POSTGRES_PORT=5555 docker compose up -d postgres
# Then update connection strings in .env.local and .dev.vars to match
```

## Deno Task Reference

| Task | Description |
|------|-------------|
| `deno task db:local:up` | Start Docker PostgreSQL container |
| `deno task db:local:down` | Stop Docker PostgreSQL container |
| `deno task db:local:push` | Sync Prisma schema → local DB (creates all tables) |
| `deno task db:local:migrate` | Run pending Prisma migrations against local DB |
| `deno task db:local:reset` | Destroy volume + recreate DB + push schema (fresh start) |
| `deno task db:local:studio` | Open Prisma Studio GUI for local DB |

## Docker Services

### `postgres` — PostgreSQL 16 Alpine

| Property | Value |
|----------|-------|
| Image | `postgres:16-alpine` |
| Host port | `5432` (configurable via `$POSTGRES_PORT`) |
| Database | `adblock_dev` |
| User | `adblock` |
| Password | `localdev` |
| Extensions | `pgcrypto`, `citext` (auto-enabled on first start) |

### `db-migrate` — One-Shot Migration Runner

Runs `prisma migrate deploy` inside Docker (useful for CI or when you don't have Deno locally):

```bash
docker compose up postgres db-migrate
```

## Environment Files

### `.env.local` (gitignored)

Used by Prisma CLI for migrations and schema operations:

```env
DATABASE_URL="postgresql://adblock:localdev@localhost:5432/adblock_dev"
DIRECT_DATABASE_URL="postgresql://adblock:localdev@localhost:5432/adblock_dev"
```

### `.dev.vars` (gitignored)

Used by `wrangler dev` to override the Hyperdrive binding locally:

```env
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://adblock:localdev@localhost:5432/adblock_dev
```

Copy `.dev.vars.example` as a starting point:

```bash
cp .dev.vars.example .dev.vars
```

### `.envrc` (direnv)

Loads `.env`, `.env.local`, and `.dev.vars` automatically when you `cd` into the project:

```bash
direnv allow .
```

## Switching Between Local and Neon

### Local Docker (default for development)

```env
# .env.local
DATABASE_URL="postgresql://adblock:localdev@localhost:5432/adblock_dev"
DIRECT_DATABASE_URL="postgresql://adblock:localdev@localhost:5432/adblock_dev"
```

### Neon Direct (for testing against production-like DB)

```env
# .env.local
DATABASE_URL="postgresql://user:password@ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech/neondb?sslmode=require"
DIRECT_DATABASE_URL="postgresql://user:password@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/neondb?sslmode=require"
```

> **Tip:** Keep both sets of connection strings in `.env.local` and comment/uncomment as needed.

## Common Workflows

### First-Time Setup

```bash
# Start postgres
deno task db:local:up

# Create all tables from Prisma schema
deno task db:local:push

# Generate Prisma client (for IDE autocomplete)
deno task db:generate

# Start dev server
deno task wrangler:dev
```

### After Pulling New Schema Changes

```bash
# Apply any new migrations
deno task db:local:migrate

# Regenerate Prisma client
deno task db:generate
```

### Fresh Reset (Nuclear Option)

```bash
# Destroys the Docker volume, recreates everything
deno task db:local:reset
```

### Inspect Data with Prisma Studio

```bash
deno task db:local:studio
# Opens browser at http://localhost:5555
```

### Create a New Migration

```bash
# Make changes to prisma/schema.prisma, then:
deno task db:migrate --name describe_your_change
```

This creates a migration file in `prisma/migrations/` and applies it to your local DB.

## Troubleshooting

### "Port 5432 already in use"

Another process is using the port. Check with:

```bash
lsof -i :5432
```

Override the port:

```bash
POSTGRES_PORT=5434 docker compose up -d postgres
# Update connection strings in .env.local and .dev.vars to match
```

### "role 'adblock' does not exist"

You're connecting to a **locally-installed** PostgreSQL instead of Docker. This happens when
a Homebrew or PGlite postgres is running on the same port. Verify Docker is running:

```bash
docker compose ps postgres
```

And ensure your connection string uses port **5432** (not 5432). Check for port conflicts:

```bash
lsof -i :5432
```

### "Cannot find module 'prisma/config'"

The Prisma CLI npm package isn't installed. Run:

```bash
pnpm install
```

Or use Deno directly (the `db:local:*` tasks do this automatically):

```bash
deno run -A npm:prisma db push
```

### Migration Fails on Fresh DB

The incremental migrations assume existing tables. For a fresh local database, use `db push` first:

```bash
deno task db:local:push
```

Then mark existing migrations as applied:

```bash
DIRECT_DATABASE_URL=postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev \
  deno run -A npm:prisma migrate resolve --applied <migration_name>
```

### Extensions Not Available

If `gen_random_uuid()` or `citext` functions fail, the init script may not have run.
Reset the volume:

```bash
deno task db:local:reset
```

The `scripts/docker-init-db.sql` init script enables `pgcrypto` and `citext` extensions
on first volume creation.

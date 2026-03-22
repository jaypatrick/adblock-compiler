# Database Setup

Documentation for database architecture, setup, migration, and backend evaluation.

## Contents

### Neon PostgreSQL (Primary Database)

- [Neon Migration Summary](neon-migration-summary.md) — Complete record of the D1 → Neon migration, including scope, decisions, schema, CI/CD, and cross-references
- [Neon Setup](neon-setup.md) — Production configuration, Hyperdrive connection pooling, Prisma integration
- [Neon Branching](neon-branching.md) — Automated branch-per-PR workflows via GitHub Actions
- [Migration Checklist](migration-checklist.md) — One-time D1 → Neon data migration steps and verification
- [Edge Cache Architecture](edge-cache-architecture.md) — D1 as L1 edge cache with Neon as the primary store

### Prisma ORM

- [Prisma Schema Reference](prisma-schema-reference.md) — Field-level documentation for all 14 models
- [Prisma Deno Compatibility](prisma-deno-compatibility.md) — Import rewriting and `--env` flag notes for Deno

### Architecture & Evaluation

- [Database Architecture](DATABASE_ARCHITECTURE.md) — Schema design and storage layer overview
- [Local Development Setup](local-dev.md) — Neon cloud or Docker PostgreSQL for local development
- [PostgreSQL Modern](postgres-modern.md) — Modern PostgreSQL features and configuration
- [Database Evaluation](DATABASE_EVALUATION.md) — PlanetScale vs Neon vs Cloudflare vs Prisma comparison
- [Prisma Evaluation](PRISMA_EVALUATION.md) — Storage backend and ORM comparison
- [Migration Plan](plan.md) — Original migration planning document

## Quick Start

```bash
# One-command project setup (copies env templates, generates Prisma client)
deno task setup

# Or start a local Docker PostgreSQL
deno task db:local:up
```

## Related

- [Cloudflare D1](../cloudflare/CLOUDFLARE_D1.md) — Edge database / cache integration
- [Better Auth + Prisma](../auth/better-auth-prisma.md) — Auth provider database integration
- [Neon Troubleshooting](../troubleshooting/neon-troubleshooting.md) — Diagnosing connection and migration issues
- [Database Testing](../testing/database-testing.md) — Testing patterns for Prisma + Neon

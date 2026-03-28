# Scripts

This directory contains operational and maintenance scripts for the adblock-compiler project.

## Documentation

| Document                                                               | Description                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [troubleshooting-manual.md](./troubleshooting-manual.md)               | Support engineer quick-reference for common errors, health checks, and deployment verification |
| [../docs/operations/diagnostics.md](../docs/operations/diagnostics.md) | Full technical reference for the diagnostic system and `compress()` fix                        |

## Scripts

| Script                           | Description                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `diag.ts`                        | Diagnostic probe library — exports probe functions, no TTY dependency, CI-safe             |
| `diag-cli.ts`                    | Interactive/CI diagnostic CLI — run with `deno task diag` or `deno task diag:ci`           |
| `check-container-health.ts`      | Cloudflare Container health check — validates `/health` and `/compile` on container server |
| `validate-openapi.ts`            | Validates the OpenAPI spec against the live Worker                                         |
| `generate-openapi-schema.ts`     | Generates `docs/api/cloudflare-schema.yaml` from the OpenAPI spec                          |
| `generate-postman-collection.ts` | Generates Postman collection from OpenAPI spec                                             |
| `generate-endpoint-registry.ts`  | Generates the endpoint permission registry                                                 |
| `record-deployment.ts`           | Records a deployment event to the database                                                 |
| `prisma-fix-imports.ts`          | Fixes Prisma-generated imports after `prisma generate`                                     |
| `sync-version.ts`                | Syncs version across `package.json`, `deno.json`, and `src/version.ts`                     |
| `validate-migrations.ts`         | Validates Prisma migration files                                                           |
| `migrate-d1-to-neon.ts`          | One-time D1 → Neon migration script                                                        |
| `setup-env.ts`                   | Sets up local `.env.local` and `.dev.vars` files                                           |
| `setup-hooks.ts`                 | Installs Git hooks                                                                         |
| `generate-docs.ts`               | Generates mdBook documentation                                                             |
| `mdbook-last-updated.ts`         | Updates mdBook `last_updated` metadata                                                     |
| `display-ast.ts`                 | Displays the AST for a filter list                                                         |
| `lighthouse-summary.ts`          | Summarizes Lighthouse CI results                                                           |

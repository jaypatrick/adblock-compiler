---
description: "HARD RULE — Cloudflare deployment targets for this project. Cloudflare Pages is deprecated and banned. All new apps (APIs, SPAs, Angular frontends, documentation sites, preview environments) MUST use Cloudflare Workers, Workers + Static Assets, or Workers Builds. Read this file before scaffolding any new Cloudflare-hosted app."
name: cloudflare-deployment
---

## ⛔ Cloudflare Pages Is Banned — No Exceptions

Cloudflare Pages is **deprecated** and must **never** be used in this project. This rule applies to:

- Worker APIs
- Angular / SPA frontends
- Documentation sites (e.g. Storybook, Docusaurus, VitePress)
- Preview / staging environments
- Any other Cloudflare-hosted asset

There are no exceptions based on app type, size, or "it's just a docs site" rationale.

### Official Cloudflare References

- [Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers Builds (CI/CD)](https://developers.cloudflare.com/workers/ci-cd/builds/)

---

## ✅ Approved Cloudflare Deployment Targets

| Use case | Approved target |
|---|---|
| Worker API / full-stack app | **Cloudflare Worker** — `main` entry in `wrangler.toml` |
| Angular SPA / static site / docs | **Worker + Static Assets** — `assets.directory` in `wrangler.toml` |
| SPA with client-side routing | Worker + Static Assets with `not_found_handling = "single-page-application"` |
| CI/CD deploy pipeline | **Workers Builds** — Git-connected build pipeline in the Cloudflare dashboard or `wrangler.toml` `[build]` block |
| Preview / branch deploys | Workers Builds branch previews (not Pages preview environments) |

---

## ⛔ Banned Artefacts & Patterns

Never introduce any of the following:

| Banned | Reason |
|---|---|
| `wrangler pages dev` / `wrangler pages deploy` | Pages CLI commands |
| `*.pages.dev` subdomains | Pages-only domain |
| `@cloudflare/pages-plugin-*` packages | Pages-specific plugins |
| `_routes.json` | Pages routing config |
| `_redirects` (Pages-style) | Pages redirect syntax |
| `_headers` (Pages-style) | Pages header syntax |
| `functions/` directory (Pages Functions) | Pages Functions — use a Worker entry instead |
| `[site]` bucket without a Worker `main` | Legacy Workers Sites (also deprecated) |

---

## `wrangler.toml` Reference Templates

### Worker-only (API / full-stack)

```toml
name = "my-worker"
main = "worker/src/index.ts"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "..."

[[kv_namespaces]]
binding = "KV"
id = "..."
```

### Worker + Static Assets (Angular SPA / docs site)

```toml
name = "my-app"
main = "worker/src/index.ts"
compatibility_date = "2025-01-01"

[assets]
directory = "frontend/dist/adblock-compiler/browser"
not_found_handling = "single-page-application"

[build]
command = "pnpm --filter adblock-frontend run build"
```

> `not_found_handling = "single-page-application"` replaces the old `_redirects` hack from Pages.
> For a pure static site with no Worker logic, omit `main` and set `assets.directory` only.

---

## Workers Builds CI Stanza

```toml
[build]
command = "deno task build"
```

Workers Builds is configured via the Cloudflare dashboard (Settings → Builds) or via the `[build]` block above. It replaces the Pages Git integration entirely.

---

## Migration Checklist (Pages → Workers)

When migrating an existing Pages project or reviewing a PR that adds a new app:

- [ ] Remove all `wrangler pages` CLI invocations from scripts and CI workflows
- [ ] Replace `_redirects` / `_routes.json` / `_headers` with Worker middleware or `not_found_handling`
- [ ] Move `functions/` directory logic into a proper Worker entry (`worker/src/index.ts`)
- [ ] Update `wrangler.toml` — add `main` + `[assets]` block; remove any `[site]` block
- [ ] Remove `@cloudflare/pages-plugin-*` dependencies from `package.json` / `deno.json`
- [ ] Update DNS / custom domain from `*.pages.dev` to the Worker route or custom domain
- [ ] Update CI pipeline to use `wrangler deploy` (not `wrangler pages deploy`)
- [ ] Verify preview environments use Workers Builds branch previews

---

## PR Checklist — New Cloudflare App

Every PR that introduces a new Cloudflare-hosted application must pass all of the following:

- [ ] No `wrangler pages` commands anywhere (scripts, CI, `package.json`, `deno.json`)
- [ ] No `*.pages.dev` URLs in config, docs, or environment variables
- [ ] `wrangler.toml` uses `main` (Worker entry) and/or `[assets]` block
- [ ] Static assets served via `[assets]` with appropriate `not_found_handling`
- [ ] CI/CD uses Workers Builds or `wrangler deploy`
- [ ] No `_routes.json`, `_redirects`, `_headers`, or `functions/` directory
- [ ] No `@cloudflare/pages-plugin-*` packages
- [ ] ZTA checklist from `coding-style.agent.md` also satisfied

---

## Rationale

Cloudflare has signalled that Pages is a legacy product, with Workers + Static Assets being the unified, actively developed replacement. Using Pages creates a split deployment model, limits Worker runtime features (e.g. Durable Objects, Queues, D1 bindings), and couples the project to a deprecated CI/CD pipeline. Standardising on Workers ensures consistency, full platform capability, and long-term supportability across every app in this project.

# KB-007: Production Debugging Session — Sign-up 500 / curl 403 / Migration Drift (2026-04)

> **Status:** ✅ Resolved  
> **Affected versions:** v0.79.x  
> **Date:** 2026-04  
> **Components:** Worker routing, Cloudflare WAF, Better Auth, Neon PostgreSQL

---

## Summary

Four separate but related production issues surfaced in the same debugging session. Each had a distinct root cause, but together they prevented programmatic API access and caused 500 errors on user sign-up.

| # | Symptom | Root Cause | Fix |
|---|---------|-----------|-----|
| 1 | `curl` requests to `https://api.bloqr.dev/...` return `403 Forbidden` | Bot Fight Mode blocked non-browser clients; WAF bypass rule only covered `/api/admin/*` | Expanded bypass rule to `/api/*` |
| 2 | Sign-up returns `500 Internal Server Error` | Better Auth passed `name`/`image` field names; Prisma schema uses `displayName`/`imageUrl` | Added `fields: { name: 'displayName', image: 'imageUrl' }` mapping to `user:` block in `auth.ts` |
| 3 | All `curl` examples in docs used `https://api.bloqr.dev/<path>` — requests returned 404 | Production routes are mounted under `/api`; the correct base URL is `https://api.bloqr.dev/api` | Confirmed route mount; updated docs |
| 4 | Production database missing 4 migrations applied only to local branch | `prisma migrate deploy` had never been run against the production Neon branch | Ran migrations against production with `DIRECT_DATABASE_URL` set to production branch |

---

## Issue 1 — curl / Programmatic Clients Get 403 from Bot Fight Mode

### Symptom

```bash
curl -s https://api.bloqr.dev/api/version
# HTTP/1.1 403 Forbidden
# cf-mitigated: challenge
```

Browser requests worked fine. Any `curl` or non-browser HTTP client received a `403 Forbidden` with a `cf-mitigated: challenge` header.

### Root Cause

Cloudflare **Bot Fight Mode** was enabled on `api.bloqr.dev`. Bot Fight Mode blocks requests whose User-Agent or TLS fingerprint does not match a known browser. A WAF **bypass (skip) rule** existed to allow programmatic clients, but its expression scoped the bypass too narrowly to admin paths only:

```
# ❌ Old rule — only allows curl to /api/admin/*
(http.host eq "api.bloqr.dev") and (http.request.uri.path wildcard "/api/admin/*")
```

All other `/api/*` paths remained subject to Bot Fight Mode.

### Fix

Expand the WAF bypass rule expression to cover all API paths:

```
# ✅ Correct rule — allows programmatic clients to all /api/* paths
(http.host eq "api.bloqr.dev") and (http.request.uri.path wildcard "/api/*")
```

**Steps to apply (Cloudflare Dashboard):**

1. Go to **Security → WAF → Custom rules** for the `bloqr.dev` zone.
2. Find the rule named *"Allow programmatic clients on API"* (or similar).
3. Edit the **Expression** field and update the path wildcard from `/api/admin/*` to `/api/*`.
4. Set **Action** to `Skip → Bot Fight Mode`.
5. Save and verify:

```bash
curl -s https://api.bloqr.dev/api/version | jq .version
# "0.79.4"
```

> **Why not just turn off Bot Fight Mode entirely?**  
> Bot Fight Mode protects the frontend subdomain (`app.bloqr.dev`) from bot traffic. The bypass rule is scoped to `api.bloqr.dev` only, so the frontend remains protected.

---

## Issue 2 — Sign-up Returns 500 (Better Auth name/displayName Mismatch)

### Symptom

```bash
curl -X POST https://api.bloqr.dev/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"s3cret","name":"Alice"}'
# HTTP 500 Internal Server Error
```

`wrangler tail` showed:

```
PrismaClientValidationError: Unknown argument 'name'. Did you mean 'displayName'?
  Available arguments: id, email, displayName, imageUrl, emailVerified, tier, role, ...
```

### Root Cause

Better Auth's canonical user object uses `name` (for display name) and `image` (for avatar URL). The Prisma `User` model, however, uses `displayName` (column `display_name`) and `imageUrl` (column `image_url`) — matching the project's database naming conventions.

Without an explicit field name mapping, Better Auth passed `name` and `image` directly to Prisma on every sign-up and OAuth profile-sync operation. Prisma rejected these as unknown fields, causing a `PrismaClientValidationError` that surfaced as a 500 to the client.

### Fix

Add a `fields` mapping to the `user:` block in `worker/lib/auth.ts`:

```typescript
// worker/lib/auth.ts

export const USER_FIELD_MAPPING = {
    name: 'displayName', // Better Auth 'name'  → Prisma 'displayName' (display_name column)
    image: 'imageUrl',   // Better Auth 'image' → Prisma 'imageUrl'    (image_url column)
} as const;

// Inside createAuth():
user: {
    fields: USER_FIELD_MAPPING,   // ← this line was missing
    additionalFields: {
        tier: { type: 'string', required: false, defaultValue: 'free', input: false },
        role: { type: 'string', required: false, defaultValue: 'user', input: false },
    },
},
```

`USER_FIELD_MAPPING` is exported as a named constant so regression tests can assert the mapping without requiring a live database connection.

### Verification

```bash
curl -X POST https://api.bloqr.dev/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123","name":"Test User"}'
# HTTP 200 — {"token":"...","user":{"id":"...","email":"test@example.com","displayName":"Test User"}}
```

---

## Issue 3 — Production Base URL is `https://api.bloqr.dev/api` (not `/`)

### Background

All Hono routes are mounted under the `/api` prefix in `worker/hono-app.ts`:

```typescript
// worker/hono-app.ts
app.route('/api', routes);   // ← single mount point
// app.route('/', routes);   // ← this double-mount was intentionally removed in Phase 4
```

The bare domain `https://api.bloqr.dev/` is handled by the Worker's root handler, which redirects browsers to the API docs and returns a JSON info object to `Accept: application/json` clients. Actual API endpoints are **only** reachable under `/api`.

### Correct Base URL

| Use case | URL |
|----------|-----|
| Browser — API docs portal | `https://api.bloqr.dev/` (redirects to Scalar UI) |
| Programmatic — all API requests | `https://api.bloqr.dev/api` |

### Impact

Docs and curl examples that used `https://api.bloqr.dev/compile` (without the `/api` prefix) would receive a 404. All examples must use the full base URL:

```bash
# ❌ Wrong — missing /api prefix
curl -X POST https://api.bloqr.dev/compile ...

# ✅ Correct
curl -X POST https://api.bloqr.dev/api/compile ...
```

---

## Issue 4 — Production Neon Branch Missing 4 Migrations

### Symptom

After deploying a new Worker version to production, some features returned 500 errors with Prisma errors about missing columns or tables. Running `prisma migrate status` against the production branch showed:

```
4 migrations have not yet been applied:
  • 20260401000000_add_display_name_to_user
  • 20260401000001_add_image_url_to_user
  • 20260402000000_add_two_factor_table
  • 20260403000000_add_organization_tables
```

### Root Cause

`deno task db:migrate` / `prisma migrate dev` runs migrations against the **local** development database (Docker PostgreSQL or a personal Neon dev branch via `.dev.vars`). It does **not** touch the production Neon branch.

The CI `db-migrate.yml` workflow runs `prisma migrate deploy` on every push to `main` using the `DIRECT_DATABASE_URL` GitHub Actions secret — but that secret had been pointing at a staging/main Neon branch, not the `production` branch.

### Fix — Deploy Pending Migrations to Production

Use the **direct** (non-pooled) connection string for the production Neon branch and `deno task db:migrate:deploy` (or `prisma migrate deploy` directly):

```bash
# Obtain the production direct connection string from:
#   https://console.neon.tech → project adblock-db → branch: production → Connection Details → Direct
# It looks like: postgresql://neondb_owner:PASSWORD@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/adblock-compiler?sslmode=require

DIRECT_DATABASE_URL="postgresql://neondb_owner:<password>@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/adblock-compiler?sslmode=require" \
  deno task db:migrate:deploy
```

Or using `npx prisma migrate deploy` directly (equivalent, useful if Deno is not available):

```bash
DIRECT_DATABASE_URL="postgresql://neondb_owner:<password>@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/adblock-compiler?sslmode=require" \
  DATABASE_URL="postgresql://neondb_owner:<password>@ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech/adblock-compiler?sslmode=require" \
  npx prisma migrate deploy
```

> **Always use the direct (non-pooled) endpoint for migrations.** The pooler endpoint (`-pooler` in the hostname) is for application connections through Hyperdrive. Prisma requires a direct connection for DDL operations.

### Verify

```bash
DIRECT_DATABASE_URL="..." npx prisma migrate status
# All migrations have been applied.
```

### Prevention

Ensure the `DIRECT_DATABASE_URL` GitHub Actions secret in the `db-migrate.yml` workflow always points to the **production** Neon branch, not a dev or staging branch. See the [Neon Branching Strategy](../database-setup/branching-strategy.md) for the correct secret per branch.

---

## Diagnostic Sequence (Reproduced End-to-End)

```mermaid
flowchart TD
    A["curl POST /api/auth/sign-up/email\nreturns 403"] --> B{cf-mitigated header?}
    B -- Yes --> C["Bot Fight Mode blocking\n→ Fix WAF bypass rule\nto cover /api/*"]
    B -- No --> D["Route reachable\n→ check HTTP status"]
    C --> D
    D --> E{Status code?}
    E -- 404 --> F["Missing /api prefix in URL\n→ Use https://api.bloqr.dev/api as base"]
    E -- 500 --> G["Worker error\n→ check wrangler tail"]
    F --> G
    G --> H{Error message?}
    H -- "PrismaClientValidationError:\nUnknown argument 'name'" --> I["Better Auth field mapping missing\n→ Add fields: USER_FIELD_MAPPING\nto user: block in auth.ts"]
    H -- "relation does not exist\nor column does not exist" --> J["Pending migrations on production\n→ Run prisma migrate deploy\nwith production DIRECT_DATABASE_URL"]
    I --> K["Sign-up returns 200 ✅"]
    J --> K
```

---

## Related KB Articles

- [KB-001](./KB-001-api-not-available.md) — "Getting API is not available" on the main page
- [KB-002](./KB-002-hyperdrive-database-down.md) — Hyperdrive binding connected but `database` service reports `down`
- [KB-003](./KB-003-neon-hyperdrive-live-session-2026-03-25.md) — Database Down After Deploy — Live Debugging Session (2026-03-25)
- [KB-005](./KB-005-better-auth-cloudflare-ip-timeout.md) — Better Auth Cloudflare integration issues

---

## Feedback & Contribution

If you discovered a new failure mode while using this article, please open an issue tagged `troubleshooting` and `documentation` in `jaypatrick/adblock-compiler` with the details so it can be captured in a follow-up KB entry.

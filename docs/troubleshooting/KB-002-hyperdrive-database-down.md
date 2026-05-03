# KB-002: Hyperdrive Binding Connected but `database` Service Reports `down`

> **Status:** ✅ Active
> **Affected version:** v0.75.0
> **Resolved in:** PR fixing `PrismaClientConfigSchema` to accept `postgres://` + enhanced `/api/health` probe
> **Date:** 2026-03-25

---

## Session Log — 2026-03-25

This section captures the live troubleshooting session that led to the discovery of this KB article and the subsequent hardening work in v0.76.0+.

### Symptoms Observed

- UI showed **"Degraded performance — v0.75.0"** and **"Data may be stale"** banners on every page load
- `/api/health` returned `database.status: "down"` with `latency_ms: 0`
- Cloudflare Hyperdrive admin page showed **zero traffic** despite Neon dashboard showing migration activity
- Health response showed `hyperdrive_host: "11f7f957eaae03a9fe9365c78e6eb4ed.hyperdrive.local"` — which is the correct Hyperdrive local proxy address (not a bug)

### Diagnosis Steps Taken

```bash
# Step 1: Inspect the full health response
curl -s https://bloqr-frontend.jk-com.workers.dev/api/health | jq .services.database
# Result:
# {
#   "status": "down",
#   "latency_ms": 0,
#   "hyperdrive_host": "11f7f957eaae03a9fe9365c78e6eb4ed.hyperdrive.local"
# }

# Step 2: Check the Hyperdrive binding configuration
wrangler hyperdrive get 800f7e2edc86488ab24e8621982e9ad7
# Result showed "scheme": "postgres" — Hyperdrive uses postgres://, not postgresql://

# Step 3: Check deployed version
curl -s https://bloqr-frontend.jk-com.workers.dev/api/health | jq .version
# "0.76.0" — schema fix was deployed

# Step 4: Tail live worker logs
wrangler tail --format=pretty
# Revealed: ZodError thrown before any network call when parsing connectionString
```

### Key Diagnostic Insight: `.hyperdrive.local` Is Correct

The `hyperdrive_host: "11f7f957eaae03a9fe9365c78e6eb4ed.hyperdrive.local"` host is the **Cloudflare-managed local proxy address** inside a deployed Worker. This is expected and correct — it means the `HYPERDRIVE` binding is wired up properly. The failure was happening _before_ any query reached this proxy.

### Root Cause Found

`PrismaClientConfigSchema` in `worker/lib/prisma-config.ts` was only accepting `postgresql://` as a valid scheme. Cloudflare Hyperdrive returns `postgres://` from `env.HYPERDRIVE.connectionString`. This caused a `ZodError` to be thrown synchronously before any TCP connection was attempted — hence `latency_ms: 0`.

The fix (accepting both schemes via `.regex(/^postgre(?:s|sql):\/\//)`) was already applied in the first PR.

### Remaining Issue at v0.76.0

Even after the schema fix was deployed at v0.76.0, the database was still `down`. The `latency_ms: 0` pattern continued, meaning the error was still at instantiation time, not at query time. At this point there were two hypotheses:

1. **The schema fix wasn't actually deployed** — `wrangler deployments list` should confirm the version
2. **Query-level failure** — the `PrismaClient` was being created but the query itself was failing silently (catch block swallowed the error)

The original `databaseProbe` catch block did not capture `error_code` or `error_message`, making it impossible to distinguish these cases from the health response alone.

### Resolution Path

The hardening work in this PR added:

1. **`error_code` and `error_message`** in the `databaseProbe` catch block — redacted of any connection string fragments
2. **5-second timeout** via `Promise.race` — a hung Hyperdrive connection no longer blocks the health response indefinitely
3. **`$disconnect()` in a `finally` block** — prevents connection pool leaks after each probe
4. **New `GET /api/health/db-smoke` endpoint** — runs `current_database()`, `pg_version`, `now()`, and `table_count` as a richer smoke test. This is the canonical way to verify DB connectivity after every production deploy.

### Using the New Smoke Test Endpoint

After deploying, run:

```bash
curl -s https://bloqr-frontend.jk-com.workers.dev/api/health/db-smoke | jq .
```

Expected healthy output:

```json
{
  "ok": true,
  "db_name": "bloqr-backend",
  "pg_version": "PostgreSQL 16.x ...",
  "server_time": "2026-03-25T21:59:15.917Z",
  "table_count": 17,
  "latency_ms": 42,
  "hyperdrive_host": "ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech"
}
```

If it returns `ok: false`, the `error` field will now contain a redacted error message that pinpoints the failure layer.

---

## Symptom

The live site at `https://bloqr-frontend.jk-com.workers.dev/` displays two error banners:

- **"Degraded performance — v0.75.0"**
- **"Data may be stale"**

Hitting the health endpoint returns:

```json
{
  "status": "down",
  "version": "0.75.0",
  "timestamp": "2026-03-25T21:59:15.917Z",
  "services": {
    "gateway":  { "status": "healthy" },
    "database": { "status": "down", "latency_ms": 0 },
    "compiler": { "status": "healthy" },
    "auth":     { "status": "healthy", "provider": "better-auth" },
    "cache":    { "status": "healthy", "latency_ms": 132 }
  }
}
```

**Key tell:** `latency_ms: 0` on the `database` service.
A real network failure or timeout always returns a non-zero latency. An instant `0 ms` failure means the probe threw *before* any connection attempt — i.e., at the validation layer.

The Cloudflare Hyperdrive dashboard shows **zero queries/connections** despite the Neon dashboard showing migration activity.

---

## Diagnostic Commands

```bash
# 1. Inspect the full health response
curl -s https://<your-worker>.workers.dev/api/health | jq .

# 2. Check the Hyperdrive binding configuration
npx wrangler hyperdrive get <hyperdrive-id>

# 3. Tail the live worker log to catch Zod validation errors
wrangler tail
```

Look for lines like `ZodError: Invalid url` or `Expected string, received undefined` in the tail output. A `ZodError` thrown during `PrismaClientConfigSchema.parse()` is definitive proof that the failure is at the config-validation layer, not the network.

---

## Root Cause Decision Tree

### ❶ Is `latency_ms` exactly `0`?

**If YES** — the database probe threw *before* opening any connection. This points to a config-validation failure, not a network failure. Proceed to ❷.

**If NO** (latency is non-zero) — the connection was attempted but timed out or was refused. Check Neon project status, Hyperdrive binding ID, and network egress. This article does not cover that case.

---

### ❷ What scheme does the Hyperdrive connection string use?

```bash
npx wrangler hyperdrive get <hyperdrive-id>
```

The output will show a `"scheme"` field. Cloudflare Hyperdrive **always** returns `postgres://` (not `postgresql://`) from the `env.HYPERDRIVE.connectionString` binding property.

```json
{
  "id": "...",
  "name": "adblock-hyperdrive",
  "origin": {
    "scheme": "postgres",
    "host": "...",
    "port": 5432,
    "database": "neondb"
  }
}
```

**If the scheme is `postgres`** — and `PrismaClientConfigSchema` only accepts `postgresql://`, the schema parse throws a `ZodError` instantly. This is the root cause. Proceed to Resolution.

---

### ❸ Does `PrismaClientConfigSchema` accept `postgres://`?

Open `worker/lib/prisma-config.ts` and check the `connectionString` validator:

```typescript
// Before the fix — rejects Hyperdrive's actual scheme
connectionString: z.string().url().startsWith('postgresql://'),

// After the fix — accepts both schemes
connectionString: z.string().url().regex(/^postgre(?:s|sql):\/\//),
```

If the schema only allows `postgresql://`, every request that tries to build a `PrismaClient` from the Hyperdrive binding will fail at parse time with zero network activity.

---

## Resolution

### Step 1 — Update `PrismaClientConfigSchema` to accept both URL schemes

In `worker/lib/prisma-config.ts`, change the `connectionString` validation to accept both `postgres://` and `postgresql://`:

```typescript
// worker/lib/prisma-config.ts

// Before
connectionString: z.string().url().startsWith('postgresql://'),

// After
connectionString: z.string().url().regex(/^postgre(?:s|sql):\/\//),
```

This accepts `postgres://...` (Hyperdrive short alias) and `postgresql://...` (standard long form) while rejecting anything else.

### Step 2 — Deploy

```bash
wrangler deploy
```

After deploying, hit the health endpoint again:

```bash
curl -s https://<your-worker>.workers.dev/api/health | jq .
```

You should see `database.status: "healthy"` with a non-zero `latency_ms`.

### Step 3 — Verify with the enhanced health probe

The fix also introduced an enhanced health check in `worker/handlers/health.ts` that runs `SELECT current_database()` instead of `SELECT 1`. This surfaces `db_name` and `hyperdrive_host` in the health response:

```json
{
  "services": {
    "database": {
      "status": "healthy",
      "latency_ms": 42,
      "db_name": "neondb",
      "hyperdrive_host": "...-pooler.us-east-2.aws.neon.tech"
    }
  }
}
```

Confirm that `db_name` matches the expected Neon database name. If it returns a different database name, the Hyperdrive binding is pointed at the wrong Neon project or branch.

---

## Prevention

- The new `db_name` field in the health response acts as a continuous assertion that the correct database is connected. Monitor this value in your observability dashboards.
- When configuring a new Hyperdrive binding, always run `wrangler hyperdrive get <id>` to confirm the `scheme` field. If it is `"postgres"`, ensure all Zod schemas that validate the connection string accept `postgres://`.
- Add an integration test that builds `PrismaClientConfigSchema.parse()` with a `postgres://` URL to catch future regressions.

---

## Worker Code Reference

| File | Relevance |
|---|---|
| `worker/lib/prisma-config.ts` | `PrismaClientConfigSchema` — validates the Hyperdrive connection string before `PrismaClient` is created |
| `worker/handlers/health.ts` | `handleHealth` — runs the database probe; surface `db_name` and `hyperdrive_host` from the enhanced `SELECT current_database()` query |

---

## ZTA Security Note

`env.HYPERDRIVE.connectionString` is a runtime binding secret — it is never logged, committed, or exposed in the health response. Only the host portion (`hyperdrive_host`) is surfaced for diagnostic purposes. The `db_name` field is also safe to expose: it is a non-secret label, not a credential.

---

## Resolution Summary

| Symptom | Root Cause | Fix |
|---|---|---|
| `database: down`, `latency_ms: 0` | `PrismaClientConfigSchema` rejected `postgres://` | Accept both `postgres://` and `postgresql://` in the regex |
| Hyperdrive dashboard shows zero activity | `PrismaClient` never created — Zod threw before any network call | Same fix as above |
| Health shows wrong `db_name` | Hyperdrive binding points to wrong Neon project/branch | Update Hyperdrive binding origin in Cloudflare dashboard |

---

## Related KB Articles

- [KB-001](./KB-001-api-not-available.md) — "Getting API is not available" on the main page
- [KB-003](./KB-003-neon-hyperdrive-live-session-2026-03-25.md) — Database Down After Deploy — Live Debugging Session (2026-03-25)
- [KB-004](./KB-004-prisma-wasm-cloudflare.md) — `WebAssembly.Module(): Wasm code generation disallowed by embedder` — Prisma `runtime = "deno"` generates code blocked by Cloudflare Workers; fix is `runtime = "cloudflare"` + regenerate
- [KB-005](./KB-005-better-auth-cloudflare-ip-timeout.md) — Better Auth Cloudflare integration issues: Worker CPU timeout on session endpoints and silent rate limiting bypass
- *(planned)* KB-006 — Cloudflare Queue consumer not processing messages
- *(planned)* KB-007 — Angular SPA serves stale build after worker deploy

---

## Feedback & Contribution

If you discovered a new failure mode while using this article, please open an issue tagged `troubleshooting` and `documentation` in `jaypatrick/bloqr-backend` with the details so it can be captured in a follow-up KB entry.

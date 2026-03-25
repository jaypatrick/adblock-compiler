# KB-002: Hyperdrive Binding Connected but `database` Service Reports `down`

> **Status:** ✅ Active
> **Affected version:** v0.75.0
> **Resolved in:** PR fixing `PrismaClientConfigSchema` to accept `postgres://` + enhanced `/api/health` probe
> **Date:** 2026-03-25

---

## Symptom

The live site at `https://adblock-frontend.jayson-knight.workers.dev/` displays two error banners:

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
- *(planned)* KB-003 — Cloudflare Queue consumer not processing messages
- *(planned)* KB-004 — Angular SPA serves stale build after worker deploy

---

## Feedback & Contribution

If you discovered a new failure mode while using this article, please open an issue tagged `troubleshooting` and `documentation` in `jaypatrick/adblock-compiler` with the details so it can be captured in a follow-up KB entry.

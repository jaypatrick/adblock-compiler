# Neon PostgreSQL Troubleshooting

> **Quick Reference** — Diagnosis and resolution for common Neon PostgreSQL,
> Hyperdrive, Prisma, and Better Auth issues in the adblock-compiler stack.

---

## Table of Contents

- [Connection Architecture & Failure Points](#connection-architecture--failure-points)
- [Connection Pool Exhaustion (Hyperdrive)](#connection-pool-exhaustion-hyperdrive)
- [Prisma Migration Errors](#prisma-migration-errors)
- [Hyperdrive Timeout Handling](#hyperdrive-timeout-handling)
- [Local Development Issues](#local-development-issues)
- [Neon Branching Issues](#neon-branching-issues)
- [Better Auth + Neon Issues](#better-auth--neon-issues)
- [Diagnostic Commands](#diagnostic-commands)

---

## Connection Architecture & Failure Points

Every database request passes through multiple layers, each with its own failure
modes. The diagram below highlights where things typically go wrong:

```mermaid
flowchart LR
    A["Client Request"] --> B["Cloudflare Worker<br/>(Hono)"]
    B --> C["createPrismaClient()"]
    C --> D["@prisma/adapter-pg<br/>(PrismaPg)"]
    D --> E["Cloudflare Hyperdrive<br/>(Connection Pool)"]
    E --> F["Neon PostgreSQL<br/>(Azure East US 2)"]

    B -.-x|"❶ HYPERDRIVE undefined"| C
    C -.-x|"❷ Zod validation fail"| D
    D -.-x|"❸ Pool exhausted"| E
    E -.-x|"❹ Timeout / TLS error"| F
    F -.-x|"❺ Migration lock / schema drift"| F

    style A fill:#e8f4f8,stroke:#2196F3
    style B fill:#fff3e0,stroke:#FF9800
    style C fill:#f3e5f5,stroke:#9C27B0
    style D fill:#f3e5f5,stroke:#9C27B0
    style E fill:#e8f5e9,stroke:#4CAF50
    style F fill:#e3f2fd,stroke:#1565C0
```

| Failure Point | Layer | Typical Symptom |
|---|---|---|
| ❶ Binding missing | Worker → Prisma | `TypeError: Cannot read properties of undefined (reading 'connectionString')` |
| ❷ Bad connection string | Prisma factory | `ZodError: String must be a valid URL` |
| ❸ Pool exhausted | Hyperdrive | `Error: too many connections` or request hangs |
| ❹ Timeout / TLS | Hyperdrive → Neon | `Error: connect ETIMEDOUT` or SSL handshake failures |
| ❺ Schema drift | Neon database | `Error: column "X" does not exist` or migration lock errors |

---

## Connection Pool Exhaustion (Hyperdrive)

### Symptoms

- Requests hang for 10–30 seconds then fail
- `Error: too many connections for role "..."` in Worker logs
- Intermittent 500 errors under moderate load
- Neon dashboard shows connection count at or near limit

### Root Causes

1. **PrismaClient not disconnected** — forgetting `await prisma.$disconnect()` keeps the
   Hyperdrive proxy socket open
2. **Multiple PrismaClient instances per request** — creating separate clients for auth
   and route handlers without sharing via middleware
3. **Long-running transactions** — holding connections during slow operations

### Resolution

**Always disconnect in a `finally` block:**

```typescript
const prisma = createPrismaClient(c.env.HYPERDRIVE!.connectionString);
try {
    const user = await prisma.user.findUnique({ where: { id } });
    return c.json({ user });
} finally {
    await prisma.$disconnect();
}
```

**Use the Prisma middleware for request-scoped sharing:**

```typescript
// worker/middleware/prisma-middleware.ts handles this automatically
app.use('/api/*', prismaMiddleware());

// Both Better Auth and route handlers share the same PrismaClient
app.get('/api/users', async (c) => {
    const prisma = c.get('prisma'); // shared instance
    // ...
});
```

**Check connection count in Neon:**

```sql
-- Run via Neon SQL Editor or psql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'neondb';

-- See who's holding connections
SELECT pid, usename, application_name, state, query_start
FROM pg_stat_activity
WHERE datname = 'neondb'
ORDER BY query_start DESC;
```

---

## Prisma Migration Errors

### "prepared statement already exists"

**Symptom:** `prisma migrate dev` or `prisma migrate deploy` fails with pooling errors.

**Cause:** Migration commands use interactive transactions that conflict with connection
pooling (PgBouncer in Neon's pooler endpoint).

**Fix:** Always use `DIRECT_DATABASE_URL` (the non-pooled endpoint) for migrations:

```bash
# .env.local — note: NO "-pooler" in the hostname
DIRECT_DATABASE_URL=postgresql://<user>:<password>@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/neondb?sslmode=require
```

The `prisma.config.ts` automatically prefers `DIRECT_DATABASE_URL` over `DATABASE_URL`.

### "migration failed — column already exists"

**Symptom:** A migration tries to add a column that already exists in the database.

**Cause:** Schema was pushed with `db push` (which doesn't create migration files), then
a migration was created that duplicates the change.

**Fix:**

```bash
# Mark the problematic migration as already applied
deno run -A npm:prisma migrate resolve --applied <migration_name>

# Or reset the migration history (local dev only!)
deno task db:local:reset
```

### "P3009: migrate found failed migrations"

**Symptom:** A previous migration failed partway, leaving the database in a dirty state.

**Fix:**

```bash
# 1. Check which migration failed
deno run -A npm:prisma migrate status

# 2. Fix the underlying issue, then mark it resolved
deno run -A npm:prisma migrate resolve --rolled-back <migration_name>

# 3. Re-run migrations
deno task db:migrate
```

### "Cannot find module 'prisma/generated/client.ts'"

**Symptom:** Import error after schema changes or fresh clone.

**Fix:** Always use the Deno task (not raw `npx prisma generate`):

```bash
deno task db:generate
```

This runs `prisma generate` followed by `scripts/prisma-fix-imports.ts`, which rewrites
import paths for Deno compatibility.

---

## Hyperdrive Timeout Handling

### Request Timeout (Worker-Side)

**Symptom:** Routes that involve database queries return 524 (timeout) after ~30 seconds.

**Cause:** Neon's serverless compute may need a cold start (~1–5 seconds), and if the
Worker is placed far from Neon, round-trip latency adds up.

**Fix:**

1. **Verify Smart Placement is enabled** in `wrangler.toml`:
   ```toml
   [placement]
   mode = "smart"
   ```

2. **Add query timeouts** to prevent unbounded database calls:
   ```typescript
   // Use Prisma's built-in timeout (in milliseconds)
   const user = await prisma.user.findUnique({
       where: { id },
   });
   // Note: Prisma driver adapter doesn't support statement_timeout natively;
   // set it at the PostgreSQL level if needed:
   // ALTER ROLE your_user SET statement_timeout = '10s';
   ```

3. **Monitor Neon cold starts** in the Neon dashboard → Monitoring → Compute activity

### Stale Connections

**Symptom:** Queries intermittently fail with `Error: Connection terminated unexpectedly`
or `Error: This socket has been ended by the other party`.

**Cause:** Neon scales compute to zero after 5 minutes of inactivity. If Hyperdrive holds
a connection that Neon closed, the next query on that socket fails.

**Fix:** Hyperdrive handles reconnection automatically. If you see persistent issues:

```bash
# Verify Hyperdrive config
npx wrangler hyperdrive get 800f7e2edc86488ab24e8621982e9ad7

# Recreate the Hyperdrive config if needed
npx wrangler hyperdrive update 800f7e2edc86488ab24e8621982e9ad7 \
    --origin-host=ep-winter-term-a8rxh2a9-pooler.eastus2.azure.neon.tech \
    --origin-port=5432 \
    --database=neondb \
    --origin-user=<user> \
    --origin-password=<password>
```

### SSL / Channel Binding Errors

**Symptom:** `Error: channel binding is required but server did not offer it`

**Fix:** Add `channel_binding=require` to the connection string (Neon's pooler
requires it in some configurations):

```
postgresql://user:pass@...-pooler.eastus2.azure.neon.tech/db?sslmode=require&channel_binding=require
```

---

## Local Development Issues

### "HYPERDRIVE is undefined" in Local Dev

**Symptom:** `TypeError: Cannot read properties of undefined (reading 'connectionString')`

**Cause:** `.dev.vars` is missing or has an empty Hyperdrive local override.

**Fix:**

```bash
# .dev.vars (gitignored) — point at your personal Neon dev branch
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://<user>:<password>@<branch-host>.neon.tech/<dbname>?sslmode=require
```

Create a personal dev branch at [console.neon.tech](https://console.neon.tech) → your project → Branches → New Branch.
Use the **Direct connection** string (not pooled). See [Local Dev Setup](../database-setup/local-dev.md).

> ⚠️ Restart `wrangler dev` after changing `.dev.vars` — it only reads the file at startup.

### "SSL required" / `sslmode` errors

**Symptom:** `Error: SSL required` or `Error: PGGSSENCMODE` / TLS handshake failure.

**Cause:** The connection string is missing `?sslmode=require` (required by Neon).

**Fix:** Append `?sslmode=require` to every Neon connection string in `.dev.vars` and `.env.local`:

```ini
# Replace <user>, <password>, <branch-host>, and <dbname> with your Neon branch values
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://<user>:<password>@<branch-host>.neon.tech/<dbname>?sslmode=require
DATABASE_URL="postgresql://<user>:<password>@<branch-host>.neon.tech/<dbname>?sslmode=require"
DIRECT_DATABASE_URL="postgresql://<user>:<password>@<branch-host>.neon.tech/<dbname>?sslmode=require"
```

### "Cannot connect to server" / ETIMEDOUT

**Symptom:** Connections time out during `wrangler dev` or `prisma migrate`.

**Cause:** The Neon branch may be suspended or the connection string is incorrect.

**Fix:**

```bash
# 1. Verify your Neon branch is active
#    https://console.neon.tech → your project → Branches → check branch status

# 2. Test the connection directly
#    Replace <user>, <password>, <branch-host>, and <dbname> with your Neon branch values
psql "postgresql://<user>:<password>@<branch-host>.neon.tech/<dbname>?sslmode=require" -c "SELECT 1 AS ok;"

# 3. Ensure your connection string uses the direct (non-pooler) hostname
#    ✅ ep-<name>.<region>.neon.tech          (direct — use for local dev)
#    ❌ ep-<name>-pooler.<region>.neon.tech   (pooler — only for production Hyperdrive)
```

---

## Neon Branching Issues

### Branch Creation Fails

**Symptom:** `NeonApiService.createBranch()` returns a 400 or 422 error.

**Common causes:**

| Error | Cause | Fix |
|---|---|---|
| `branches_limit_exceeded` | Free plan allows max 10 branches | Delete unused branches |
| `parent branch not found` | Invalid parent branch ID | Use `listBranches()` to find correct ID |
| `project not found` | Wrong project ID or API key scope | Verify `NEON_PROJECT_ID` |

**Cleanup stale branches:**

```typescript
// Using the NeonApiService
const neon = createNeonApiService({ apiKey: env.NEON_API_KEY });
const branches = await neon.listBranches('twilight-river-73901472');

// Find branches older than 7 days (excluding main)
const stale = branches.filter(b =>
    b.name !== 'main' &&
    new Date(b.created_at) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
);

for (const branch of stale) {
    await neon.deleteBranch('twilight-river-73901472', branch.id);
}
```

### Branch Endpoint Not Ready

**Symptom:** Branch was created but connection fails with timeout.

**Cause:** Neon endpoints take a few seconds to become `active` after branch creation.

**Fix:** Poll the endpoint status before connecting:

```typescript
const { branch } = await neon.createBranch(projectId, { name: 'preview/pr-42' });
const endpoints = await neon.listEndpoints(projectId);
const ep = endpoints.find(e => e.branch_id === branch.id);
// Wait for endpoint to become active (Neon Operations API handles this)
```

---

## Better Auth + Neon Issues

### Session Creation Fails (500 on `/api/auth/sign-in`)

**Symptom:** Login returns 500, Worker logs show a database error.

**Diagnosis checklist:**

1. **Is HYPERDRIVE configured?**
   ```bash
   # Check wrangler.toml has [[hyperdrive]] section
   grep -A2 'hyperdrive' wrangler.toml
   ```

2. **Is BETTER_AUTH_SECRET set?**
   ```bash
   # Local dev: check .dev.vars
   grep 'BETTER_AUTH_SECRET' .dev.vars
   ```

3. **Do the auth tables exist?**
   ```sql
   -- Check via Neon SQL Editor
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN ('users', 'sessions', 'account', 'verification');
   ```

4. **Run migrations if tables are missing:**
   ```bash
   deno task db:migrate
   ```

### Adapter Errors ("Cannot read property of undefined")

**Symptom:** `prismaAdapter` throws during Better Auth initialization.

**Cause:** The PrismaClient was created with an invalid connection string, or the
Prisma schema doesn't match the database.

**Fix:**

```bash
# 1. Regenerate the Prisma client
deno task db:generate

# 2. Verify schema matches the database
deno run -A npm:prisma db pull   # introspect live DB
deno run -A npm:prisma migrate status  # check drift
```

### Token Validation Fails After Session Creation

**Symptom:** Sign-in succeeds but subsequent API calls return 401.

**Cause:** The `session` table's `token` column may not be indexed, or the session
was created but the `expiresAt` is in the past.

**Debug:**

```sql
-- Check session exists and is not expired
SELECT id, token, expires_at, created_at
FROM sessions
WHERE user_id = '<user-id>'
ORDER BY created_at DESC
LIMIT 5;
```

### Better Auth + Clerk Fallback Conflict

**Symptom:** Authenticated requests intermittently fail when both providers are active.

**Cause:** A client sends a Clerk JWT, Better Auth rejects it (not its format), and the
Clerk fallback path is disabled.

**Fix:** Either:
- Enable the fallback: ensure `DISABLE_CLERK_FALLBACK` is **not** set to `true`
- Or migrate the client to use Better Auth credentials

See [Auth Chain Reference](../auth/auth-chain-reference.md) for the full authentication flow.

---

## Diagnostic Commands

### Quick Health Check

```bash
# Worker dev server running?
curl -s http://localhost:8787/health | jq .

# Database reachable? (via Prisma)
deno task db:studio  # opens GUI at http://localhost:5555

# Neon API reachable?
curl -s -H "Authorization: Bearer $NEON_API_KEY" \
    "https://console.neon.tech/api/v2/projects/twilight-river-73901472" | jq .name
```

### Database Connectivity

```bash
# Test direct PostgreSQL connection to your Neon dev branch (requires psql)
psql "$DIRECT_DATABASE_URL" -c "SELECT 1 AS ok;"

# Check Prisma migration status against your Neon dev branch
deno run -A npm:prisma migrate status
```

### Wrangler / Hyperdrive

```bash
# Verify Hyperdrive binding
npx wrangler hyperdrive get 800f7e2edc86488ab24e8621982e9ad7

# Check Worker environment
npx wrangler dev --log-level=debug
```

---

## Further Reading

- [Neon Setup](../database-setup/neon-setup.md) — Production Neon configuration
- [Local Dev Guide](../database-setup/local-dev.md) — Neon branching setup for local development
- [Auth Chain Reference](../auth/auth-chain-reference.md) — Authentication flow details
- [Better Auth + Prisma](../auth/better-auth-prisma.md) — Prisma adapter configuration
- [Neon Documentation](https://neon.tech/docs) — Official Neon docs
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/) — Hyperdrive troubleshooting

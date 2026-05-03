# KB-004: `WebAssembly.Module(): Wasm code generation disallowed by embedder`

> **Status:** ✅ Resolved
> **Affected versions:** v0.75.0–v0.76.x (any build generated with `runtime = "deno"`)
> **Resolved in:** PR changing `prisma/schema.prisma` `runtime` to `"cloudflare"` + client regeneration
> **Date:** 2026-03-26

---

## Symptom

The `/api/health` endpoint returns `database.status: "down"` with a `CompileError`:

```json
{
  "status": "down",
  "services": {
    "database": {
      "status": "down",
      "latency_ms": 0,
      "hyperdrive_host": "bf3d96a03bcd4b96a83645fdd07c5a0d.hyperdrive.local",
      "error_code": "CompileError",
      "error_message": "WebAssembly.Module(): Wasm code generation disallowed by embedder"
    }
  }
}
```

The `/api/health/db-smoke` endpoint returns:

```json
{
  "ok": false,
  "error": "WebAssembly.Module(): Wasm code generation disallowed by embedder",
  "hyperdrive_host": "bf3d96a03bcd4b96a83645fdd07c5a0d.hyperdrive.local"
}
```

**Key tells:**
- `latency_ms: 0` — the error occurs before any network call
- The error message contains "WebAssembly.Module()" — this is a Cloudflare Workers runtime restriction, not a Neon/Hyperdrive issue
- `hyperdrive_host` is present and correct — the Hyperdrive binding itself is fine

---

## Root Cause

`prisma/schema.prisma` had `runtime = "deno"` in the generator block. Prisma 7's `prisma-client` generator with `runtime = "deno"` emits a Prisma client that calls `new WebAssembly.Module()` at runtime to load its Rust-based query compiler:

```typescript
// Generated code with runtime = "deno" (BROKEN on Cloudflare Workers)
async function decodeBase64AsWasm(wasmBase64: string): Promise<WebAssembly.Module> {
  const { Buffer } = await import('node:buffer')
  const wasmArray = Buffer.from(wasmBase64, 'base64')
  return new WebAssembly.Module(wasmArray)  // ← CRASHES: blocked by Cloudflare
}

config.compilerWasm = {
  getQueryCompilerWasmModule: async () => {
    const { wasm } = await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs")
    return await decodeBase64AsWasm(wasm)  // ← This is what throws the CompileError
  },
}
```

Cloudflare Workers **explicitly disallow runtime `WebAssembly.Module()` instantiation** for security reasons. Only WASM compiled at bundle time (via Wrangler's `?module` static import syntax) is permitted.

The correct runtime for Cloudflare Workers is `"cloudflare"`, which generates:

```typescript
// Generated code with runtime = "cloudflare" (CORRECT for Cloudflare Workers)
config.compilerWasm = {
  getQueryCompilerWasmModule: async () => {
    const { default: module } = await import("./query_compiler_fast_bg.wasm?module")
    return module  // ← Static import processed by Wrangler at bundle time ✅
  },
}
```

The `?module` suffix is Wrangler's static WASM import syntax — Wrangler processes this at bundle time and converts it to a proper Cloudflare Workers WASM module binding, which bypasses the runtime restriction entirely.

---

## Why This Matters

Prisma 7 introduced a new Rust-based **Query Compiler** that runs inside a WebAssembly module. This is architecturally different from Prisma 5's binary query engine. The QC executes SQL generation logic in WASM rather than in a native binary.

Cloudflare Workers support WASM, but only when the WASM module is bundled statically at deploy time — not compiled dynamically at runtime. The `runtime = "deno"` output loads WASM from a base64-encoded string and calls `new WebAssembly.Module()`, which is the dynamic path. The `runtime = "cloudflare"` output uses `?module` imports that Wrangler handles at bundle time, which is the static path.

---

## Diagnosis Steps

### Step 1 — Confirm the WASM error

```bash
curl -s https://bloqr-frontend.jk-com.workers.dev/api/health/db-smoke | jq .
```

If you see `"error": "WebAssembly.Module(): Wasm code generation disallowed by embedder"`, this KB applies.

### Step 2 — Check the current Prisma schema runtime

```bash
grep -n "runtime" prisma/schema.prisma
```

If it shows `runtime = "deno"`, that is the root cause.

### Step 3 — Inspect the generated client

```bash
grep -n "decodeBase64AsWasm\|new WebAssembly.Module" prisma/generated/internal/class.ts
```

If these strings are present, the generated client uses runtime WASM instantiation and will fail on Cloudflare Workers.

---

## Resolution

### Step 1 — Change the generator runtime in `prisma/schema.prisma`

```diff
 generator client {
   provider = "prisma-client"
   output   = "./generated"
-  runtime = "deno"
-  // Use edge-compatible runtime for Cloudflare Workers
-  // For local dev with Deno, set runtime = "deno"
+  runtime  = "cloudflare"
+  // "cloudflare" runtime uses @prisma/adapter-pg code path — no runtime WASM.
+  // This is required for Cloudflare Workers which block WebAssembly.Module()
+  // instantiation at runtime. The deno runtime would generate WASM-dependent
+  // code that Cloudflare rejects.
+  // See: https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare
 }
```

### Step 2 — Regenerate the Prisma client

```bash
deno task db:generate
```

This runs `prisma generate` and the post-generation import fixer. The regenerated `prisma/generated/` directory will no longer contain the `decodeBase64AsWasm` function or any `new WebAssembly.Module()` calls.

### Step 3 — Verify the generated output

```bash
grep "decodeBase64AsWasm\|new WebAssembly.Module" prisma/generated/internal/class.ts
```

Should return no matches. The `compilerWasm` block in the new generated code will use `?module` imports instead:

```typescript
config.compilerWasm = {
  getQueryCompilerWasmModule: async () => {
    const { default: module } = await import("./query_compiler_fast_bg.wasm?module")
    return module
  },
}
```

### Step 4 — Commit, push, and deploy

```bash
git add prisma/schema.prisma prisma/generated/
git commit -m "fix: change Prisma generator runtime from deno to cloudflare (resolves WASM error)"
git push
wrangler deploy
```

### Step 5 — Verify the fix

```bash
# Full health check
curl -s https://bloqr-frontend.jk-com.workers.dev/api/health | jq .services.database

# Smoke test
curl -s https://bloqr-frontend.jk-com.workers.dev/api/health/db-smoke | jq .
```

Expected healthy responses:

```json
{
  "status": "healthy",
  "latency_ms": 42,
  "db_name": "bloqr-backend",
  "hyperdrive_host": "bf3d96a03bcd4b96a83645fdd07c5a0d.hyperdrive.local"
}
```

```json
{
  "ok": true,
  "db_name": "bloqr-backend",
  "pg_version": "PostgreSQL 16.x ...",
  "server_time": "2026-03-26T...",
  "table_count": 17,
  "latency_ms": 42
}
```

---

## Prevention

- **Always use `runtime = "cloudflare"` for Cloudflare Workers deployments.** The `deno` runtime is only appropriate when the Prisma client is consumed directly by Deno CLI tooling (migrations, seeding), not by the deployed Worker.
- **Never commit generated Prisma files regenerated with `runtime = "deno"` for a Workers deployment.** The CI pipeline should validate that the runtime setting matches the deployment target.
- **After any change to `prisma/schema.prisma`, run `deno task db:generate` and commit the result.** The generated client in `prisma/generated/` is part of the production artifact and must reflect the current schema and runtime settings.
- **The `@prisma/adapter-pg` code path in `worker/lib/prisma.ts` remains correct.** It explicitly passes `new PrismaPg({ connectionString })` as the adapter, which directs Prisma to use the driver adapter (Hyperdrive → Neon TCP) rather than an embedded query engine. This is the right architecture regardless of which `runtime` is configured.

---

## Why Not Downgrade Prisma?

Prisma 5 used a native binary query engine with driver adapters, which avoided the WASM issue entirely. However:

1. Downgrading introduces technical debt and locks the project to an end-of-life version.
2. Prisma 7 with `runtime = "cloudflare"` is the officially documented and supported solution.
3. The `?module` WASM import path in `runtime = "cloudflare"` is explicitly designed for Cloudflare Workers and fully supported by Wrangler's bundler.

See:
- [Prisma GitHub issue #28657](https://github.com/prisma/prisma/issues/28657)
- [Prisma docs: Deploy to Cloudflare Workers](https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare)
- [Prisma docs: Cloudflare Workers guide](https://www.prisma.io/docs/guides/deployment/cloudflare-workers)

---

## Worker Code Reference

| File | Relevance |
|---|---|
| `prisma/schema.prisma` | Generator block — `runtime` field controls WASM vs static import path |
| `prisma/generated/internal/class.ts` | Generated client internals — `compilerWasm.getQueryCompilerWasmModule` shows which path is used |
| `worker/lib/prisma.ts` | `createPrismaClient` — uses `PrismaPg` adapter; no change needed |
| `worker/lib/prisma-config.ts` | `PrismaClientConfigSchema` — validates Hyperdrive connection string; no change needed |

---

## Related KB Articles

- [KB-002](./KB-002-hyperdrive-database-down.md) — Hyperdrive binding connected but `database` service reports `down` (covers the `postgres://` vs `postgresql://` ZodError that was the first layer of this outage)
- [KB-003](./KB-003-neon-hyperdrive-live-session-2026-03-25.md) — Live debugging session 2026-03-25 (full context of the 3-day investigation)
- [KB-005](./KB-005-better-auth-cloudflare-ip-timeout.md) — Better Auth Cloudflare integration issues: Worker CPU timeout and silent rate limiting bypass

---

## Timeline

| Date | Event |
|---|---|
| 2026-03-23 | Migration from PlanetScale to Neon DB; site begins showing `database: down` |
| 2026-03-25 | KB-002 fix applied (`postgres://` schema acceptance) — partially resolves `latency_ms: 0` |
| 2026-03-25 | `/api/health/db-smoke` endpoint added to surface detailed error messages |
| 2026-03-26 | Real root cause identified: `runtime = "deno"` generates `new WebAssembly.Module()` call blocked by Cloudflare |
| 2026-03-26 | One-line fix: `runtime = "cloudflare"` + `prisma generate` → site healthy |

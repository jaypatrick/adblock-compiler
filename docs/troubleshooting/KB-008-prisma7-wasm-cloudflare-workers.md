# KB-008 — Prisma 7 + Cloudflare Workers: `WebAssembly.Module()` Disallowed by Embedder

**Status:** Resolved  
**Severity:** Critical (site down / database unreachable)  
**Affected versions:** Prisma 7.x with `runtime = "deno"` deployed to Cloudflare Workers  
**Date first observed:** 2026-03-25  
**Date resolved:** 2026-03-26  
**Related PRs:** #1410 (smoke endpoint), #1411 (prisma runtime fix)

---

## Summary

After migrating to Neon PostgreSQL + Cloudflare Hyperdrive, the worker failed every database call with:

```
WebAssembly.Module(): Wasm code generation disallowed by embedder
```

The root cause was a single line in `prisma/schema.prisma`:

```prisma
// Before (broken on Cloudflare Workers)
runtime = "deno"

// After (correct)
runtime = "cloudflare"
```

---

## Symptoms

- `/api/health` returns `database.status: "down"` with `latency_ms: 0`
- `/api/health/db-smoke` returns `{"ok":false,"error":"WebAssembly.Module(): Wasm code generation disallowed by embedder"}`
- Frontend shows **"Degraded performance"** banner
- All database operations fail immediately (no latency = failure before any network call)
- Hyperdrive dashboard shows **zero queries** despite the Neon dashboard showing the database is healthy
- The error appears in `wrangler tail` logs as a `CompileError`

---

## Root Cause

### Background: How Prisma 7 generates its client

Prisma 7 introduced a new `prisma-client` generator (replacing the old `prisma-client-js`) with an explicit `runtime` field. The `runtime` field controls **which variant of the Prisma runtime is embedded in the generated client**.

| `runtime` value | Generated import path | Behaviour |
|---|---|---|
| `"deno"` | `@prisma/client/runtime/client` | Calls `WebAssembly.Module()` **dynamically at request time** — Cloudflare blocks this |
| `"nodejs"` | `@prisma/client/runtime/client` | Same — not appropriate for edge environments |
| `"cloudflare"` | `@prisma/client/runtime/wasm-compiler-edge` | WASM is resolved **statically at bundle time** by wrangler/esbuild — Cloudflare allows this |

### Why Cloudflare blocks dynamic WASM

Cloudflare Workers enforces a strict **Content Security Policy** on the JavaScript isolate: `WebAssembly.Module()` cannot be called at request time. This is a deliberate security sandbox restriction.

Prisma's internal query compiler (part of `@prisma/prisma-schema-wasm`) **is implemented in WebAssembly**. When the `"deno"` or `"nodejs"` runtime is used, this WASM module is loaded dynamically when the first query runs — which is exactly what Cloudflare blocks.

### Why `"cloudflare"` works

The `"cloudflare"` runtime generates a client that uses `@prisma/client/runtime/wasm-compiler-edge`. This variant:

1. Expresses the WASM dependency as a **static import** that wrangler's bundler (esbuild) can resolve at **deploy time** — not at request time.
2. The bundled WASM binary is included in the Worker bundle as a module-level constant.
3. By the time any request arrives, the WASM is already instantiated — no `WebAssembly.Module()` call happens inside the request handler.

> **Key mental model:** Cloudflare does not block WASM itself. It blocks *dynamic instantiation of WASM during a live request*. Static bundling (resolved by the deployer/bundler before the worker starts) is fine.

### Why the generated files changed

When you run `prisma generate` after changing `runtime = "deno"` to `runtime = "cloudflare"`, Prisma regenerates `prisma/generated/`. You will see many import paths change from:

```typescript
// Before
import { ... } from '@prisma/client/runtime/client'
```
to:
```typescript
// After
import { ... } from '@prisma/client/runtime/wasm-compiler-edge'
```

**This is the expected, correct output.** The generated files are artifacts — you do not write them by hand. The `runtime` field in `schema.prisma` is the authoritative setting; the generated imports are its consequence. Reviewing the one-line schema change is what matters.

---

## The Fix

### 1. Update `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated"
  runtime  = "cloudflare"   // ← was "deno"
}
```

### 2. Regenerate the Prisma client

```bash
deno task prisma:generate
# or: npx prisma generate
```

This regenerates `prisma/generated/` with `wasm-compiler-edge` imports.

### 3. Deploy

```bash
wrangler deploy
```

### 4. Verify

```bash
curl -s https://<your-worker>.workers.dev/api/health | jq .services.database
# Expected:
# {
#   "status": "healthy",
#   "latency_ms": 42,
#   "db_name": "adblock-compiler",
#   "hyperdrive_host": "..."
# }
```

---

## Why This Was Hard to Diagnose

### The error message is misleading

`WebAssembly.Module(): Wasm code generation disallowed by embedder` does not mention Prisma, does not mention the generator `runtime` field, and does not appear in the Prisma or Cloudflare documentation in any prominent way. A developer unfamiliar with this constraint would naturally search for "why is my app generating WebAssembly?" — which is the wrong question. The app isn't *generating* WASM; Prisma is *loading* WASM, and Cloudflare is blocking it.

### The `latency_ms: 0` mislead the first diagnosis

The first KB article (KB-002) correctly identified that `latency_ms: 0` means a pre-connection failure — which led to looking at the Zod schema validation for the connection string (`postgres://` vs `postgresql://`). That was a real bug and a valid fix, but it masked the underlying WASM issue: once the Zod fix landed, the error changed from a silent Zod throw to a visible WASM error. The WASM error was always there; the Zod error was just happening first.

### Prisma 7 is newly released

Prisma 7 shipped the new `prisma-client` generator (with the explicit `runtime` field) in late 2025. Documentation coverage at the time of this incident was sparse. The Prisma docs for Cloudflare deployment show the `runtime` field, but the specific consequence of using `"deno"` on Workers (dynamic WASM = blocked) is not called out as a warning.

### The fix is a one-liner with a large generated diff

The 1-line schema change produces hundreds of lines of diff in the generated client. This makes PRs harder to review — the signal is buried in noise. Future reviewers: **always look at `schema.prisma` first; the generated files are artifacts**.

---

## Checklist for Future Prisma + Cloudflare Workers Setup

Use this when setting up Prisma in a new Cloudflare Workers project:

- [ ] `generator client` block uses `provider = "prisma-client"` (Prisma 7+)
- [ ] `runtime = "cloudflare"` is set — **not** `"deno"`, `"nodejs"`, or omitted
- [ ] `output = "./generated"` (or your preferred output path)
- [ ] After any schema change: run `prisma generate` and commit the regenerated files
- [ ] Use `@prisma/adapter-pg` with the Hyperdrive connection string (not `@prisma/adapter-neon`)
- [ ] PrismaClient is created **per request** (Hyperdrive is the pool; per-request creation is safe and expected)
- [ ] Always `await prisma.$disconnect()` in a `finally` block
- [ ] The `HYPERDRIVE` binding in `wrangler.toml` uses scheme `postgres://` (not `postgresql://`) — the schema validation must accept both

---

## Wrangler Configuration Reference

```toml
# wrangler.toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<your-hyperdrive-id>"
```

```bash
# Local dev (.dev.vars)
WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://user:pass@host:5432/dbname"
```

---

## Related KB Articles

| Article | Subject |
|---|---|
| [KB-001](./KB-001-api-not-available.md) | "API is not available" on the home page |
| [KB-002](./KB-002-hyperdrive-database-down.md) | `database: down` / `latency_ms: 0` — Zod schema rejecting `postgres://` |
| [KB-003](./KB-003-neon-hyperdrive-live-session-2026-03-25.md) | Live troubleshooting session notes (2026-03-25) |

---

## References

- [Prisma: Deploy to Cloudflare Workers](https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare)
- [Prisma: Cloudflare Workers + Neon guide](https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare#neon)
- [Cloudflare Hyperdrive docs](https://developers.cloudflare.com/hyperdrive/)
- [GitHub issue: prisma/prisma #28657](https://github.com/prisma/prisma/issues/28657) — community report of the same root cause
- [Prisma Cloudflare Workers guide](https://docs.prisma.io/docs/guides/deployment/cloudflare-workers)
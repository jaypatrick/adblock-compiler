# Idea: Cloudflare-Native Testing with `@cloudflare/vitest-pool-workers`

> **Status:** Idea / Deferred  
> **Origin:** Issue [#1291](https://github.com/jaypatrick/adblock-compiler/issues/1291) — closed in favour of this document  
> **Date noted:** 2026-03-27 18:00:39

---

## Summary

Add `@cloudflare/vitest-pool-workers` as a **third, focused test tier** that runs binding-behaviour integration tests inside the real `workerd`/Miniflare 3 runtime — *not* as a replacement for the existing Deno test suite, and *not* for unit tests.

---

## Context & Current Test Pyramid

The project already has a healthy, working test pyramid:

| Tier | Runner | Scope |
|---|---|---|
| Unit tests | Deno (`src/`) | Pure logic — compiler, transforms, utils, schemas |
| Worker handler tests | Deno + `MockEnv` | Handler logic, auth flows, Zod validation, rate limiting |
| E2E tests | Deno (`api.e2e.test.ts`) | Hits a live server; skips gracefully when unavailable |
| Frontend tests | Vitest | Angular component/service tests |

This pyramid works well today. We have not experienced meaningful "works locally, breaks on Cloudflare" issues, and the mock-based approach (`MockKVNamespace`, `MockEnv`, `createMockD1`, etc.) is sufficient for current needs.

---

## The Gap `@cloudflare/vitest-pool-workers` Would Fill

The mock approach has a ceiling. There is a class of Cloudflare-specific behaviour that cannot be meaningfully replicated with in-process mocks:

| Behaviour | Deno + Mock | `vitest-pool-workers` (workerd) |
|---|---|---|
| Handler logic, Zod validation, auth flows | ✅ Fine — keep here | Overkill |
| KV `get`/`put` semantics | ✅ Map mock is sufficient | No real advantage yet |
| **Queue batch semantics** (`ackAll`, `retryAll`, partial ack, retry backoff) | ⚠️ Mock cannot replicate | ✅ Real value |
| **Durable Object lifecycle** (`alarm()`, `webSocketMessage()`, hibernation, storage consistency) | ⚠️ Very hard to mock accurately | ✅ Real value |
| **Workflow step sequencing** (`step.do` replay, `step.sleep`, durable execution guarantees) | ❌ Essentially untestable with mocks | ✅ Real value |
| `waitUntil` / `passThroughOnException` runtime behaviour | ⚠️ Behavioural gap | ✅ Real value |
| Analytics Engine / Hyperdrive in a real isolate | N/A — no local simulation | ✅ Real value |

---

## When to Revisit

This becomes worth implementing when we are actively building out:

- **Cloudflare Workflows** — `COMPILATION_WORKFLOW`, `BATCH_COMPILATION_WORKFLOW`, `CACHE_WARMING_WORKFLOW`, `HEALTH_MONITORING_WORKFLOW`
- **Durable Objects** — `AdblockCompiler` (Container DO), `MCP_AGENT` (PlaywrightMcpAgent)
- **Queue consumers** — `BLOQR_BACKEND_QUEUE`, `BLOQR_BACKEND_QUEUE_HIGH_PRIORITY` with non-trivial retry/ack logic
- **Dynamic Workers** — ephemeral V8 isolate dispatch

The foundational code and architecture needs to be in place first. Adding this testing tier prematurely would be complexity with no payoff.

---

## Proposed Scope (When Implemented)

> **Do not frame this as "duplicating the Deno test suite in Vitest."** The scope is narrow and additive.

- Add a `vitest.workers.config.ts` alongside the existing configs
- Target only tests that exercise **binding behaviour** in `workerd`:
  - Workflow step sequencing and replay correctness
  - Durable Object alarm scheduling and storage transactions
  - Queue consumer batch processing (partial ack, retry, DLQ path)
  - `waitUntil`-based fire-and-forget side effects
- Existing Deno handler tests stay as-is — no migration needed
- CI runs both suites in parallel (Deno + workerd)

---

## What This Is NOT

- Not a replacement for Deno unit tests
- Not a re-implementation of handler/schema/auth tests in a different runner
- Not needed until the Workflow/DO-heavy features are built and stabilised

---

## References

- [`@cloudflare/vitest-pool-workers` docs](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Hono + Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [EasyDevv/cloudflare-hono-vitest](https://github.com/EasyDevv/cloudflare-hono-vitest)
- Original issue: [#1291](https://github.com/jaypatrick/adblock-compiler/issues/1291)
# Cloudflare Resource Inventory
_Generated: 2026-05-04 (account: JK.com, `07a1f8d207654fe5d838174af4813126`)_

## Summary

| Metric | Count |
|--------|-------|
| Resource types attempted | 14 |
| Accessible | 9 |
| Not accessible (permission missing) | 5 |
| Total individual resources enumerated | 104 |

### Naming Mismatch Count by Resource Type

| Resource Type | Total | ⚠️ Mismatched | ✅ Correct / Unrelated |
|---------------|-------|---------------|------------------------|
| Workers | 10 | 5 | 5 |
| KV Namespaces | 18 | 5 | 13 |
| R2 Buckets | 13 | 3 | 10 |
| D1 Databases | 7 | 2 | 5 |
| Queues | 16 | 6 | 10 |
| Workers Workflows | 6 | 5 | 1 |
| Durable Object Namespaces | 11 | 6 | 5 |
| Workers Custom Domains | 9 | 5 | 4 |
| Zones | 3 | 0 | 3 |

---

## Accessible Resources

### Workers

> **Critical note:** Both `adblock-compiler` and `bloqr-backend` are live Workers. `adblock-compiler` is the **currently active** production backend (`api.bloqr.dev` points to it, all Workflows are registered against it, cron schedules run on it). `bloqr-backend` was freshly deployed 2026-05-03 but has no custom domain, no cron schedules, and all its queue/R2/D1 bindings point to the new `bloqr-backend-*` resources — so it is **not yet serving traffic**.

| Name | Last Modified | Workers.dev | Cron Schedules | Notes |
|------|---------------|-------------|----------------|-------|
| `adblock-compiler` | 2026-05-03 22:46 | ✅ enabled | `0 * * * *`, `0 */6 * * *` | ⚠️ **MISMATCH** — active production backend; should be `bloqr-backend`; still owns `api.bloqr.dev` domain |
| `adblock-email` | 2026-04-25 22:41 | unknown | none | ⚠️ **MISMATCH** — should be `bloqr-email`; owns `email.bloqr.dev` |
| `adblock-frontend` | 2026-04-25 22:41 | unknown | none | ⚠️ **MISMATCH** — should be `bloqr-frontend` (new `bloqr-frontend` script also exists) |
| `adblock-landing` | 2026-04-25 22:41 | unknown | none | ⚠️ **MISMATCH** — owns `bloqr.dev` and `mta-sts.bloqr.dev`; consider renaming to `bloqr-landing` |
| `adblock-tail` | 2026-04-25 22:41 | unknown | none | ⚠️ **MISMATCH** — should be `bloqr-tail` (new `bloqr-tail` script also exists); owns `tail.bloqr.dev` |
| `bloqr-backend` | 2026-05-03 22:46 | ❌ disabled | none | ✅ correct name — newly created; **not yet live** (no custom domain, no cron, `bloqr-backend-*` bindings) |
| `bloqr-docs` | 2026-04-25 22:41 | unknown | none | ✅ correct name — owns `docs.bloqr.dev` |
| `bloqr-frontend` | 2026-04-25 22:41 | unknown | none | ✅ correct name — owns `app.bloqr.dev` |
| `bloqr-tail` | 2026-04-25 22:41 | unknown | none | ✅ correct name |
| `jk-dot-com` | 2025-10-16 01:43 | unknown | none | Unrelated project — owns `jaysonknight.com`, `www.jaysonknight.com` |

---

### KV Namespaces

| Name | Namespace ID | Notes |
|------|-------------|-------|
| `adblock-compiler-COMPILATION_CACHE` | `7772628d…` | ⚠️ **MISMATCH** — should be `bloqr-backend-COMPILATION_CACHE`; used by `adblock-compiler` as `COMPILATION_CACHE` binding |
| `adblock-compiler-METRICS` | `025c3f10…` | ⚠️ **MISMATCH** — should be `bloqr-backend-METRICS`; used by `adblock-compiler` as `METRICS` binding |
| `adblock-compiler-RATE_LIMIT` | `5dc36da3…` | ⚠️ **MISMATCH** — should be `bloqr-backend-RATE_LIMIT`; used by `adblock-compiler` as `RATE_LIMIT` binding |
| `adblock-compiler-TAIL-LOGS` | `476d9c75…` | ⚠️ **MISMATCH** — should be `bloqr-backend-TAIL-LOGS` or `bloqr-tail-TAIL-LOGS` |
| `adblock-landing-session` | `3a4802a1…` | ⚠️ **MISMATCH** — consider renaming to `bloqr-landing-session` |
| `__adblock-compiler-workers_sites_assets` | `350c14b2…` | Static assets KV for `adblock-compiler`; will become stale once cutover |
| `__hostlist-compiler-worker-workers_sites_assets` | `ba562a1f…` | Very old static assets KV — likely stale, candidate for deletion |
| `BETTER_AUTH_KV` | `343029e0…` | ✅ generic name — used by both `adblock-compiler` and `bloqr-backend` |
| `BLOQR_STRIPE_KV` | `db3c3780…` | ✅ correct naming |
| `CACHE` | `7349e2a7…` | ✅ generic name |
| `CONFIG_STORE` | `fb5879d1…` | ✅ generic name — used by both `adblock-compiler` and `bloqr-backend` |
| `EMAIL_DEDUP` | `e6bd43ce…` | ✅ generic name |
| `FEATURE_FLAGS` | `532484fd…` | ✅ generic name — used by both `adblock-compiler` and `bloqr-backend` |
| `RULES_KV` | `b815efdc…` | ✅ generic name — used by both `adblock-compiler` and `bloqr-backend` |
| `bloqr-blog-session` | `f3d414e2…` | ✅ correct naming |
| `jk-blog-session` | `d693f2e0…` | Unrelated project |
| `jk-dot-com-session` | `a3b003ed…` | Unrelated project |
| `knightly-build-session` | `4eabe7ae…` | Unrelated project |

---

### R2 Buckets

> Both old `adblock-compiler-*` and new `bloqr-backend-*` buckets exist simultaneously. `adblock-compiler` binds to the old ones; `bloqr-backend` binds to the new ones. Old buckets should be migrated/deleted after cutover.

| Name | Notes |
|------|-------|
| `adblock-compiler-error-logs` | ⚠️ **MISMATCH** — should be `bloqr-backend-error-logs`; `adblock-compiler` binds to this as `ERROR_BUCKET` |
| `adblock-compiler-logs` | ⚠️ **MISMATCH** — should be `bloqr-backend-logs`; `adblock-compiler` binds to this as `COMPILER_LOGS` |
| `adblock-compiler-r2-storage` | ⚠️ **MISMATCH** — should be `bloqr-backend-r2-storage`; `adblock-compiler` binds to this as `FILTER_STORAGE` |
| `ai-search-cold-rain-347d-5b231a` | Auto-generated name — unrelated AI project |
| `ai-search-odd-smoke-c4af-e83dc2` | Auto-generated name — unrelated AI project |
| `bloqr-backend-error-logs` | ✅ correct naming — `bloqr-backend` binds to this as `ERROR_BUCKET` |
| `bloqr-backend-logs` | ✅ correct naming — `bloqr-backend` binds to this as `COMPILER_LOGS` |
| `bloqr-backend-r2-storage` | ✅ correct naming — `bloqr-backend` binds to this as `FILTER_STORAGE` |
| `bloqr-blog-media` | ✅ correct naming |
| `cloudflare-managed-3473eeb6` | Managed by Cloudflare — do not touch |
| `jk-blog-media` | Unrelated project |
| `jk-media` | Unrelated project |
| `knightly-build-media` | Unrelated project |

---

### D1 Databases

> **Critical:** The two backend databases still carry the `adblock-compiler-*` name in Cloudflare, but `wrangler.toml` references them by the `bloqr-backend-*` name. The UUID is what Cloudflare actually uses for binding, so deploys work — but the dashboard name creates confusion.

| Name (in CF dashboard) | UUID | `wrangler.toml` binding name | Notes |
|------------------------|------|------------------------------|-------|
| `adblock-compiler-admin-d1` | `7d5a2704-5033-4433-911f-d8368f36dcdf` | `bloqr-backend-admin-d1` (ADMIN_DB) | ⚠️ **MISMATCH** — dashboard name ≠ wrangler name |
| `adblock-compiler-d1-database` | `3e8e7dfe-3213-452a-a671-6c18e6e74ce5` | `bloqr-backend-d1-database` (DB) | ⚠️ **MISMATCH** — dashboard name ≠ wrangler name |
| `bloqr-blog-d1` | `9546f7e9-…` | — | ✅ correct naming |
| `bloqr-config-cache` | `8d6153e2-…` | — | ✅ correct naming |
| `bloqr-email` | `662fc37a-…` | — | ✅ correct naming |
| `jk-blog-d1` | `ed4a0fbb-…` | — | Unrelated project |
| `jk-emdash` | `c6beff50-…` | — | Unrelated project |

---

### Queues

> Both old `adblock-compiler-*` and new `bloqr-backend-*` queues exist. Old queues still have `adblock-compiler` as both producer and consumer. New `bloqr-backend-*` queues have **no consumers** configured yet — cutover has not happened.

| Name | Producers | Consumers | Notes |
|------|-----------|-----------|-------|
| `adblock-compiler-dlq` | none | `adblock-compiler` | ⚠️ **MISMATCH** — dead-letter queue for old worker |
| `adblock-compiler-email-dlq` | none | `adblock-compiler` | ⚠️ **MISMATCH** — email DLQ for old worker |
| `adblock-compiler-email-queue` | `adblock-compiler` | `adblock-compiler` | ⚠️ **MISMATCH** — should be `bloqr-backend-email-queue` |
| `adblock-compiler-error-queue` | `adblock-compiler` | `adblock-compiler` | ⚠️ **MISMATCH** — should be `bloqr-backend-error-queue` |
| `adblock-compiler-worker-queue` | `adblock-compiler` | `adblock-compiler` | ⚠️ **MISMATCH** — should be `bloqr-backend-worker-queue` |
| `adblock-compiler-worker-queue-high-priority` | `adblock-compiler` | `adblock-compiler` | ⚠️ **MISMATCH** — should be `bloqr-backend-worker-queue-high-priority` |
| `bloqr-backend-dlq` | none | none | ✅ correct name — no consumer yet |
| `bloqr-backend-email-dlq` | none | none | ✅ correct name — no consumer yet |
| `bloqr-backend-email-queue` | none (via `bloqr-backend` binding) | none | ✅ correct name — **no consumer configured yet** |
| `bloqr-backend-error-queue` | none (via `bloqr-backend` binding) | none | ✅ correct name — **no consumer configured yet** |
| `bloqr-backend-worker-queue` | none (via `bloqr-backend` binding) | none | ✅ correct name — **no consumer configured yet** |
| `bloqr-backend-worker-queue-high-priority` | none (via `bloqr-backend` binding) | none | ✅ correct name — **no consumer configured yet** |
| `default-queue` | none | none | Created 2026-05-03 — likely from Stripe/test setup |
| `email-dlq` | none | `adblock-landing` | Belongs to landing worker |
| `email-queue` | `adblock-landing` | `adblock-landing` | Belongs to landing worker |
| `images-events` | none | none | Older queue — stale candidate |

---

### Workers Workflows

> All five backend workflows are still registered under `adblock-compiler`. The `bloqr-backend` worker was deployed 2026-05-03, but **workflows have not been migrated**. `health-monitoring-workflow` and `cache-warming-workflow` are actively running (748 and 125 completed instances).

| Workflow Name | Registered Script | Class Name | Status | Notes |
|---------------|------------------|-----------|--------|-------|
| `batch-compilation-workflow` | `adblock-compiler` | `BatchCompilationWorkflow` | 0 instances | ⚠️ **MISMATCH** — should be registered under `bloqr-backend` |
| `cache-warming-workflow` | `adblock-compiler` | `CacheWarmingWorkflow` | 125 completed | ⚠️ **MISMATCH** — **actively running**; should be `bloqr-backend` |
| `compilation-workflow` | `adblock-compiler` | `CompilationWorkflow` | 7 completed | ⚠️ **MISMATCH** — should be `bloqr-backend` |
| `email-delivery-workflow` | `adblock-compiler` | `EmailDeliveryWorkflow` | 0 instances | ⚠️ **MISMATCH** — should be `bloqr-backend` |
| `health-monitoring-workflow` | `adblock-compiler` | `HealthMonitoringWorkflow` | 748 completed | ⚠️ **MISMATCH** — **actively running**; should be `bloqr-backend` |
| `waitlist-signup` | `adblock-landing` | `WaitlistSignupWorkflow` | 0 instances | ⚠️ Belongs to `adblock-landing`; consider renaming to `bloqr-landing` |

---

### Durable Object Namespaces

> Six namespaces belong to the old `adblock-compiler` worker; five exist for `bloqr-backend`. `StripeWebhookProcessor` has **no counterpart in `bloqr-backend`** yet.

| Name | Namespace ID | Script | Class | SQLite | Containers |
|------|-------------|--------|-------|--------|------------|
| `adblock-compiler_AdblockCompiler` | `9674e577…` | `adblock-compiler` | `AdblockCompiler` | ✅ | ✅ | ⚠️ old script |
| `adblock-compiler_CompilationCoordinator` | `8374196a…` | `adblock-compiler` | `CompilationCoordinator` | ✅ | — | ⚠️ old script |
| `adblock-compiler_PlaywrightMcpAgent` | `d5beef67…` | `adblock-compiler` | `PlaywrightMcpAgent` | ✅ | — | ⚠️ old script |
| `adblock-compiler_RateLimiterDO` | `d924f0d7…` | `adblock-compiler` | `RateLimiterDO` | ✅ | — | ⚠️ old script |
| `adblock-compiler_StripeWebhookProcessor` | `66dcb790…` | `adblock-compiler` | `StripeWebhookProcessor` | — | — | ⚠️ **No `bloqr-backend` counterpart exists yet** |
| `adblock-compiler_WsHibernationDO` | `c1ca982c…` | `adblock-compiler` | `WsHibernationDO` | ✅ | — | ⚠️ old script |
| `bloqr-backend_AdblockCompiler` | `a42644d6…` | `bloqr-backend` | `AdblockCompiler` | ✅ | ✅ | ✅ correct |
| `bloqr-backend_CompilationCoordinator` | `f0b62b6b…` | `bloqr-backend` | `CompilationCoordinator` | ✅ | — | ✅ correct |
| `bloqr-backend_PlaywrightMcpAgent` | `ae8a6b0a…` | `bloqr-backend` | `PlaywrightMcpAgent` | ✅ | — | ✅ correct |
| `bloqr-backend_RateLimiterDO` | `01e9e5e2…` | `bloqr-backend` | `RateLimiterDO` | ✅ | — | ✅ correct |
| `bloqr-backend_WsHibernationDO` | `701e19b3…` | `bloqr-backend` | `WsHibernationDO` | ✅ | — | ✅ correct |

---

### Workers Custom Domains

| Hostname | Zone | Worker Script | Environment | Notes |
|----------|------|--------------|-------------|-------|
| `api.bloqr.dev` | `bloqr.dev` | `adblock-compiler` | production | ⚠️ **CRITICAL MISMATCH** — live API traffic routed to old `adblock-compiler`; must point to `bloqr-backend` after cutover |
| `bloqr.dev` | `bloqr.dev` | `adblock-landing` | production | ⚠️ **MISMATCH** — `adblock-landing` should be `bloqr-landing` |
| `email.bloqr.dev` | `bloqr.dev` | `adblock-email` | production | ⚠️ **MISMATCH** — `adblock-email` should be `bloqr-email` |
| `mta-sts.bloqr.dev` | `bloqr.dev` | `adblock-landing` | production | ⚠️ **MISMATCH** — `adblock-landing` should be `bloqr-landing` |
| `tail.bloqr.dev` | `bloqr.dev` | `adblock-tail` | production | ⚠️ **MISMATCH** — `adblock-tail` should be `bloqr-tail` |
| `app.bloqr.dev` | `bloqr.dev` | `bloqr-frontend` | production | ✅ correct |
| `docs.bloqr.dev` | `bloqr.dev` | `bloqr-docs` | production | ✅ correct |
| `jaysonknight.com` | `jaysonknight.com` | `jk-dot-com` | production | Unrelated project |
| `www.jaysonknight.com` | `jaysonknight.com` | `jk-dot-com` | production | Unrelated project |

---

### Zones (Domains)

| Domain | Zone ID | Status | Plan | Notes |
|--------|---------|--------|------|-------|
| `bloqr.dev` | `a619a2e0…` | Active | Pro | ✅ Primary project domain |
| `jaysonknight.com` | `4caa9904…` | Active | Pro | Unrelated — personal site |
| `knightlocked.com` | `76e6a72e…` | Active | Free | Unrelated |

---

### Pages Projects

_0 Pages projects found. Account uses Workers + Static Assets instead of Pages._

---

### Pipelines

_0 Pipelines found in the API listing._ Note: A `METRICS_PIPELINE` binding exists in both `adblock-compiler` and `bloqr-backend` pointing to pipeline ID `c846e37117874905a94b1ef9da2e138e` — this pipeline may exist but is not returned by the Pipelines list endpoint.

---

### Workers Cron Schedules

| Worker | Cron | Frequency |
|--------|------|-----------|
| `adblock-compiler` | `0 * * * *` | Hourly |
| `adblock-compiler` | `0 */6 * * *` | Every 6 hours |
| `bloqr-backend` | _(none configured)_ | — |

> **⚠️ Cron schedules have not been migrated to `bloqr-backend`.** The new worker currently has no scheduled triggers.

---

## ⚠️ Not Accessible (Token Permission Gaps)

| Resource Type | Error / Permission Required |
|---------------|-----------------------------|
| Hyperdrive Configurations | `Authentication error` (code 10000) — token needs **Hyperdrive: Read** permission |
| AI Gateway | `Authentication error` (code 10000) — token needs **AI Gateway: Read** permission |
| Vectorize Indexes | `Authentication error` (code 10000) — token needs **Vectorize: Read** permission |
| Logpush Jobs | `Authentication error` (code 10000) — token needs **Logs: Read** permission |
| Email Routing Rules (Zone) | `Authentication error` (code 10000) — token needs **Email Routing Rules: Read** permission scoped to zone |

> **Note:** Workers for Platforms (Dispatch Namespaces) returned a different error: `10121: You do not have access to dispatch namespaces` — this is a plan limitation, not a token issue (requires Enterprise).

---

## Critical Action Items

The following are the most impactful mismatches that must be resolved to complete the `adblock-compiler-*` → `bloqr-backend-*` migration:

### 🔴 Blocking (production traffic affected)

1. **`api.bloqr.dev` custom domain** → still routes to `adblock-compiler`. Must be updated to `bloqr-backend` during cutover.
2. **All 5 backend Workflows** → still registered under `adblock-compiler`. After cutover, health monitoring and cache warming will fail if the old worker is retired.
3. **Cron schedules** → still on `adblock-compiler`. `bloqr-backend` has no cron triggers.

### 🟡 Pre-cutover (required before retiring `adblock-compiler`)

4. **Queue consumers** → all old `adblock-compiler-*` queues have `adblock-compiler` as consumer; the new `bloqr-backend-*` queues have **no consumers**. Add `[[queues.consumers]]` to `[env.production]` in `wrangler.toml` and deploy `bloqr-backend`.
5. **`StripeWebhookProcessor` Durable Object** → exists only in `adblock-compiler`; no `bloqr-backend_StripeWebhookProcessor` namespace exists. Must be added to `bloqr-backend` deployment before cutover.
6. **KV namespaces** → 5 KV namespaces carry `adblock-compiler-*` names; new equivalents need to be created and data migrated, or the names need to be updated in place via the CF dashboard.
7. **D1 database display names** → `adblock-compiler-admin-d1` and `adblock-compiler-d1-database` should be renamed to `bloqr-backend-admin-d1` / `bloqr-backend-d1-database` in the CF dashboard (the UUIDs already match in `wrangler.toml`).

### 🟢 Cleanup (after cutover)

8. Delete old `adblock-compiler-*` R2 buckets after data migration.
9. Delete old `adblock-compiler-*` queues after `bloqr-backend` consumers are verified.
10. Retire `adblock-frontend`, `adblock-tail`, `adblock-email`, `adblock-landing` Worker scripts once the `bloqr-*` counterparts are fully live.
11. Delete stale KV namespaces: `__adblock-compiler-workers_sites_assets`, `__hostlist-compiler-worker-workers_sites_assets`.

# Sentry Best Practices

This document covers recommended configuration and operational practices for
using Sentry with `adblock-compiler`. It is intended for the team member who
owns the Sentry project on `jkcom.sentry.io` as well as any developer
troubleshooting issues.

---

## Table of contents

1. [Project setup on sentry.io](#1-project-setup-on-sentryio)
2. [Alert rules](#2-alert-rules)
3. [Issue grouping and fingerprinting](#3-issue-grouping-and-fingerprinting)
4. [Performance monitoring](#4-performance-monitoring)
5. [Quota management](#5-quota-management)
6. [Environment configuration](#6-environment-configuration)
7. [Session replay — privacy considerations](#7-session-replay--privacy-considerations)
8. [Source maps](#8-source-maps)
9. [Team access and roles](#9-team-access-and-roles)
10. [Future: Sentry data in the admin UI](#10-future-sentry-data-in-the-admin-ui)

---

## 1. Project setup on sentry.io

### Recommended project structure

Use **two separate Sentry projects** under the `jkcom` organisation:

| Project slug | Platform | What it captures |
|-------------|----------|------------------|
| `adblock-compiler` | Cloudflare Workers | Main Worker errors, scheduled jobs, queue handlers, tail worker exceptions |
| `adblock-compiler-frontend` | JavaScript/Browser | Angular RUM errors, browser traces, session replay |

Using separate projects allows independent quotas, alert routing, and source
map management. Both share the same `SENTRY_DSN` secret if you choose one project,
or you can set two distinct DSNs (one per `SENTRY_DSN` secret scope).

> **Current setup (single project):** `adblock-compiler` — both Worker and
> Angular frontend use the same DSN via `/api/sentry-config`.

### Project settings checklist

- **Security & Privacy → Data Scrubbing**: Enable `Scrub IP Addresses` and
  `Scrub Defaults` (removes PII like emails, credit cards) in
  *Settings → Projects → adblock-compiler → Security & Privacy*.
- **Inbound Filters → Browser Extensions**: Enable to suppress noisy extension
  errors from session replay users.
- **Inbound Filters → Localhost**: Enable to block events from local dev
  (belt-and-suspenders alongside the `environment` tag filtering below).

---

## 2. Alert rules

### Recommended alert rules

Navigate to **Alerts → Create Alert Rule** for each of the following:

#### 2.1 Error spike alert

| Field | Value |
|-------|-------|
| When | An issue is first seen |
| Conditions | `environment = production` |
| Actions | Notify via email / Slack (#alerts channel) |
| Priority | High |

#### 2.2 Error rate threshold

| Field | Value |
|-------|-------|
| Type | Metric alert |
| Metric | Number of errors |
| Interval | 5 min |
| Threshold | > 50 errors triggers warning; > 200 triggers critical |
| Filter | `environment:production` |

#### 2.3 New issue in production

| Field | Value |
|-------|-------|
| When | A new issue is created |
| Conditions | `environment = production` |
| Actions | Create a GitHub issue via the **GitHub integration** |

### GitHub integration

Connect Sentry to GitHub at *Settings → Integrations → GitHub*. This enables:
- Automatic suspect commit identification
- Stack frame blame annotations
- Two-way issue linking (Sentry issue ↔ GitHub issue)

---

## 3. Issue grouping and fingerprinting

### Default grouping

Sentry groups errors by their stack trace signature. For Cloudflare Workers,
minified code causes grouping to degrade — this is solved by **source maps**
(see §8). Always upload source maps before investigating grouped issues.

### Custom fingerprinting (when needed)

If errors are over-grouped (many distinct errors merged into one), add a
fingerprinting rule in *Settings → Projects → adblock-compiler → Issue Grouping
→ Fingerprint Rules*:

```
# Example: group filter-list parse errors by the rule that caused them
error.value:"*FilterListParseError*" -> {{ error.value }}
```

If errors are under-grouped (one logical error creates many issues), use:

```
# Example: merge all rate-limit errors into one issue
error.value:"*429*rate limit*" -> rate-limit-error
```

### Ignore rules

Use **Inbound Data Filters** (not `ignore`) for persistent noise. Reserve
`ignore` for transient suppression only — ignored issues continue counting
against your quota.

---

## 4. Performance monitoring

### Sample rates (current configuration)

| Layer | Setting | Value | Rationale |
|-------|---------|-------|-----------|
| Worker (`withSentryWorker`) | `tracesSampleRate` | `0.1` (10 %) | Low enough for free quota; sufficient for p50/p95 baselines |
| Tail Worker | `tracesSampleRate` | `0` | No transactions — errors only |
| Angular frontend | `tracesSampleRate` | `0.1` (10 %) | Page-load + navigation spans |

### Tuning for environments

```typescript
// In worker/services/sentry-init.ts — adjust per environment
const tracesSampleRate = env.ENVIRONMENT === 'staging' ? 1.0 : 0.1;
```

### Key transactions to monitor

| Transaction | Expected p95 | Alert threshold |
|------------|-------------|-----------------|
| `POST /compile` | < 500 ms | > 2 000 ms |
| `POST /validate` | < 200 ms | > 1 000 ms |
| `GET /ast/parse` | < 300 ms | > 1 500 ms |
| Angular page load | < 2 s | > 5 s |

Set custom thresholds in *Performance → Thresholds* on sentry.io.

---

## 5. Quota management

### Free tier limits (as of 2024)

| Type | Free monthly quota |
|------|--------------------|
| Errors | 5 000 |
| Performance units | 10 000 |
| Replays | 50 |
| Attachments | 1 GB |

### Strategies to stay within quota

1. **Lower `tracesSampleRate` in production** — `0.05` (5 %) is enough for
   meaningful performance data in high-traffic production.
2. **Use `replaysSessionSampleRate: 0.01`** (1 %) in production if replay quota
   is exhausted. `replaysOnErrorSampleRate: 1.0` should stay at 100 % — these
   are the most valuable replays.
3. **Filter out health-check noise** — add an inbound filter for
   `url:*/health*` to suppress noisy monitoring probes.
4. **Rate-limit repeated errors** — in *Settings → Projects → Rate Limits*,
   cap inbound events at 100/min per project to prevent a bug storm from
   exhausting the monthly quota instantly.

### Monitoring quota usage

Check *Settings → Usage & Billing → Usage Stats* weekly. Set a budget alert at
80 % consumption to get early warning.

---

## 6. Environment configuration

### Environment tags

The Worker sets the `environment` tag via `env.ENVIRONMENT` (a Worker var):

```toml
# wrangler.toml
[vars]
ENVIRONMENT = "production"
```

For staging/PR preview deployments:

```bash
wrangler deploy --env staging --var ENVIRONMENT:staging
```

The Angular frontend receives `environment` from `/api/sentry-config` and
passes it to `initSentry()` — no separate frontend config is needed.

### Recommended environment strategy

| Wrangler environment | `ENVIRONMENT` value | Sentry `tracesSampleRate` |
|---------------------|---------------------|--------------------------|
| production | `production` | 0.1 |
| staging | `staging` | 1.0 |
| preview (PR) | `preview` | 0 (errors only) |
| local dev | not sent (no `SENTRY_DSN`) | N/A |

### Filtering in the Sentry UI

Use the **Environment selector** dropdown (top-right in the Sentry UI) to scope
Issues, Performance, and Replays to a single environment. Avoid browsing
`production` alerts while looking at `staging` data.

---

## 7. Session replay — privacy considerations

Session replay is enabled with conservative defaults:

```typescript
replaysSessionSampleRate: 0.05,  // 5 % of sessions
replaysOnErrorSampleRate: 1.0,   // 100 % of error sessions
```

### Privacy checklist before enabling in production

- [ ] **Review data scrubbing** — *Settings → Security & Privacy → Data Scrubbing*:
  enable `Scrub Defaults` and add custom selectors for any PII fields specific
  to this app (e.g. `#filter-list-input` if it can contain user-generated content).
- [ ] **Mask sensitive elements** — add `maskAllText: false` with targeted
  `mask: ['input[type=password]', '.pii']` selectors if full masking is too broad.
- [ ] **Review GDPR obligations** — if any EU users access the admin site, ensure
  your privacy policy discloses session replay and obtain explicit consent.
  Consider `replaysSessionSampleRate: 0` in EU regions.
- [ ] **Disable replays in non-prod** — `replaysSessionSampleRate: 0` in staging
  is sufficient; only error replays (`replaysOnErrorSampleRate`) are valuable
  for debugging.

---

## 8. Source maps

Source maps are uploaded automatically via `.github/workflows/sentry-sourcemaps.yml`
on every push to `main`. This enables readable stack traces in Sentry Issues.

### Required GitHub secrets/variables

| Name | Type | Where to get it |
|------|------|-----------------|
| `SENTRY_AUTH_TOKEN` | Secret | *Sentry → Settings → Account → API → Auth Tokens* — create with `project:releases` + `org:read` scopes |
| `SENTRY_ORG` | Variable | Your org slug: `jkcom` |
| `SENTRY_PROJECT` | Variable | `adblock-compiler` |

### Validating source map uploads

After a push to `main`, check **Sentry → Releases** — the release should appear
with a green ✅ next to "Source Maps". If it shows ⚠️:

1. Check the `sentry-sourcemaps.yml` workflow run in GitHub Actions for errors.
2. Verify `SENTRY_AUTH_TOKEN` has `project:releases` scope.
3. Confirm the `--release` flag in the workflow matches `${{ github.sha }}` exactly.

### Worker source maps

The Worker bundle is built with `wrangler deploy --dry-run --outdir dist/worker`
and the resulting `dist/worker/index.js.map` is uploaded separately. Cloudflare
Workers runs Node-compatible source map resolution — Sentry will de-minify
Worker stack traces automatically once the source map is uploaded.

---

## 9. Team access and roles

### Sentry role mapping

| Role | Who | Sentry permission |
|------|-----|-------------------|
| Owner | Tech lead | Full access including billing |
| Admin | Senior engineers | Manage alerts, integrations, members |
| Member | Engineers | View issues, create releases |
| Contributor | QA / contractors | View only (read-only) |

### Inviting team members

*Settings → Members → Invite Members* — assign the `Member` role by default.
Elevate to `Admin` only for team members who manage alert rules or integrations.

### Service accounts

The `SENTRY_AUTH_TOKEN` used in CI should be a **machine account token**, not
a personal token. Create it at *Settings → Account → API → Auth Tokens*. Name
it `adblock-compiler-ci` and restrict to the minimum required scopes:
`project:releases`, `org:read`.

---

## 10. Future: Sentry data in the admin UI

Currently, Sentry data is viewed directly on `jkcom.sentry.io`. Future work
could surface key metrics in the admin UI without requiring admins to leave
the app. Below are two recommended approaches:

### Option A — Proxy Sentry API (recommended first step)

Add a Worker endpoint that proxies the Sentry API, using the `SENTRY_AUTH_TOKEN`
Worker secret. Admins authenticate through the existing auth layer; the Worker
forwards queries to the Sentry API on their behalf.

```
GET /admin/sentry/issues  →  Worker proxies  →  GET https://sentry.io/api/0/projects/{org}/{project}/issues/
GET /admin/sentry/stats   →  Worker proxies  →  GET https://sentry.io/api/0/organizations/{org}/stats_v2/
```

**Advantages:**
- No DB schema changes — Sentry remains the source of truth
- Uses existing auth tier — only `admin` role can query
- Can be iterated on incrementally (issues → stats → replays)

**Required secret:**
```bash
wrangler secret put SENTRY_AUTH_TOKEN
# Use a machine token with org:read and project:read scopes
```

**Implementation notes:**
- Apply SSRF protection: only allow requests to `https://sentry.io/api/0/` prefix
- Rate-limit the proxy endpoint to prevent quota exhaustion
- Cache responses in KV for 60 s to avoid repeated API calls during dashboard loads

### Option B — Store `sentry_event_id` in D1 for correlation

For compilation events that fail, store the Sentry event ID returned by
`captureException()` in the `compilation_events` D1 table:

```sql
-- Migration (example)
ALTER TABLE compilation_events ADD COLUMN sentry_event_id TEXT;
```

Then link directly to the Sentry issue from the admin compilation detail view:

```typescript
const sentryUrl = `https://jkcom.sentry.io/organizations/jkcom/issues/?query=${sentryEventId}`;
```

**Advantages:** Deep link from a specific compilation failure directly to the
Sentry issue, without needing to copy/paste error IDs.

**Disadvantages:** Requires a D1 migration; Sentry event IDs are only available
for errors captured synchronously (not tail worker exceptions).

### Recommended roadmap

1. **Now**: direct link to `jkcom.sentry.io` from the admin site's
   Observability page (documentation link is sufficient)
2. **Phase 2**: Implement Option A proxy for the Issues and Error Rate stats
   widgets on the admin dashboard
3. **Phase 3**: Add Option B `sentry_event_id` correlation for compilation
   events if deeper drill-down is needed


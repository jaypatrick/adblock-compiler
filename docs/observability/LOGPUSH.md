# Cloudflare Logpush → R2 Setup Guide

Long-term log retention for `bloqr-backend` via Cloudflare Logpush to R2.

---

## Why Logpush?

Cloudflare Workers Logs have a **24-hour TTL** — logs older than one day are
automatically discarded. Logpush delivers a continuous stream of Worker trace
events and structured logs to an R2 bucket (or any supported destination),
giving you **indefinite retention** at low cost.

---

## Prerequisites

1. **Cloudflare account** with Workers Logs and Logpush enabled (included in
   Workers Paid plans).
2. **An R2 bucket** for log storage — a dedicated bucket is recommended to keep
   logs separate from filter-list storage:
   ```bash
   # Create a dedicated R2 bucket for logs (recommended)
   wrangler r2 bucket create adblock-compiler-logs

   # Alternatively, re-use the existing FILTER_STORAGE bucket (not recommended —
   # mix of application data and logs makes queries harder)
   ```
3. `logpush = true` is **already set** in `wrangler.toml` — this flag enables
   Logpush eligibility for the Worker. The commands below create the actual
   delivery pipelines.

---

## Setup commands

### Worker trace requests (errors and non-ok outcomes)

Delivers a filtered stream of Worker invocation traces — useful for debugging
failures without storing every successful request:

```bash
wrangler logpush create \
  --dataset workers-trace-requests \
  --destination-conf "r2://adblock-compiler-logs/{DATE}/trace-requests" \
  --filter '{"where":{"key":"Outcome","operator":"!eq","value":"ok"}}' \
  --fields "Outcome,ScriptName,EventTimestampMs,Logs,Exceptions,RequestUrl,RequestMethod,ResponseStatus"
```

### All Worker logs (structured JSON logs)

Delivers every structured log statement emitted by the Worker
(`console.log`, `AdminLogger`, `AnalyticsService`):

```bash
wrangler logpush create \
  --dataset workers-logs \
  --destination-conf "r2://adblock-compiler-logs/{DATE}/worker-logs"
```

### Manage Logpush jobs

```bash
# List all configured Logpush jobs
wrangler logpush list

# Inspect a specific job
wrangler logpush describe <job-id>

# Pause a job temporarily
wrangler logpush update <job-id> --enabled false

# Delete a job
wrangler logpush delete <job-id>
```

---

## Querying logs from R2

Logs land in R2 as **NDJSON** (newline-delimited JSON), partitioned by date:

```
adblock-compiler-logs/
  2026-03-15/
    trace-requests/   ← filtered Worker trace events
    worker-logs/      ← all structured log lines
```

### Fetch and query with wrangler + jq

```bash
# List objects for a given date
wrangler r2 object list adblock-compiler-logs --prefix "2026-03-15/"

# Download and query errors
wrangler r2 object get adblock-compiler-logs "2026-03-15/trace-requests/..." \
  | jq 'select(.Outcome != "ok") | {ts: .EventTimestampMs, url: .RequestUrl, status: .ResponseStatus}'
```

### Forward to Axiom or Grafana Loki

Add a second Logpush job targeting Axiom's HTTP endpoint or a Loki push API:

```bash
# Example: forward to Axiom (replace with your actual endpoint and token)
wrangler logpush create \
  --dataset workers-logs \
  --destination-conf "https://api.axiom.co/v1/datasets/<dataset>/ingest?token=<api-token>"
```

---

## Cost

| Resource | Rate |
|----------|------|
| R2 storage | ~$0.015 / GB / month |
| R2 operations | $0.36 / million Class B reads |
| Logpush | No additional compute charge |

Typical Worker log volume is well under 1 GB/month for moderate traffic —
total cost is usually under $0.05/month.

---

## Notes

- `logpush = true` in `wrangler.toml` only marks the Worker as *eligible* for
  Logpush. The jobs above must be created separately via `wrangler logpush create`
  or the Cloudflare dashboard.
- Each Logpush job is independent — you can have one for trace events and another
  for structured logs, each with different retention or destination settings.
- R2 bucket names must be globally unique within your Cloudflare account.

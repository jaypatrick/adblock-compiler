# Troubleshooting Manual — adblock-compiler Worker

> Quick-reference for support engineers. Commands are ready to copy-paste.

---

## 1. Quick Health Check

Run these one-liners to verify the Worker is up:

```bash
# Basic health check
curl -s https://adblock-frontend.jk-com.workers.dev/api/health | jq .

# Database smoke test
curl -s https://adblock-frontend.jk-com.workers.dev/api/health/db-smoke | jq .

# Auth providers (verifies auth stack is reachable)
curl -s https://adblock-frontend.jk-com.workers.dev/api/auth/providers | jq .

# Run all diagnostic probes at once
deno task diag:ci

# Run full diagnostics targeting production
deno task diag:prod
```

**Expected outputs:**

| Command                | Expected result                                      |
| ---------------------- | ---------------------------------------------------- |
| `/api/health`          | `{ "status": "healthy", ... }`                       |
| `/api/health/db-smoke` | `{ "ok": true, "db_name": "adblock-compiler", ... }` |
| `/api/auth/providers`  | JSON array of provider names                         |
| `deno task diag:ci`    | All ✅, exit code 0                                  |

---

## 2. Common Errors and Fixes

| Symptom                                       | Probable cause                            | Fix command                                                                 |
| --------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `jq: parse error: Invalid numeric literal`    | Response is gzip-encoded (compress() bug) | Deploy fix: `deno task wrangler:deploy` after applying compress() exemption |
| `/api/health/db-smoke` returns empty response | Worker hang during DB query               | Check Neon dashboard; restart Hyperdrive if needed                          |
| `waitUntil() tasks did not complete`          | Background analytics task stalled         | Check DB connectivity with `probeDbSmoke`                                   |
| `SyntaxError: Unexpected end of JSON`         | Worker returned empty body                | Check tail logs for Worker hang pattern                                     |
| `Worker exceeded CPU time limit`              | Handler too slow or infinite loop         | Review recent deploys; check `wrangler tail`                                |
| `HTTP 502 from SSR Worker`                    | `frontend/server.ts` proxy failed         | Check backend Worker health first                                           |
| Auth endpoints returning 500                  | Better Auth session DB timeout            | See [Auth Issues](#6-auth-issues) section                                   |
| `Cannot read property of undefined`           | Prisma schema mismatch after migration    | Run `deno task db:generate` then redeploy                                   |
| Metrics endpoint slow (> 5s)                  | `waitUntil` hang or DB query block        | Run `probeMetrics` to confirm; check tail logs                              |

---

## 3. The Diagnostic CLI

### Install and run

No installation needed — requires Deno (already in the dev environment).

```bash
# Interactive mode (shows menu)
deno task diag

# CI mode (all probes, exit 0/1)
deno task diag:ci

# Target production URL explicitly
deno task diag:prod

# Single probe
deno run --allow-net --allow-env scripts/diag-cli.ts --probe probeResponseEncoding

# Custom URL + timeout
deno run --allow-net --allow-env scripts/diag-cli.ts \
  --url https://my-staging.workers.dev \
  --timeout 30000 \
  --ci
```

### Available probes

| Probe                   | What it checks                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| `probeHealth`           | `/api/health` — HTTP 200, valid JSON, DB status not down                 |
| `probeDbSmoke`          | `/api/health/db-smoke` — DB connectivity, returns `{ ok: true }`         |
| `probeMetrics`          | `/api/metrics` — responds within 5s                                      |
| `probeAuthProviders`    | `/api/auth/providers` — auth stack reachable                             |
| `probeCompileSmoke`     | `POST /api/compile` — compile pipeline reachable (200 or 422)            |
| `probeResponseEncoding` | `/api/health` with `Accept-Encoding: identity` — detects gzip corruption |

### Reading probe output

```
┌───────────────────────────┬──────────┬────────────┬───────────────────────────────────────────────┐
│ Probe                     │ Status   │ Latency    │ Detail                                        │
├───────────────────────────┼──────────┼────────────┼───────────────────────────────────────────────┤
│ probeHealth               │  ✅      │  342ms     │ status=healthy db=adblock-compiler            │
│ probeResponseEncoding     │  ❌      │  198ms     │ GZIP corruption detected!                     │
└───────────────────────────┴──────────┴────────────┴───────────────────────────────────────────────┘
```

- ✅ = probe passed
- ❌ = probe failed — check the **Detail** column for the error

---

## 4. Reading Tail Logs

```bash
# Stream live tail logs
deno task wrangler:tail

# Pretty format (easier to read)
deno run -A npm:wrangler tail --format=pretty
```

### Log pattern reference

| Log pattern                           | What it means                                   | What to do                                         |
| ------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `waitUntil() tasks did not complete`  | Background task timed out (analytics, DB write) | Check DB/KV connectivity; run `probeDbSmoke`       |
| `SyntaxError: Unexpected end of JSON` | Worker returned empty or truncated body         | Check for Worker hang before `return` statement    |
| `Worker exceeded CPU time limit`      | Handler ran too long                            | Check recent deploys for infinite loops; profile   |
| `AbortError`                          | Request aborted by `AbortController` timeout    | Expected for very slow DB queries — check timeouts |
| `better_auth_timeout`                 | Better Auth `/api/auth/get-session` timed out   | Check auth DB (Neon); see KB-005                   |
| `api_disabled`                        | User's API access revoked                       | Check user tier in D1 admin panel                  |
| `rate_limit_exceeded`                 | IP hit rate limit                               | Expected behavior; check if legitimate traffic     |
| `CORS_ORIGIN_BLOCKED`                 | Request from disallowed origin                  | Check CORS allowlist in `worker/utils/cors.ts`     |
| `turnstile_rejected`                  | Turnstile verification failed                   | Check Turnstile secret key binding                 |
| `cf_access_denied`                    | CF Access JWT verification failed               | Check CF Access application configuration          |

---

## 5. Database Connectivity

### Verify Hyperdrive → Neon connection

```bash
# Run the DB smoke probe
deno run --allow-net --allow-env scripts/diag-cli.ts --probe probeDbSmoke --ci

# Check Neon dashboard
# https://console.neon.tech/

# Check wrangler tail for DB errors
deno task wrangler:tail
```

### What `probeDbSmoke` checks

- Sends `GET /api/health/db-smoke`
- Expects `{ ok: true, db_name: "adblock-compiler", latency_ms: N }`
- Fails if: empty response, non-200, `ok !== true`, `db_name` mismatch, or timeout

### Common DB issues

| Symptom                        | Probable cause                       | Fix                                                         |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------------- |
| `db-smoke` hangs (timeout)     | Hyperdrive connection pool exhausted | Restart Hyperdrive; check Neon connection limits            |
| `db-smoke` returns `ok: false` | DB query failed                      | Check Neon logs for query errors                            |
| `db_name` mismatch             | Connected to wrong DB                | Verify `DATABASE_URL` binding in `wrangler.toml`            |
| High latency (> 2s)            | Neon cold start or slow query        | Expected on first request; watch for sustained high latency |

---

## 6. Auth Issues

### Symptom: Auth endpoints returning 500 or hanging

```bash
# Check auth providers endpoint
curl -v https://adblock-frontend.jk-com.workers.dev/api/auth/providers

# Check tail logs for better_auth_timeout
deno task wrangler:tail
```

### Better Auth timeout pattern

The `better_auth_timeout` security event is emitted when `/api/auth/get-session` exceeds its 10s timeout. This happens when:

1. The auth database (Neon) is cold-starting
2. The Hyperdrive connection pool is exhausted
3. A network partition between the Worker and Neon

**Fix:** Check Neon dashboard → Connection Monitor. If connections are maxed, scale up the connection pool limit or enable Hyperdrive connection pooling.

### Better Auth rate limiting

> **Note:** Better Auth silently skips rate limiting if `CF-Connecting-IP` is not configured. See KB-005.

Verify the auth config includes IP headers:

```typescript
// worker/lib/auth.ts
ipAddress: {
    ipAddressHeaders: ['CF-Connecting-IP', 'X-Forwarded-For'],
}
```

---

## 7. Deployment Checklist

After every production deploy, verify:

- [ ] `deno task diag:ci` exits with code 0
- [ ] `probeResponseEncoding` passes (no gzip corruption)
- [ ] `probeDbSmoke` returns `ok: true` within 3s
- [ ] `probeHealth` shows `status=healthy`
- [ ] Tail logs show no `waitUntil() tasks did not complete` warnings
- [ ] `probeMetrics` responds within 5s
- [ ] `probeAuthProviders` returns valid JSON

### Quick one-liner deploy verification

```bash
deno task wrangler:deploy && deno task diag:ci
```

---

## 8. Escalation Path

### When to escalate

Escalate to the engineering team if:

- `probeDbSmoke` fails for > 5 minutes after a Neon restart
- `probeHealth` shows `services.database.status === "down"` persistently
- Worker is returning 500s on all routes
- `wrangler tail` shows `Worker exceeded CPU time limit` on every request
- Auth is completely broken (all `/api/auth/*` routes return 5xx)

### What to collect before escalating

1. **Tail log output** — Run `deno task wrangler:tail` for 2 minutes and save the output
2. **Diagnostic probe results** — `deno task diag:ci 2>&1`
3. **Neon connection monitor** — Screenshot of connection graph
4. **Recent deployments** — List of commits/deploys in the last 24h
5. **wrangler.toml** — Verify `DATABASE_URL` and `HYPERDRIVE` bindings are correct

### Neon dashboard

- URL: https://console.neon.tech/
- Check: Connection Monitor, Query History, Active Connections

### Cloudflare dashboard

- Workers: https://dash.cloudflare.com/ → Workers & Pages
- Check: Worker metrics (CPU, errors, requests), Hyperdrive status

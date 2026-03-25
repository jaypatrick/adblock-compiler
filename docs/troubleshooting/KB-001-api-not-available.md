# KB-001 — "Getting API is not available" on the main page

**Series:** Adblock Compiler Operations & Troubleshooting KB  
**Component:** `worker/worker.ts` — Cloudflare Worker API entrypoint  
**Service URL:** `https://adblock-compiler.jayson-knight.workers.dev`  
**Date Created:** 2026-03-17  
**Status:** Active  

---

## Symptom

The Angular SPA home page shows **"Getting API is not available"** on initial load at `https://adblock-compiler.jayson-knight.workers.dev`.

API fetches from the frontend to `/api/version`, `/api/clerk-config`, `/api/turnstile-config`, or `/api/sentry-config` may be returning non-200 responses, causing the Angular app to render the error state.

---

## How the Home Page Gets API Availability

The Angular frontend bootstraps by calling a set of config/version endpoints. If any fail with an error status, a guard in the home component sets the "API not available" display state. The worker serves these at the following paths (all `GET`, public, no auth required):

| Endpoint | Purpose |
|---|---|
| `GET /api/version` | Returns compiler version and latest deployment record from D1 |
| `GET /api/clerk-config` | Returns Clerk publishable key (or `null`) |
| `GET /api/turnstile-config` | Returns Turnstile site key and enabled flag |
| `GET /api/sentry-config` | Returns Sentry DSN for frontend RUM |

All of these run **before** the ZTA auth chain (they are pre-auth handlers in `_handleRequest`). If they're failing, the cause is at the infrastructure layer, not the auth layer.

---

## Diagnostic Commands

Run these from any terminal. A healthy deployment returns `200` with a JSON body on all four.

```bash
# 1. Test root API info (bypasses HTML redirect)
curl -s "https://adblock-compiler.jayson-knight.workers.dev/api?format=json" | jq .

# 2. Test the version endpoint (hits D1)
curl -s "https://adblock-compiler.jayson-knight.workers.dev/api/version" | jq .

# 3. Test health (checks D1, KV, compiler binding, auth, gateway)
curl -s "https://adblock-compiler.jayson-knight.workers.dev/health" | jq .

# 4. Test metrics (hits KV METRICS namespace)
curl -s "https://adblock-compiler.jayson-knight.workers.dev/metrics" | jq .

# 5. Tail the live worker log
wrangler tail
```

---

## Root Cause Decision Tree

### ❶ Does `GET /health` return `"status": "healthy"`?

**If NO** — check the `services` object in the health response for the failing subsystem:

```json
{
  "status": "down",
  "services": {
    "database": { "status": "down" },
    "cache":    { "status": "healthy" },
    "auth":     { "status": "degraded", "provider": "none" },
    "compiler": { "status": "degraded" },
    "gateway":  { "status": "healthy" }
  }
}
```

| Failing service | Likely cause | Fix |
|---|---|---|
| `database: down` | D1 binding broken or migration pending | Re-deploy; run pending migrations |
| `auth: degraded, provider: none` | Neither `CLERK_JWKS_URL` nor `JWT_SECRET` is set | `wrangler secret put JWT_SECRET` |
| `compiler: degraded` | `ADBLOCK_COMPILER` Durable Object binding missing | Deploy tail worker first; re-deploy |
| `cache: down` | `COMPILATION_CACHE` KV namespace missing/unbound | Check KV namespace in Cloudflare dashboard |

---

### ❷ Does `GET /api/version` return `503`?

This endpoint calls `getLatestDeployment(env.DB)`. A 503 means `env.DB` is null — the `DB` D1 binding is missing from the deployed worker.

**Check:** `wrangler d1 list` — confirm `adblock-compiler-d1-database` exists and the ID matches `wrangler.toml`.

```bash
wrangler d1 list
# Should show: adblock-compiler-d1-database  3e8e7dfe-3213-452a-a671-6c18e6e74ce5
```

---

### ❸ Is CORS blocking the browser request?

The worker reads the `CORS_ALLOWED_ORIGINS` value at runtime. There are **two sources** for this value and they can conflict:

| Source | Value | Precedence |
|---|---|---|
| `wrangler.toml [vars]` | `"http://localhost:4200,...,https://adblock-compiler.jayson-knight.workers.dev"` | Lower |
| `wrangler secret put CORS_ALLOWED_ORIGINS` | Whatever was set when the command was last run | **Higher — overrides [vars]** |

**If a secret was previously set** with an outdated or incorrect value, it silently overrides the `[vars]` entry.

```bash
# Check which secrets exist
wrangler secret list

# If CORS_ALLOWED_ORIGINS is listed as a secret, re-set it:
wrangler secret put CORS_ALLOWED_ORIGINS
# Enter: http://localhost:4200,http://localhost:8787,https://adblock-compiler.jayson-knight.workers.dev
```

To verify, open Chrome DevTools → Network tab, look for the OPTIONS preflight or the failing GET, and check the `Access-Control-Allow-Origin` response header.

---

### ❹ Is the `adblock-compiler-tail` worker missing?

`wrangler.toml` declares:

```toml
[[tail_consumers]]
service = "adblock-compiler-tail"
```

If `adblock-compiler-tail` doesn't exist in your Cloudflare account, `wrangler deploy` **will fail silently** or deploy a broken worker. This is the most common cause of a "everything looks fine in code" deployment that still doesn't work.

```bash
# Deploy the tail worker first (from wrangler.tail.toml)
wrangler deploy --config wrangler.tail.toml

# Then re-deploy the main worker
wrangler deploy
```

---

### ❺ Does the Angular build exist in the ASSETS binding?

The `[assets]` binding points to `./frontend/dist/adblock-compiler/browser`. If the Angular build artifact is missing (e.g., the frontend CI step failed or was skipped), the worker deploys without static assets. The SPA shell won't serve, and the Angular app will never initialize.

```bash
# Trigger a fresh build manually
sh scripts/build-worker.sh

# Or re-run the full deploy (which runs the build script)
wrangler deploy
```

---

## Worker Code Reference

The relevant request routing lives in `_handleRequest` in `worker/worker.ts`:

- `GET /api` — `handleInfo()` — browser requests (Accept: text/html) redirect to `/api-docs`; API clients must send `Accept: application/json` or append `?format=json`
- `GET /api/version` — queries D1 via `getLatestDeployment(env.DB)`; returns 503 if `env.DB` is null
- `GET /api/clerk-config` — returns `CLERK_PUBLISHABLE_KEY` (or `null`); no auth, cached 1 hour
- `GET /api/turnstile-config` — returns `TURNSTILE_SITE_KEY` and enabled flag; no auth, cached 1 hour
- `GET /api/sentry-config` — returns Sentry DSN for frontend RUM; no auth
- `GET /health` — performs live probes of all bound services; returns granular per-service status

`handleInfo()` content negotiation detail:

```typescript
const wantsHtml = Boolean(env.ASSETS) && accept.includes('text/html') && searchParams.get('format') !== 'json';
if (wantsHtml) {
    return Response.redirect(new URL(API_DOCS_REDIRECT, request.url).toString(), 302);
}
```

Frontend API fetches **must** send `Accept: application/json` or omit the `Accept` header to avoid being redirected to `/api-docs`.

---

## ZTA Security Note

All four config endpoints are **intentionally pre-auth** — they expose no secrets, only public keys and feature flags. The Turnstile site key, Clerk publishable key, and Sentry DSN are all public values by design. If these endpoints are returning auth errors (`401`, `403`), something has changed in the auth chain that should not have touched these paths. File a separate bug.

---

## Resolution Summary

| Symptom | Root Cause | Fix |
|---|---|---|
| `"API not available"` on home page | D1 DB binding missing | `wrangler deploy` after confirming D1 namespace exists |
| `"API not available"` on home page | `CORS_ALLOWED_ORIGINS` secret overrides `[vars]` with stale value | `wrangler secret put CORS_ALLOWED_ORIGINS` |
| `"API not available"` on home page | `adblock-compiler-tail` service not deployed | Deploy tail worker, then re-deploy main worker |
| `"API not available"` on home page | Angular build missing from ASSETS | Run `sh scripts/build-worker.sh` and re-deploy |
| `GET /api/version` returns 503 | `DB` D1 binding null | Verify D1 database ID in `wrangler.toml` matches dashboard |
| `GET /health` shows `auth: degraded` | `CLERK_JWKS_URL` and `JWT_SECRET` both unset | Set `JWT_SECRET` secret or configure Clerk |

---

## Related KB Articles

- [KB-002](./KB-002-hyperdrive-database-down.md) — Hyperdrive binding connected but `database` service reports `down`
- *(planned)* KB-003 — Cloudflare Queue consumer not processing messages
- *(planned)* KB-004 — Angular SPA serves stale build after worker deploy

---

## Feedback & Contribution

If you discovered a new failure mode while using this article, please open an issue tagged `troubleshooting` and `documentation` in `jaypatrick/adblock-compiler` with the details so it can be captured in a follow-up KB entry.

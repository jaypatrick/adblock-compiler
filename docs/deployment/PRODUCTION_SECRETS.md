# Production Secrets & Environment Configuration

> **Adblock Compiler — Cloudflare Workers + Neon PostgreSQL + Better Auth**
>
> This document is the single source of truth for every secret, credential, and environment variable required to deploy and operate the adblock-compiler in production.

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Cloudflare Worker Secrets (REQUIRED before deploy)](#2-cloudflare-worker-secrets-required-before-deploy)
- [3. Cloudflare Hyperdrive Binding](#3-cloudflare-hyperdrive-binding)
- [4. GitHub Actions Secrets](#4-github-actions-secrets)
- [5. wrangler.toml \[vars\] (Non-Sensitive)](#5-wranglertoml-vars-non-sensitive)
- [6. Local Development Environment Files](#6-local-development-environment-files)
- [7. Secret Rotation Policy](#7-secret-rotation-policy)
- [8. Security Checklist (Pre-Deploy)](#8-security-checklist-pre-deploy)
- [9. Troubleshooting](#9-troubleshooting)

---

## 1. Overview

The adblock-compiler separates sensitive credentials from non-sensitive configuration across four distinct scopes:

```mermaid
flowchart TD
    subgraph Production["Production Environment"]
        WS["Cloudflare Worker Secrets\n(wrangler secret put)"]
        WV["wrangler.toml [vars]\n(committed — non-sensitive)"]
        HY["Hyperdrive Binding\n(wrangler.toml — connection ID only)"]
    end

    subgraph CI["CI/CD"]
        GH["GitHub Actions Secrets\n(Settings → Secrets)"]
    end

    subgraph Local["Local Development"]
        DV[".dev.vars\n(Worker runtime — gitignored)"]
        EL[".env.local\n(Prisma CLI / shell — gitignored)"]
        DC["Docker Compose\n(local PostgreSQL)"]
    end

    subgraph External["External Services"]
        NE["Neon PostgreSQL"]
        CL["Clerk (deprecated)"]
        CF["Cloudflare Dashboard"]
        SE["Sentry"]
    end

    WS -->|"runtime env"| Worker["Cloudflare Worker"]
    WV -->|"runtime env"| Worker
    HY -->|"connection pool"| NE
    GH -->|"CI env"| Actions["GitHub Actions"]
    Actions -->|"migrations"| NE
    DV -->|"wrangler dev"| LocalWorker["Local Worker"]
    EL -->|"prisma cli"| LocalDB["Local PostgreSQL"]
    DC -->|"docker compose"| LocalDB

    style WS fill:#dc2626,color:#fff,stroke:#991b1b
    style GH fill:#dc2626,color:#fff,stroke:#991b1b
    style DV fill:#f59e0b,color:#000,stroke:#d97706
    style EL fill:#f59e0b,color:#000,stroke:#d97706
    style WV fill:#22c55e,color:#000,stroke:#16a34a
    style HY fill:#22c55e,color:#000,stroke:#16a34a
```

**Key principles:**

- **Worker Secrets** (`wrangler secret put`) — encrypted at rest, injected at runtime, never visible in dashboards after creation. Used for all sensitive values.
- **wrangler.toml `[vars]`** — committed to source control. Only non-sensitive values (public keys, site keys, feature flags).
- **GitHub Actions Secrets** — encrypted repository secrets for CI/CD pipelines (migrations, deployments, Docker publishing).
- **Local env files** — `.dev.vars` (Worker runtime via `wrangler dev`) and `.env.local` (Prisma CLI, Deno tasks). Both are gitignored.

> ⚠️ **Zero Trust rule:** Secrets MUST NEVER appear in `wrangler.toml [vars]`, committed `.env` files, or CI workflow logs. Every secret is set via `wrangler secret put` or GitHub repository settings.

---

## 2. Cloudflare Worker Secrets (REQUIRED before deploy)

Every secret below **must** be set before the first production deployment. The Worker will fail to start or will reject requests if any required secret is missing.

### Core Authentication Secrets

| Secret | Command | Source | Required |
|--------|---------|--------|----------|
| `BETTER_AUTH_SECRET` | `wrangler secret put BETTER_AUTH_SECRET` | `openssl rand -base64 32` | ✅ Yes |
| `TURNSTILE_SECRET_KEY` | `wrangler secret put TURNSTILE_SECRET_KEY` | Cloudflare Dashboard → Turnstile → Site → Settings | ✅ Yes |
| `ADMIN_KEY` | `wrangler secret put ADMIN_KEY` | `openssl rand -base64 48` | ✅ Yes |

### Clerk Secrets (Transition Period)

| Secret | Command | Source | Required |
|--------|---------|--------|----------|
| `CLERK_SECRET_KEY` | `wrangler secret put CLERK_SECRET_KEY` | Clerk Dashboard → API Keys → Secret keys | ✅ Yes (until Clerk fully removed) |
| `CLERK_WEBHOOK_SECRET` | `wrangler secret put CLERK_WEBHOOK_SECRET` | Clerk Dashboard → Webhooks → Signing Secret | ✅ Yes (until Clerk fully removed) |

> **Note:** Clerk is deprecated and being replaced by Better Auth. Once the migration is complete, set `DISABLE_CLERK_FALLBACK=true` in `[vars]` and remove Clerk secrets.

### Cloudflare Access Secrets

| Secret | Command | Source | Required |
|--------|---------|--------|----------|
| `CF_ACCESS_AUD` | `wrangler secret put CF_ACCESS_AUD` | Cloudflare Zero Trust → Access → Applications → Application Audience (AUD) Tag | ✅ Yes (if CF Access protects `/admin/*`) |
| `CF_ACCESS_CLIENT_ID` | `wrangler secret put CF_ACCESS_CLIENT_ID` | Cloudflare Zero Trust → Access → Service Tokens | ⚠️ Conditional |
| `CF_ACCESS_CLIENT_SECRET` | `wrangler secret put CF_ACCESS_CLIENT_SECRET` | Cloudflare Zero Trust → Access → Service Tokens | ⚠️ Conditional |

### CORS Configuration

| Secret | Command | Source | Required |
|--------|---------|--------|----------|
| `CORS_ALLOWED_ORIGINS` | `wrangler secret put CORS_ALLOWED_ORIGINS` | Comma-separated origin allowlist | ✅ Yes |

> **Why is CORS a secret?** The production origin allowlist may include internal domains that should not be committed to source control. In development, set this in `.dev.vars` instead.

### Observability Secrets

| Secret | Command | Source | Required |
|--------|---------|--------|----------|
| `SENTRY_DSN` | `wrangler secret put SENTRY_DSN` | Sentry → Project Settings → Client Keys (DSN) | ⚠️ Recommended |
| `ANALYTICS_ACCOUNT_ID` | `wrangler secret put ANALYTICS_ACCOUNT_ID` | Cloudflare Dashboard → Account ID | ⚠️ Recommended |
| `ANALYTICS_API_TOKEN` | `wrangler secret put ANALYTICS_API_TOKEN` | Cloudflare Dashboard → API Tokens | ⚠️ Recommended |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `wrangler secret put OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint URL | ❌ Optional |

### Integration Secrets

| Secret | Command | Source | Required |
|--------|---------|--------|----------|
| `CONTAINER_SECRET` | `wrangler secret put CONTAINER_SECRET` | Shared secret for container service auth | ⚠️ If using containers |
| `WEBHOOK_URL` | `wrangler secret put WEBHOOK_URL` | External webhook endpoint | ❌ Optional |
| `DATADOG_API_KEY` | `wrangler secret put DATADOG_API_KEY` | Datadog → Organization Settings → API Keys | ❌ Optional |
| `NEON_API_KEY` | `wrangler secret put NEON_API_KEY` | Neon Console → Account Settings → API Keys | ❌ Optional (runtime admin) |

### Bulk Setup Script

```bash
#!/usr/bin/env bash
# deploy-secrets.sh — Run once before first production deploy
# ⚠️ DO NOT commit this script with values filled in

set -euo pipefail

echo "Setting Cloudflare Worker secrets for adblock-compiler..."

# Core auth
echo "<value>" | wrangler secret put BETTER_AUTH_SECRET
echo "<value>" | wrangler secret put TURNSTILE_SECRET_KEY
echo "<value>" | wrangler secret put ADMIN_KEY

# Clerk (transition period)
echo "<value>" | wrangler secret put CLERK_SECRET_KEY
echo "<value>" | wrangler secret put CLERK_WEBHOOK_SECRET

# Cloudflare Access
echo "<value>" | wrangler secret put CF_ACCESS_AUD

# CORS
echo "https://your-domain.com,https://app.your-domain.com" | wrangler secret put CORS_ALLOWED_ORIGINS

# Observability
echo "<value>" | wrangler secret put SENTRY_DSN

echo "✅ All secrets set. Deploy with: wrangler deploy"
```

---

## 3. Cloudflare Hyperdrive Binding

Hyperdrive accelerates PostgreSQL connections by pooling and caching at the Cloudflare edge. It is configured as a **binding** in `wrangler.toml`, not as a secret.

### Production Configuration (wrangler.toml)

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "800f7e2edc86488ab24e8621982e9ad7"
```

### How It Works

```mermaid
sequenceDiagram
    participant Client
    participant Worker as Cloudflare Worker
    participant HD as Hyperdrive<br/>(Connection Pool)
    participant Neon as Neon PostgreSQL<br/>(Pooler Endpoint)

    Client->>Worker: POST /compile
    Worker->>Worker: Authenticate request
    Worker->>HD: SQL query via env.HYPERDRIVE
    HD->>HD: Check connection pool
    alt Connection available
        HD->>Neon: Reuse pooled connection
    else No connection
        HD->>Neon: Establish new connection<br/>(via Neon pooler endpoint)
    end
    Neon-->>HD: Query result
    HD-->>Worker: Result
    Worker-->>Client: 200 OK
```

### Connection String Architecture

| Endpoint | Format | Used By |
|----------|--------|---------|
| **Neon Pooler** (port 5432) | `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require` | Hyperdrive binding (production Worker runtime) |
| **Neon Direct** (port 5432, no `-pooler`) | `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require` | Prisma migrations only (`DIRECT_DATABASE_URL`) |

> ⚠️ **Hyperdrive MUST point to the Neon pooler endpoint** (hostname contains `-pooler`). The direct endpoint bypasses connection pooling and will exhaust Neon's connection limit under load.

### Local Development Hyperdrive

In local development, `wrangler dev` cannot use the real Hyperdrive binding. Instead, set a local connection string in `.dev.vars`:

```ini
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = "postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev"
```

---

## 4. GitHub Actions Secrets

These secrets are configured in **GitHub → Repository Settings → Secrets and variables → Actions**.

### Required Secrets

| Secret | Source | Used By |
|--------|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → API Tokens (use `Edit Cloudflare Workers` template) | `wrangler deploy`, migrations, workflow dispatches |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → Overview → Account ID | All Cloudflare API calls |
| `DIRECT_DATABASE_URL` | Neon Console → Connection Details → Direct (non-pooler) connection string | `db-migrate.yml` — Prisma migrations |
| `NEON_API_KEY` | Neon Console → Account Settings → API Keys | `neon-branch-*.yml` — branch creation/deletion |
| `NEON_PROJECT_ID` | `twilight-river-73901472` | Neon branch workflows |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens | `sentry-sourcemaps.yml` — source map uploads |
| `DOCKERHUB_USERNAME` | Docker Hub account username | `docker-publish.yml` |
| `DOCKERHUB_TOKEN` | Docker Hub → Account Settings → Security → Access Tokens | `docker-publish.yml` |

### Optional / Feature-Specific Secrets

| Secret | Source | Used By |
|--------|--------|---------|
| `CF_WEB_ANALYTICS_TOKEN` | Cloudflare Dashboard → Web Analytics | `lighthouse.yml` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Anthropic / Claude integration | `claude.yml` — AI-assisted workflows |

### Automatically Provided

| Secret | Source | Notes |
|--------|--------|-------|
| `GITHUB_TOKEN` | GitHub Actions (automatic) | Scoped to the repository; used for PR comments, artifact uploads, etc. |

### Setting Secrets via GitHub CLI

```bash
# Bulk-set required secrets
gh secret set CLOUDFLARE_API_TOKEN --body "<token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account-id>"
gh secret set DIRECT_DATABASE_URL --body "postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
gh secret set NEON_API_KEY --body "<neon-api-key>"
gh secret set NEON_PROJECT_ID --body "twilight-river-73901472"
gh secret set SENTRY_AUTH_TOKEN --body "<sentry-token>"
gh secret set DOCKERHUB_USERNAME --body "<username>"
gh secret set DOCKERHUB_TOKEN --body "<token>"
```

---

## 5. wrangler.toml [vars] (Non-Sensitive)

These values are committed to source control in `wrangler.toml` under the `[vars]` block. They contain **no secrets** — only public keys, feature flags, and configuration.

```toml
[vars]
COMPILER_VERSION = "0.71.0"
ENVIRONMENT = "production"
TURNSTILE_SITE_KEY = "0x4AAAAAACMKiPZdJh8I8IEM"
```

### Additional Non-Sensitive Variables

These may be set in `[vars]` or as Worker secrets depending on your security posture:

| Variable | Example Value | Notes |
|----------|---------------|-------|
| `COMPILER_VERSION` | `"0.71.0"` | Adblock compiler version string |
| `ENVIRONMENT` | `"production"` | Runtime environment identifier |
| `TURNSTILE_SITE_KEY` | `"0x4AAAAAACMKiPZdJh8I8IEM"` | Public Turnstile site key (safe to commit) |
| `BETTER_AUTH_URL` | `"https://your-domain.com"` | Public URL for Better Auth callbacks |
| `CLERK_PUBLISHABLE_KEY` | `"pk_live_..."` | Clerk public key (safe to commit) |
| `CLERK_JWKS_URL` | `"https://your-clerk.clerk.accounts.dev/.well-known/jwks.json"` | Public JWKS endpoint |
| `MAX_REQUEST_BODY_MB` | `"10"` | Request body size limit |
| `ERROR_REPORTER_TYPE` | `"composite"` | Error reporting backend |
| `DISABLE_CLERK_FALLBACK` | `"true"` | Disable Clerk JWT fallback |

> ⚠️ **Never put these in `[vars]`:** `BETTER_AUTH_SECRET`, `CLERK_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `ADMIN_KEY`, `SENTRY_DSN`, `CORS_ALLOWED_ORIGINS`, database credentials, or any API token.

---

## 6. Local Development Environment Files

Local development uses two separate env files to mirror the production split between Worker runtime and shell tooling.

```mermaid
flowchart LR
    subgraph Templates["Templates (committed)"]
        A[".env.example"]
        B[".dev.vars.example"]
    end

    subgraph Local["Local Files (gitignored)"]
        C[".env.local"]
        D[".dev.vars"]
    end

    subgraph Consumers["Consumers"]
        E["Prisma CLI\nDeno Tasks\nShell Scripts"]
        F["wrangler dev\n(Worker runtime)"]
        G["Docker Compose\n(PostgreSQL)"]
    end

    A -->|"cp"| C
    B -->|"cp"| D
    C --> E
    D --> F
    G -->|"hardcoded in\ndocker-compose.yml"| E

    style C fill:#f59e0b,color:#000
    style D fill:#f59e0b,color:#000
```

### Quick Start

```bash
# 1. Copy templates
cp .env.example .env.local
cp .dev.vars.example .dev.vars

# 2. Edit both files with your local values
#    .env.local   → DATABASE_URL, DIRECT_DATABASE_URL, NEON_* (if using Neon)
#    .dev.vars    → BETTER_AUTH_SECRET, TURNSTILE keys (use test keys), CORS_ALLOWED_ORIGINS

# 3. Start local PostgreSQL
deno task db:local:up

# 4. Run Prisma migrations against local DB
deno task db:local:push

# 5. Start the Worker in dev mode
deno task dev
```

### .env.local — Shell Tooling

Used by Prisma CLI, Deno tasks, and any script that runs **outside** the Worker runtime.

```ini
# Database (local Docker PostgreSQL)
DATABASE_URL="postgresql://adblock:localdev@localhost:5432/adblock_dev"
DIRECT_DATABASE_URL="postgresql://adblock:localdev@localhost:5432/adblock_dev"

# Neon (optional — for testing against remote DB)
# NEON_API_KEY="your-neon-api-key"
# NEON_PROJECT_ID="twilight-river-73901472"
# NEON_DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"

# Cloudflare API (optional — for scripts that call CF API)
# CLOUDFLARE_API_TOKEN="your-api-token"
# CLOUDFLARE_ACCOUNT_ID="your-account-id"
```

### .dev.vars — Worker Runtime

Used by `wrangler dev` to inject environment bindings into the local Worker.

```ini
# Better Auth (primary auth)
BETTER_AUTH_SECRET="local-dev-secret-change-in-production"
BETTER_AUTH_URL="http://localhost:8787"

# Turnstile (use Cloudflare test keys for local dev)
TURNSTILE_SITE_KEY="1x00000000000000000000AA"
TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"

# CORS
CORS_ALLOWED_ORIGINS="http://localhost:4200,http://localhost:8787"

# Hyperdrive local replacement
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev"

# Clerk (deprecated — use test keys or disable)
CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
DISABLE_CLERK_FALLBACK="true"
```

### Docker Compose

The `docker-compose.yml` provides a local PostgreSQL instance with hardcoded development credentials:

| Variable | Value | Service |
|----------|-------|---------|
| `POSTGRES_DB` | `adblock_dev` | `postgres` |
| `POSTGRES_USER` | `adblock` | `postgres` |
| `POSTGRES_PASSWORD` | `localdev` | `postgres` |
| `DATABASE_URL` | `postgresql://adblock:localdev@postgres:5432/adblock_dev` | `db-migrate` |

> These are **local development only** credentials. They never leave your machine.

---

## 7. Secret Rotation Policy

### Rotation Schedule

| Secret | Rotation Interval | Impact of Rotation | Procedure |
|--------|-------------------|-------------------|-----------|
| `BETTER_AUTH_SECRET` | Every 90 days | All active sessions invalidated; users must re-authenticate | See [Rotating BETTER_AUTH_SECRET](#rotating-better_auth_secret) |
| `ADMIN_KEY` | Every 90 days | All admin scripts using the old key will fail | See [Rotating ADMIN_KEY](#rotating-admin_key) |
| `TURNSTILE_SECRET_KEY` | On compromise only | Turnstile verification fails until frontend is updated (if site key changes) | See [Rotating Turnstile Keys](#rotating-turnstile-keys) |
| `CLERK_SECRET_KEY` | On compromise only | Clerk webhook verification fails; JWT validation fails | See [Rotating Clerk Keys](#rotating-clerk-keys) |
| `CF_ACCESS_AUD` | On application recreation only | CF Access tokens rejected until new AUD is deployed | Redeploy with new AUD |
| Neon DB credentials | Managed by Neon | Hyperdrive connection string must be updated | Rotate via Neon Dashboard → Project Settings → Reset Password |
| `SENTRY_DSN` | On compromise only | Error reporting interrupted during transition | Update secret and redeploy |

### Rotating BETTER_AUTH_SECRET

```bash
# 1. Generate a new secret
NEW_SECRET=$(openssl rand -base64 32)

# 2. Set the new secret (Worker will pick it up on next request)
echo "$NEW_SECRET" | wrangler secret put BETTER_AUTH_SECRET

# 3. Trigger a deployment to ensure all edge instances reload
wrangler deploy

# 4. Verify — all existing sessions will require re-authentication
curl -s https://your-domain.com/auth/session \
  -H "Cookie: better-auth.session_token=old-token" \
  | jq .error
# Expected: session invalid or unauthorized
```

> ⚠️ **Session impact:** Rotating `BETTER_AUTH_SECRET` invalidates **all** active sessions. Plan rotations during low-traffic windows and notify users if applicable.

### Rotating ADMIN_KEY

```bash
# 1. Generate a new key
NEW_KEY=$(openssl rand -base64 48)

# 2. Set the new key
echo "$NEW_KEY" | wrangler secret put ADMIN_KEY

# 3. Redeploy
wrangler deploy

# 4. Update all admin scripts and CI jobs that use the old key

# 5. Verify
curl -s https://your-domain.com/admin/health \
  -H "X-Admin-Key: $NEW_KEY" \
  | jq .status
# Expected: "ok"
```

### Rotating Turnstile Keys

```bash
# 1. Go to Cloudflare Dashboard → Turnstile → Site → Settings
# 2. Regenerate the secret key (site key may remain unchanged)

# 3. Set the new secret
echo "<new-secret>" | wrangler secret put TURNSTILE_SECRET_KEY

# 4. If the SITE KEY also changed, update wrangler.toml [vars]
#    TURNSTILE_SITE_KEY = "<new-site-key>"

# 5. Redeploy
wrangler deploy

# 6. If site key changed, also update the Angular frontend and redeploy it
```

### Rotating Clerk Keys

```bash
# 1. Go to Clerk Dashboard → API Keys → Roll Key
# 2. Clerk provides a grace period where both old and new keys work

# 3. Set the new secret
echo "<new-secret>" | wrangler secret put CLERK_SECRET_KEY

# 4. If webhook secret changed:
echo "<new-webhook-secret>" | wrangler secret put CLERK_WEBHOOK_SECRET

# 5. Redeploy
wrangler deploy
```

### Rotating Neon Database Credentials

```bash
# 1. Go to Neon Console → Project → Settings → Reset Password
# 2. Copy the new connection string

# 3. Update Hyperdrive configuration
wrangler hyperdrive update 800f7e2edc86488ab24e8621982e9ad7 \
  --origin-url "postgresql://user:NEW_PASS@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"

# 4. Update GitHub Actions secret for migrations
gh secret set DIRECT_DATABASE_URL \
  --body "postgresql://user:NEW_PASS@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# 5. Redeploy Worker to pick up Hyperdrive changes
wrangler deploy
```

---

## 8. Security Checklist (Pre-Deploy)

Complete this checklist before every production deployment:

### Worker Secrets

- [ ] All required Worker secrets set via `wrangler secret put` (see [Section 2](#2-cloudflare-worker-secrets-required-before-deploy))
- [ ] No secrets present in `wrangler.toml [vars]` block
- [ ] `BETTER_AUTH_SECRET` is at least 32 characters of cryptographic randomness
- [ ] `ADMIN_KEY` is at least 48 characters of cryptographic randomness

### Database & Hyperdrive

- [ ] Hyperdrive connection string points to **Neon pooler** endpoint (hostname contains `-pooler`)
- [ ] `DIRECT_DATABASE_URL` (GitHub Actions) uses Neon **direct** endpoint (for migrations only)
- [ ] All D1 queries use parameterized statements (`.prepare().bind()`)
- [ ] No raw SQL string interpolation anywhere in `worker/` code

### Authentication & Authorization

- [ ] Better Auth cookie security: `httpOnly: true`, `secure: true`, `sameSite: "lax"`
- [ ] Turnstile verification enabled on all write endpoints (`/compile*`, `/validate`, `/ast/parse`)
- [ ] Rate limiting configured per auth tier (anonymous, free, pro, admin)
- [ ] Auth chain verified: API Key → Better Auth → Clerk JWT → Anonymous
- [ ] Admin routes (`/admin/*`) protected by CF Access and/or admin role middleware

### Network & CORS

- [ ] `CORS_ALLOWED_ORIGINS` uses an explicit origin allowlist (not `*`)
- [ ] No `Access-Control-Allow-Origin: *` on authenticated or write endpoints
- [ ] SSRF protection active on `/proxy/fetch` (blocks RFC 1918, localhost, `169.254.169.254`)

### CI/CD

- [ ] All GitHub Actions secrets configured (see [Section 4](#4-github-actions-secrets))
- [ ] CI pipeline passes: lint, typecheck, unit tests, integration tests
- [ ] Sentry source maps uploaded on deploy

### Observability

- [ ] Security events emitted to Analytics Engine on auth failures via `AnalyticsService.trackSecurityEvent()`
- [ ] Sentry DSN configured for error tracking
- [ ] Health monitoring workflow active

---

## 9. Troubleshooting

### `AUTH_SECRET_MISSING` / `BETTER_AUTH_SECRET is not configured`

**Cause:** The `BETTER_AUTH_SECRET` Worker secret is not set or the Worker hasn't been redeployed since it was set.

```bash
# Verify the secret exists (shows last 4 characters)
wrangler secret list

# Re-set if missing
openssl rand -base64 32 | wrangler secret put BETTER_AUTH_SECRET

# Redeploy
wrangler deploy
```

### `HYPERDRIVE connection failed` / `Connection refused`

**Cause:** Hyperdrive cannot reach the Neon PostgreSQL endpoint.

```bash
# 1. Verify Hyperdrive config
wrangler hyperdrive get 800f7e2edc86488ab24e8621982e9ad7

# 2. Check that the origin URL uses the POOLER endpoint
#    ✅ ep-xxx-pooler.region.aws.neon.tech
#    ❌ ep-xxx.region.aws.neon.tech (direct — will exhaust connections)

# 3. Test Neon connectivity directly
psql "postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require" \
  -c "SELECT 1"

# 4. If Neon password expired, rotate credentials (see Section 7)
```

### `Neon password expired` / `authentication failed`

**Cause:** Neon auto-expires credentials after the project's configured password lifetime.

```bash
# 1. Go to Neon Console → Project → Settings → Reset Password
# 2. Update Hyperdrive with the new connection string
wrangler hyperdrive update 800f7e2edc86488ab24e8621982e9ad7 \
  --origin-url "postgresql://user:NEW_PASS@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"

# 3. Update GitHub Actions migration secret
gh secret set DIRECT_DATABASE_URL \
  --body "postgresql://user:NEW_PASS@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# 4. Redeploy
wrangler deploy
```

### `Turnstile verification failed` / `invalid-input-response`

**Cause:** The Turnstile secret key doesn't match the site key, or the token has expired.

```bash
# 1. Verify site key in wrangler.toml matches the Cloudflare Dashboard
grep TURNSTILE_SITE_KEY wrangler.toml

# 2. Verify secret key is set
wrangler secret list | grep TURNSTILE

# 3. Test with Cloudflare's always-pass test keys (local dev only):
#    Site key:   1x00000000000000000000AA
#    Secret key: 1x0000000000000000000000000000000AA
```

### `CORS error: Origin not allowed`

**Cause:** The request origin is not in the `CORS_ALLOWED_ORIGINS` allowlist.

```bash
# 1. Check what origins are currently allowed
#    (Secret — can't view directly; re-set with the correct list)

# 2. Re-set with updated origin list
echo "https://your-domain.com,https://app.your-domain.com" | \
  wrangler secret put CORS_ALLOWED_ORIGINS

# 3. Redeploy
wrangler deploy
```

### `CF Access: 403 Forbidden` on `/admin/*`

**Cause:** The Cloudflare Access JWT is missing, expired, or the `CF_ACCESS_AUD` secret doesn't match.

```bash
# 1. Verify CF Access is configured for the route
#    Cloudflare Zero Trust → Access → Applications

# 2. Verify the AUD tag matches
wrangler secret list | grep CF_ACCESS

# 3. Re-set if needed
echo "<aud-tag-from-dashboard>" | wrangler secret put CF_ACCESS_AUD

# 4. Ensure your browser has a valid CF Access cookie
#    Visit the Access-protected URL directly to trigger the auth flow
```

### `Clerk JWT verification failed` (deprecated)

**Cause:** Clerk JWKS endpoint unreachable or secret key mismatch.

```bash
# 1. If Clerk is disabled, verify the flag:
grep DISABLE_CLERK_FALLBACK wrangler.toml
# Should be: DISABLE_CLERK_FALLBACK = "true"

# 2. If Clerk is still active, verify the JWKS URL is reachable:
curl -s "https://your-clerk.clerk.accounts.dev/.well-known/jwks.json" | jq .keys

# 3. Re-set the secret if needed
echo "<clerk-secret>" | wrangler secret put CLERK_SECRET_KEY
```

### GitHub Actions: `Migration failed`

**Cause:** The `DIRECT_DATABASE_URL` secret is incorrect, expired, or uses the pooler endpoint.

```bash
# 1. Verify the secret uses the DIRECT (non-pooler) endpoint:
#    ✅ ep-xxx.region.aws.neon.tech (direct)
#    ❌ ep-xxx-pooler.region.aws.neon.tech (pooler — breaks migrations)

# 2. Test the connection locally:
psql "$DIRECT_DATABASE_URL" -c "SELECT 1"

# 3. Re-set in GitHub Actions:
gh secret set DIRECT_DATABASE_URL \
  --body "postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

### Local Development: `wrangler dev` can't connect to PostgreSQL

**Cause:** Docker PostgreSQL isn't running, or `.dev.vars` has the wrong connection string.

```bash
# 1. Start local PostgreSQL
deno task db:local:up

# 2. Verify it's running
docker compose ps | grep postgres

# 3. Verify .dev.vars connection string
grep HYPERDRIVE .dev.vars
# Should be: CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev"

# 4. Test the connection
psql "postgresql://adblock:localdev@127.0.0.1:5432/adblock_dev" -c "SELECT 1"
```

---

> **Last updated:** 2025 · **Maintainer:** adblock-compiler team
>
> This document is part of the [Zero Trust Architecture](../../SECURITY.md) compliance requirements. Every secret and credential listed here must follow the ZTA principles defined in the project's security policy.

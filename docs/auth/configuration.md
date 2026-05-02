# Authentication Configuration Guide

Complete reference for all environment variables and configuration needed to run the
adblock-compiler authentication system with Better Auth.

---

## Environment Variables

### Better Auth

#### Required

| Variable | Required | Source | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | **Yes** | `openssl rand -base64 32` | HMAC signing key for session tokens. Must be ≥ 32 characters. Never reuse across environments. Changing this invalidates all active sessions. |
| `BETTER_AUTH_URL` | **Yes** | Your Worker's public URL | Base URL for OAuth callbacks and email links. Example: `https://your-worker.workers.dev` |

#### Optional

| Variable | Required | Source | Description |
|---|---|---|---|
| `BETTER_AUTH_API_KEY` | Optional | `dash.better-auth.com` | API key for Better Auth Dash dashboard integration. Enables `dash()` and `sentinel()` connectivity. **Must be passed explicitly** via `apiKey: env.BETTER_AUTH_API_KEY` — Cloudflare Workers do not expose Worker Secrets via `process.env`. Production: `wrangler secret put BETTER_AUTH_API_KEY` |
| `BETTER_AUTH_KV_URL` | Optional | Cloudflare KV REST API URL | REST API URL for the `BETTER_AUTH_KV` namespace. Used by `dash()` and `sentinel()` `kvUrl` option. Construct from: `https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/storage/kv/namespaces/<BETTER_AUTH_KV_ID>`. Production: `wrangler secret put BETTER_AUTH_KV_URL` |

### Database (Required)

| Variable | Required | Source | Description |
|---|---|---|---|
| `HYPERDRIVE` | **Yes** | `wrangler.toml` Hyperdrive binding | Cloudflare Hyperdrive binding that proxies connections to Neon PostgreSQL. The Worker connects via `env.HYPERDRIVE.connectionString`. |
| `DIRECT_DATABASE_URL` | Dev/CI only | Neon connection string | Direct PostgreSQL URL for Prisma CLI migrations (`prisma migrate dev/deploy`). **Never read by the Worker at runtime.** |

### Social OAuth Providers (Optional)

| Variable | Required | Source | Description |
|---|---|---|---|
| `GITHUB_CLIENT_ID` | Optional | GitHub → Settings → Developer Settings → OAuth Apps | Client ID for GitHub sign-in. GitHub is enabled only when **both** `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set. |
| `GITHUB_CLIENT_SECRET` | Optional | GitHub OAuth App settings | Client secret for GitHub sign-in. |
| `GOOGLE_CLIENT_ID` | Optional | Google Cloud Console → Credentials | Client ID for Google sign-in (reserved — enable by uncommenting in `auth.ts`). |
| `GOOGLE_CLIENT_SECRET` | Optional | Google Cloud Console → Credentials | Client secret for Google sign-in. |

### Cloudflare Turnstile (Optional — Bot Protection)

| Variable | Required | Source | Description |
|---|---|---|---|
| `TURNSTILE_SITE_KEY` | Optional | Cloudflare Dashboard → Turnstile | Public site key for the frontend widget. Returned via `GET /api/turnstile-config`. |
| `TURNSTILE_SECRET_KEY` | Optional | Cloudflare Dashboard → Turnstile | Server-side verification key. Turnstile is disabled when not set. |

### Cloudflare Access (Optional — Defense-in-Depth)

| Variable | Required | Source | Description |
|---|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | Optional | Cloudflare Zero Trust Dashboard | Your Access team domain (e.g., `mycompany`). CF Access checks are skipped when not set. |
| `CF_ACCESS_AUD` | Optional | CF Access → Applications → AUD Tag | Audience claim for CF Access JWT verification. Required if `CF_ACCESS_TEAM_DOMAIN` is set. |

### Other Runtime Variables

| Variable | Required | Source | Description |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated URLs | Allowed CORS origins. Example: `https://app.example.com,https://admin.example.com` |
| `ENVIRONMENT` | Optional | `wrangler.toml` or `.dev.vars` | `development`, `staging`, or `production`. Used for log level and error detail. |

---

## Local Development Setup

### Quick Start

```bash
# 1. Create a personal dev branch in the Neon Console (one-time)
#    https://console.neon.tech → adblock-compiler project → Branches → New Branch

# 2. Copy the example file
cp .dev.vars.example .dev.vars

# 3. Fill in your Neon branch connection string (see template below)
# 4. Start the Worker
wrangler dev
```

### `.dev.vars` Template

```ini
# .dev.vars — NOT committed to git
# Loaded by wrangler dev. Overrides values in wrangler.toml [vars].

ENVIRONMENT=development

# ─── Better Auth ──────────────────────────────────────────────────────────────
# Generate: openssl rand -base64 32
BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32-output
BETTER_AUTH_URL=http://localhost:8787

# ─── Database ─────────────────────────────────────────────────────────────────
# Point wrangler dev at your personal Neon development branch.
# Create a branch at https://console.neon.tech → your project → Branches → New Branch.
# Use the "Direct connection" string (not pooled). See: https://neon.com/guides/local-development-with-neon
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://<user>:<password>@<branch-host>.neon.tech/<dbname>?sslmode=require

# ─── Social OAuth (optional) ──────────────────────────────────────────────────
# GITHUB_CLIENT_ID=your-github-client-id
# GITHUB_CLIENT_SECRET=your-github-client-secret
# GOOGLE_CLIENT_ID=your-google-client-id       # reserved
# GOOGLE_CLIENT_SECRET=your-google-client-secret

# ─── Turnstile (use Cloudflare test keys locally) ─────────────────────────────
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

# ─── CORS ─────────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS=http://localhost:4200,http://localhost:8787
```

### Local Database

The project uses **Neon branching** for local development — no Docker PostgreSQL needed.
Each developer has a personal, isolated Neon branch that can be reset or deleted freely.

```bash
# Apply pending migrations to your Neon branch
deno task db:migrate

# Generate Prisma client
deno task db:generate

# Start the Worker (uses .dev.vars for DB connection)
wrangler dev
```

See [Local Development Setup](../database-setup/local-dev.md) for full Neon branching instructions.

---

## Wrangler Bindings (`wrangler.toml`)

The Worker's database connection uses a Cloudflare Hyperdrive binding — not a plain
connection string. The binding is declared in `wrangler.toml`:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id      = "800f7e2edc86488ab24e8621982e9ad7"
```

During `wrangler dev`, add this to `.dev.vars` to override with your Neon dev branch:

```ini
# Use your personal Neon dev branch (direct connection, not pooled)
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://<user>:<password>@<branch-host>.neon.tech/<dbname>?sslmode=require
```

### KV Namespaces

| Binding | Purpose |
|---------|---------|
| `COMPILATION_CACHE` | Compiled adblock filter list cache |
| `RATE_LIMIT` | Rate-limit counters |
| `METRICS` | Worker metrics |
| `FEATURE_FLAGS` | Runtime feature flag store |
| `BETTER_AUTH_KV` | Better Auth secondary storage — sessions, rate-limit counters, verification tokens. Create: `wrangler kv:namespace create BETTER_AUTH_KV` |

For full Hyperdrive setup, see [Better Auth Prisma Setup](better-auth-prisma.md).

---

## Production Deployment

### Non-Secrets in `wrangler.toml [vars]`

Static, non-sensitive values that are safe to commit:

```toml
[vars]
COMPILER_VERSION = "0.62.5"
ENVIRONMENT      = "production"
BETTER_AUTH_URL  = "https://your-worker.workers.dev"
TURNSTILE_SITE_KEY = "0x4AAA..."   # public site key — not a secret
```

### Secrets via `wrangler secret put`

**Never** commit secrets to `wrangler.toml` or any `.env.*` file:

```bash
# Better Auth — required
wrangler secret put BETTER_AUTH_SECRET

# Better Auth Dash / sentinel — optional (auditLogs pending upstream)
wrangler secret put BETTER_AUTH_API_KEY
wrangler secret put BETTER_AUTH_KV_URL

# Social OAuth — if using GitHub
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# Social OAuth — if using Google
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Turnstile
wrangler secret put TURNSTILE_SECRET_KEY

# CORS
wrangler secret put CORS_ALLOWED_ORIGINS

# CF Access (optional)
wrangler secret put CF_ACCESS_TEAM_DOMAIN
wrangler secret put CF_ACCESS_AUD
```

---

## Database Schema

Better Auth uses Neon PostgreSQL (accessed via Cloudflare Hyperdrive) with Prisma as the ORM.
The schema is in `prisma/schema.prisma`.

### Better Auth Core Tables

| Table | Contents |
|-------|----------|
| `user` | User accounts — `id`, `name`, `email`, `tier`, `role`, `banned`, `emailVerified` |
| `session` | Active sessions — `id`, `userId`, `token` (hashed), `expiresAt`, `ipAddress`, `userAgent` |
| `account` | OAuth provider links — `userId`, `providerId`, `providerAccountId`, `accessToken` |
| `verification` | Email verification and password-reset tokens |
| `twoFactor` | TOTP secrets per user (added by `twoFactor()` plugin) |

### Custom User Fields

Two custom fields are added to the `user` table via `additionalFields` in `auth.ts`:

| Field | Type | Default | `input` | Description |
|-------|------|---------|---------|-------------|
| `tier` | `string` | `free` | `false` | Determines rate limits and feature access. Not user-settable. |
| `role` | `string` | `user` | `false` | `user` or `admin`. Not user-settable. |

`input: false` means the field is excluded from sign-up/sign-in body parsing — only server-side
code (migrations, admin endpoints) can write these fields.

### Running Migrations

```bash
# Development — creates migration file + applies to local DB
deno task db:migrate

# Production / CI — applies pending migrations without prompting
deno task db:migrate:deploy

# Regenerate Prisma client after schema changes
deno task db:generate
```

---

## Authentication Endpoints

All auth routes are under `/api/auth/*` (configured by `basePath: '/api/auth'` in `auth.ts`).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/sign-up/email` | POST | Register with email + password |
| `/api/auth/sign-in/email` | POST | Sign in with email + password |
| `/api/auth/sign-out` | POST | Sign out (clears session) |
| `/api/auth/sign-in/social?provider=github` | GET | Initiate GitHub OAuth flow |
| `/api/auth/callback/github` | GET | GitHub OAuth callback (automatic) |
| `/api/auth/forget-password` | POST | Request password-reset email |
| `/api/auth/reset-password` | POST | Submit new password with reset token |
| `/api/auth/two-factor/enable` | POST | Enable TOTP 2FA |
| `/api/auth/two-factor/verify` | POST | Verify TOTP code |
| `/api/auth/two-factor/disable` | POST | Disable TOTP 2FA |
| `/api/auth/list-sessions` | GET | List all active sessions (auth required) |
| `/api/auth/revoke-session` | POST | Revoke a session by ID |
| `/api/auth/revoke-other-sessions` | POST | Revoke all sessions except current |
| `/api/auth/admin/list-users` | GET | Admin: list all users |
| `/api/auth/admin/set-role` | POST | Admin: change user role |
| `/api/auth/admin/ban-user` | POST | Admin: ban a user |
| `/api/auth/admin/unban-user` | POST | Admin: unban a user |
| `/api/auth/admin/revoke-user-sessions` | POST | Admin: revoke all sessions for a user |
| `/api/auth/providers` | GET | List active providers (emailPassword, github, mfa) |

---

## Session Configuration

| Setting | Value | Location |
|---------|-------|----------|
| Session TTL | 7 days | `expiresIn: 60 * 60 * 24 * 7` in `auth.ts` |
| Auto-refresh | Within 1 day of expiry | `updateAge: 60 * 60 * 24` |
| Cookie cache | 5 minutes | `cookieCache: { enabled: true, maxAge: 5 * 60 }` |
| Cookie prefix | `adblock` | `cookiePrefix: 'adblock'` |
| Cookie name | `adblock.session_token` | Derived from prefix |

---

## Deployment Checklist

### First-Time Setup

1. [ ] Provision Neon PostgreSQL database
2. [ ] Create Cloudflare Hyperdrive configuration pointing to Neon
3. [ ] Generate `BETTER_AUTH_SECRET`: `openssl rand -base64 32`
4. [ ] Set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in `.dev.vars` (local) or via `wrangler secret put` (production)
5. [ ] Run migrations: `deno task db:migrate`
6. [ ] Deploy Worker: `wrangler deploy`
7. [ ] Create first admin user (via Prisma Studio — set `role = admin`, `tier = admin`)
8. [ ] Verify auth flow end-to-end
9. [ ] (Optional) Enable Better Auth Dash: set `BETTER_AUTH_API_KEY` via `wrangler secret put BETTER_AUTH_API_KEY` — the key is passed explicitly to `dash()` and `sentinel()` via `apiKey: env.BETTER_AUTH_API_KEY`; there is no automatic `process.env` pickup in Cloudflare Workers

### Adding GitHub OAuth

1. [ ] Create GitHub OAuth App (callback: `https://your-worker.workers.dev/api/auth/callback/github`)
2. [ ] `wrangler secret put GITHUB_CLIENT_ID`
3. [ ] `wrangler secret put GITHUB_CLIENT_SECRET`
4. [ ] `wrangler deploy`
5. [ ] Verify: `curl https://your-worker.workers.dev/api/auth/providers`

---

## Related Documentation

- [Better Auth Developer Guide](better-auth-developer-guide.md) — Plugin configuration
- [Better Auth Prisma Setup](better-auth-prisma.md) — Hyperdrive + Prisma adapter
- [Social Providers](social-providers.md) — GitHub/Google OAuth setup
- [Better Auth Admin Guide](better-auth-admin-guide.md) — Secret rotation, user management

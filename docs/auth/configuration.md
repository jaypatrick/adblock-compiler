# Authentication Configuration Guide

Complete reference for all environment variables and configuration needed to run the adblock-compiler authentication system.

## Environment Variables

### Clerk Authentication (Required)

| Variable                | Required | Source                                                 | Description                                                                                               |
| ----------------------- | -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `CLERK_PUBLISHABLE_KEY` | **Yes**  | Clerk Dashboard → API Keys                             | Public key for frontend Clerk initialization. Starts with `pk_test_` or `pk_live_`.                       |
| `CLERK_SECRET_KEY`      | **Yes**  | Clerk Dashboard → API Keys                             | Secret key for backend operations. **Never expose.** Starts with `sk_test_` or `sk_live_`.                |
| `CLERK_JWKS_URL`        | **Yes**  | Derived from Clerk Frontend API URL                    | JWKS endpoint for JWT verification. Format: `https://<instance>.clerk.accounts.dev/.well-known/jwks.json` |
| `CLERK_WEBHOOK_SECRET`  | **Yes**  | Clerk Dashboard → Webhooks → Endpoint → Signing Secret | Svix signing secret for webhook signature verification. Starts with `whsec_`.                             |

### Admin Access (Legacy)

| Variable    | Required | Source         | Description                                                                                                                                 |
| ----------- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_KEY` | Optional | Self-generated | Static admin key for legacy admin endpoints. Used with `X-Admin-Key` header. Will be replaced by Clerk tier-based auth in a future release. |

### Cloudflare Access (Optional — Defense-in-Depth)

| Variable                | Required | Source                                                    | Description                                                                                       |
| ----------------------- | -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CF_ACCESS_TEAM_DOMAIN` | Optional | Cloudflare Zero Trust Dashboard                           | Your Cloudflare Access team domain (e.g., `mycompany`). If not set, CF Access checks are skipped. |
| `CF_ACCESS_AUD`         | Optional | CF Access → Applications → Application Audience (AUD) Tag | Audience claim for CF Access JWT verification. Required if `CF_ACCESS_TEAM_DOMAIN` is set.        |

### Cloudflare Turnstile (Optional — Bot Protection)

| Variable               | Required | Source                           | Description                                                                           |
| ---------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `TURNSTILE_SITE_KEY`   | Optional | Cloudflare Dashboard → Turnstile | Public site key for frontend widget. Returned to clients via `/api/turnstile-config`. |
| `TURNSTILE_SECRET_KEY` | Optional | Cloudflare Dashboard → Turnstile | Secret key for server-side token verification. If not set, Turnstile is disabled.     |

### Database (Required)

| Variable       | Required | Source                       | Description                                                                                                                                                   |
| -------------- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | **Yes**  | PostgreSQL connection string | Hyperdrive connection URL in production; local PostgreSQL URL in development. Used for **API keys** (PostgreSQL) only — user sync uses Cloudflare D1 instead. |

## Local Development Setup

This project uses **direnv** + `.envrc` for ALL local environment management. When you enter the project directory, the `.envrc` automatically loads the appropriate `.env` file(s) based on your git branch.

### Step 1: Install direnv (one-time)

```bash
# macOS
brew install direnv

# Add to your shell config (~/.zshrc or ~/.bashrc)
eval "$(direnv hook zsh)"   # or bash
```

### Step 2: Allow the .envrc

```bash
cd adblock-compiler
direnv allow
```

### Step 3: Create your .dev.vars

Worker runtime vars (Clerk keys, Turnstile, CORS, Hyperdrive, etc.) all live in `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars` with your real values:

```bash
# .dev.vars — NOT committed to git
# Loaded by both `wrangler dev` and direnv (.envrc)

ENVIRONMENT=development

CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_JWKS_URL=https://your-instance.clerk.accounts.dev/.well-known/jwks.json
CLERK_WEBHOOK_SECRET=whsec_...

# Use Cloudflare test keys (always pass) for local dev
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

ADMIN_KEY=local-dev-admin-key

CORS_ALLOWED_ORIGINS=http://localhost:4200,http://localhost:8787

# Optional: point Hyperdrive at a local PostgreSQL instance
# WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://user:pw@127.0.0.1:5432/adblock_dev?sslmode=verify-full&sslrootcert=system

# Optional: CF Access
# CF_ACCESS_TEAM_DOMAIN=your-team-name
# CF_ACCESS_AUD=your-audience-tag
```

For a complete annotated template see [`.dev.vars.example`](../../.dev.vars.example).

> If you also need to override a **shell-tooling** variable (e.g. point Prisma at a local
> PostgreSQL instance instead of the SQLite default), create `.env.local` from
> `.env.example`. You should not need it just to run `wrangler dev`.

### How .envrc loads your variables

The `.envrc` loads files in this order (later overrides earlier):

```
.env             ← committed base defaults (PORT, COMPILER_VERSION)
.env.development ← committed dev shell defaults (DATABASE_URL, LOG_LEVEL=debug)
.env.local       ← your shell overrides (gitignored)
.dev.vars        ← Worker secrets + runtime vars (gitignored, highest precedence)
```

---

## Production Deployment

For production Cloudflare Workers deployments, use `wrangler secret put` for true secrets, and `wrangler.toml [vars]` **only** for static, non-sensitive runtime configuration that is not managed by `.env`:

### Non-secrets in wrangler.toml [vars]

Non-sensitive Worker runtime vars that are safe to commit:

```toml
[vars]
COMPILER_VERSION = "0.62.5"
ENVIRONMENT = "production"
CLERK_PUBLISHABLE_KEY = "pk_live_..."
CLERK_JWKS_URL = "https://your-instance.clerk.accounts.dev/.well-known/jwks.json"
TURNSTILE_SITE_KEY = "0x4AAA..."   # production site key — not a secret
```

During `wrangler dev`, `.dev.vars` overrides these with local/test values.

### Secrets (wrangler secret put)

For production, set secrets via Cloudflare's secret management — **never** commit real keys to `wrangler.toml` or any `.env.*` file:

```bash
# Clerk authentication secrets
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_WEBHOOK_SECRET

# Cloudflare Access (admin route protection — optional)
wrangler secret put CF_ACCESS_TEAM_DOMAIN
wrangler secret put CF_ACCESS_AUD

# Turnstile bot protection (secret key only — site key is in [vars])
wrangler secret put TURNSTILE_SECRET_KEY

# CORS allowlist
wrangler secret put CORS_ALLOWED_ORIGINS

# Legacy admin key
wrangler secret put ADMIN_KEY

# Observability
wrangler secret put SENTRY_DSN
wrangler secret put ANALYTICS_ACCOUNT_ID
wrangler secret put ANALYTICS_API_TOKEN
wrangler secret put OTEL_EXPORTER_OTLP_ENDPOINT
```

## Frontend Configuration

The Angular frontend does **not** require build-time environment files. All auth configuration is fetched at runtime:

| Endpoint                    | Response                            | Purpose                                                    |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `GET /api/clerk-config`     | `{ publishableKey: "pk_..." }`      | Clerk publishable key for `@clerk/clerk-js` initialization |
| `GET /api/turnstile-config` | `{ siteKey: "...", enabled: true }` | Turnstile widget configuration                             |

### How It Works

1. Angular app starts → `app.config.ts` runs initialization
2. Fetches `/api/turnstile-config` → configures Turnstile widget
3. Fetches `/api/clerk-config` → initializes `ClerkService` with the publishable key
4. `ClerkService` loads `@clerk/clerk-js` and listens for auth state changes
5. `authInterceptor` automatically attaches JWT to API requests

### Angular Injection Tokens

Defined in `frontend/src/app/tokens.ts`:

| Token                | Type                     | Default | Description               |
| -------------------- | ------------------------ | ------- | ------------------------- |
| `TURNSTILE_SITE_KEY` | `InjectionToken<string>` | `''`    | Turnstile public site key |
| `API_BASE_URL`       | `InjectionToken<string>` | `/api`  | Base URL for API calls    |

> **Note:** The Clerk publishable key is fetched from `GET /api/clerk-config` at runtime rather than provided as a static injection token, matching the Turnstile pattern.

## Database Schema

The auth system uses a **split database architecture**:

- **Cloudflare D1 (SQLite)** — stores user records, synced from Clerk webhooks. Binding: `env.DB`.
- **PostgreSQL via Hyperdrive** — stores API keys. Connection: `DATABASE_URL` environment variable.

### `users` Table (Cloudflare D1)

Managed by `prisma/schema.d1.prisma`; synced via the `POST /api/webhooks/clerk` handler.

| Column          | Type     | Description                         |
| --------------- | -------- | ----------------------------------- |
| `id`            | UUID     | Primary key                         |
| `clerk_user_id` | String   | Clerk user ID (unique, indexed)     |
| `email`         | String   | Primary email from Clerk            |
| `first_name`    | String?  | First name                          |
| `last_name`     | String?  | Last name                           |
| `image_url`     | String?  | Profile picture URL                 |
| `tier`          | String   | `anonymous`, `free`, `pro`, `admin` |
| `created_at`    | DateTime | Record creation time                |
| `updated_at`    | DateTime | Last record update                  |

Apply the D1 migration before first deploy:

```bash
wrangler d1 migrations apply adblock-compiler-d1-database --remote
```

### `api_keys` Table (PostgreSQL via Hyperdrive)

| Column               | Type      | Description                                       |
| -------------------- | --------- | ------------------------------------------------- |
| `id`                 | UUID      | Primary key                                       |
| `userId`             | UUID      | Foreign key → `users.id`                          |
| `keyHash`            | String    | SHA-256 hash of the plaintext key                 |
| `keyPrefix`          | String    | First 8 characters for display (e.g., `abc_Xk9m`) |
| `name`               | String    | User-provided key name (max 100 chars)            |
| `scopes`             | String[]  | Authorized scopes: `compile`, `rules`, `admin`    |
| `rateLimitPerMinute` | Int       | Per-key rate limit (default: 60)                  |
| `expiresAt`          | DateTime? | Optional expiration (1–365 days)                  |
| `revokedAt`          | DateTime? | Soft-delete timestamp                             |
| `lastUsedAt`         | DateTime? | Last authentication timestamp                     |
| `createdAt`          | DateTime  | Record creation time                              |
| `updatedAt`          | DateTime  | Last record update                                |

## Deployment Checklist

### First-Time Setup

1. [ ] Create Clerk application ([guide](clerk-setup.md))
2. [ ] Configure Clerk sign-in/sign-up URLs
3. [ ] Configure Clerk allowed origins
4. [ ] Set up Clerk webhook endpoint
5. [ ] Copy `.env.example` → `.env.local` and fill in all auth keys (local dev)
6. [ ] Store all production secrets via `wrangler secret put` (production deploy)
7. [ ] Apply D1 migration: `wrangler d1 migrations apply adblock-compiler-d1-database --remote`
8. [ ] Deploy worker: `wrangler deploy`
9. [ ] Test webhook delivery from Clerk dashboard
10. [ ] Create first admin user (set `tier: admin` in Clerk public metadata)
11. [ ] Verify end-to-end auth flow

### Production Upgrade

1. [ ] Switch from `pk_test_` / `sk_test_` to `pk_live_` / `sk_live_` keys
2. [ ] Update webhook endpoint URL to production domain
3. [ ] Configure CF Access for admin routes (recommended)
4. [ ] Enable Turnstile for bot protection
5. [ ] Set up monitoring/alerts for auth failures
6. [ ] Remove or rotate `ADMIN_KEY` if migrating to Clerk-only admin auth

## Conditional Feature Behavior

| Feature    | When Enabled                                  | When Disabled                                              |
| ---------- | --------------------------------------------- | ---------------------------------------------------------- |
| Clerk Auth | `CLERK_JWKS_URL` is set                       | JWT verification skipped; anonymous access only            |
| Turnstile  | `TURNSTILE_SECRET_KEY` is set                 | Bot protection disabled; compilation requests not verified |
| CF Access  | `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` set | CF Access checks skipped on admin routes                   |
| Admin Key  | `ADMIN_KEY` is set                            | Legacy admin endpoints return "not configured"             |

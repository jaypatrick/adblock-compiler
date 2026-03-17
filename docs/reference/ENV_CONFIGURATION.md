# Environment Configuration

This project uses a two-track layered environment system. Understanding which track a variable belongs to is the most important concept in this document.

## The Two Tracks

```mermaid
flowchart LR
    subgraph shell ["Shell tooling track (.env* files)"]
        direction TB
        E1[".env"] --> E2[".env.$ENV"]
        E2 --> E3[".env.local"]
    end
    subgraph worker ["Wrangler Worker track (.dev.vars)"]
        direction TB
        W1["wrangler.toml [vars]\n(non-secrets)"]
        W2[".dev.vars\n(local overrides + secrets)"]
    end
    shell -->|"direnv loads .dev.vars last\n(highest precedence)"| worker
```

| Track               | Read by                         | Files                                                       | Tools    |
| ------------------- | ------------------------------- | ----------------------------------------------------------- | -------- |
| **Shell tooling**   | Prisma CLI, Deno tasks, scripts | `.env`, `.env.development`, `.env.production`, `.env.local` | direnv   |
| **Wrangler Worker** | Cloudflare Worker runtime       | `wrangler.toml [vars]` + `.dev.vars`                        | wrangler |

**The key rule:** if `worker/types.ts` `Env` interface has the variable, it belongs to the Wrangler track. If only shell scripts use it, it belongs to the shell track. A small set of non-secret vars (e.g. `COMPILER_VERSION`) appears in **both** tracks — in `.env` for shell tooling/CI and in `wrangler.toml [vars]` for the Worker runtime — which is intentional and acceptable.

## Load Order

direnv loads files in this order — later files override earlier ones:

| Order | File         | Committed | Purpose                                                     |
| ----- | ------------ | --------- | ----------------------------------------------------------- |
| 1     | `.env`       | ✅ Yes    | Non-secret base defaults: `PORT`, `COMPILER_VERSION`        |
| 2     | `.env.$ENV`  | ✅ Yes    | Branch-specific shell defaults: `DATABASE_URL`, `LOG_LEVEL` |
| 3     | `.env.local` | ❌ No     | Personal shell overrides                                    |
| 4     | `.dev.vars`  | ❌ No     | Wrangler Worker secrets + public vars (highest precedence)  |

`$ENV` is determined by your current git branch:

| Git branch         | `$ENV`        | Shell file loaded  |
| ------------------ | ------------- | ------------------ |
| `main`             | `production`  | `.env.production`  |
| `dev` or `develop` | `development` | `.env.development` |
| Any other branch   | `local`       | `.env.local` only  |

## File Purposes

### `.env` — Shell base defaults (committed)

Non-secret constants used by shell tooling on every branch: `PORT`, `COMPILER_VERSION`.

**Never put Worker runtime vars here.** `CLERK_*`, `TURNSTILE_*`, `CORS_*`, and `ENVIRONMENT` all belong in `.dev.vars` or `wrangler.toml [vars]`.

### `.env.development` — Dev shell defaults (committed)

Shell-tooling vars that differ in development: `DATABASE_URL` (SQLite path), `LOG_LEVEL=debug`.

Worker vars formerly here (`TURNSTILE_SITE_KEY`, `CLERK_*`) have been removed — they now live exclusively in `.dev.vars`.

### `.env.production` — Production shell scope (committed, intentionally minimal)

This file intentionally contains no active variables. The production Worker gets all its config from `wrangler.toml [vars]` and `wrangler secret put`. There are no shell-tooling production vars that need to be committed.

### `.env.local` — Personal shell overrides (gitignored)

Your local override for shell-tooling vars only (e.g., pointing `DATABASE_URL` at a local PostgreSQL instance instead of the SQLite default). Use `.dev.vars` for Worker secrets.

### `.dev.vars` — Wrangler Worker runtime (gitignored)

The single source of truth for everything the Worker reads at runtime during `wrangler dev`. Loaded automatically by both `wrangler dev` and direnv, so Worker vars are also available in your shell without duplication.

See `.dev.vars.example` for the full annotated template.

### `wrangler.toml [vars]` — Production Worker non-secrets (committed)

Non-secret Worker runtime vars deployed to Cloudflare production: `COMPILER_VERSION`, `ENVIRONMENT`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWKS_URL`, `TURNSTILE_SITE_KEY`. `.dev.vars` overrides these during `wrangler dev`.

## Setup

### 1. Install direnv (one-time)

```bash
# macOS
brew install direnv

# Add to ~/.zshrc
eval "$(direnv hook zsh)"
```

### 2. Allow the .envrc

```bash
direnv allow
```

### 3. Create .dev.vars from the example

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your real Clerk keys, DB connection string, etc.
```

`.dev.vars` is your primary secrets file. You should not need `.env.local` unless you are overriding shell-tooling vars like `DATABASE_URL` for Prisma.

### 4. (Optional) Create .env.local

Only needed if you want to override a shell-tooling var (e.g. point Prisma at a local PostgreSQL database instead of SQLite):

```bash
# .env.local — NOT committed to git
DATABASE_URL=postgresql://user:password@localhost:5432/adblock_dev
DIRECT_DATABASE_URL=postgresql://user:password@localhost:5432/adblock_dev
```

## Variable Ownership Reference

| Variable                      | Worker `Env`?      | Local file                        | Production             |
| ----------------------------- | ------------------ | --------------------------------- | ---------------------- |
| `COMPILER_VERSION`            | ✅                 | `.env`                            | `wrangler.toml [vars]` |
| `PORT`                        | ❌                 | `.env`                            | N/A                    |
| `DATABASE_URL`                | ❌                 | `.env.development` / `.env.local` | Hyperdrive binding     |
| `DIRECT_DATABASE_URL`         | ❌                 | `.env.local`                      | N/A                    |
| `ENVIRONMENT`                 | ✅                 | `.dev.vars`                       | `wrangler.toml [vars]` |
| `CLERK_PUBLISHABLE_KEY`       | ✅                 | `.dev.vars`                       | `wrangler.toml [vars]` |
| `CLERK_JWKS_URL`              | ✅                 | `.dev.vars`                       | `wrangler.toml [vars]` |
| `CLERK_SECRET_KEY`            | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `CLERK_WEBHOOK_SECRET`        | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `ADMIN_KEY`                   | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `JWT_SECRET`                  | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `TURNSTILE_SITE_KEY`          | ✅                 | `.dev.vars`                       | `wrangler.toml [vars]` |
| `TURNSTILE_SECRET_KEY`        | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `CORS_ALLOWED_ORIGINS`        | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `WRANGLER_HYPERDRIVE_LOCAL_*` | ✅ (wrangler only) | `.dev.vars`                       | N/A                    |
| `CF_ACCESS_TEAM_DOMAIN`       | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `CF_ACCESS_AUD`               | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `SENTRY_DSN`                  | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `ANALYTICS_ACCOUNT_ID`        | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `ANALYTICS_API_TOKEN`         | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ✅                 | `.dev.vars`                       | `wrangler secret put`  |
| `LOG_LEVEL`                   | ❌                 | `.env.development`                | N/A                    |
| `LOG_STRUCTURED`              | ❌                 | `.env.development`                | N/A                    |

## Adding a New Variable

1. Determine the track: does the Worker read it? → Wrangler track. Shell tooling only? → shell track.
2. **Wrangler track:**
   - Add to `.dev.vars.example` with a comment
   - If non-secret, add to `wrangler.toml [vars]` for production
   - If secret, add `wrangler secret put VAR_NAME` to the deployment checklist in `docs/auth/configuration.md`
   - Add to `worker/types.ts` `Env` interface
3. **Shell track:**
   - Add to `.env.example` with a comment stub
   - Add default to `.env` or `.env.development` as appropriate
4. Do **not** add Worker vars to `.env*` files or shell vars to `.dev.vars`.

## GitHub Actions Integration

GitHub Actions does not use direnv. The `.github/actions/setup-env` composite action mirrors the shell track only (`.env` + `.env.$ENV`). Worker runtime vars are managed as Cloudflare Worker Secrets (`wrangler secret put`) and `wrangler.toml [vars]` — they are **not** loaded by `.github/actions/setup-env` and should **not** be stored as GitHub Secrets.

See [ENV_SETUP.md](../workflows/ENV_SETUP.md) for full CI reference.

## Troubleshooting

### `direnv: error .envrc is blocked`

```bash
direnv allow
```

### Variable available in shell but not in Worker

Worker vars must be in `.dev.vars`, not in `.env*` files. `wrangler dev` only reads `.dev.vars` and `wrangler.toml` — it does not read shell env files.

### Variable available in Worker but not in shell scripts

Add `dotenv_if_exists ".dev.vars"` is already in `.envrc` — run `direnv reload` to pick up new entries.

### Wrong environment loaded

```bash
git branch --show-current   # verify branch maps to expected $ENV
direnv reload
```

## Security Guidelines

- ✅ Commit `.env`, `.env.development`, `.env.production` — they must never contain secrets
- ✅ `.dev.vars` is gitignored — never force-add it
- ✅ Add every new variable to the appropriate sample file before merging
- ❌ Never put Worker secrets (`CLERK_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, etc.) in any `.env*` file
- ❌ Never put production secrets in `wrangler.toml [vars]`
- ❌ Never commit `.env.local` or `.dev.vars`

For auth-specific variables, see [docs/auth/configuration.md](../auth/configuration.md).

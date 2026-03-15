# GitHub Actions Environment Setup

This project uses a layered environment configuration system that automatically loads variables based on the git branch.

## How It Works

The `.github/actions/setup-env` composite action mimics the behavior of `.envrc` for GitHub Actions workflows:

1. Detects the environment from the branch name
2. Loads `.env` (base configuration)
3. Loads `.env.$ENV` (environment-specific)
4. Exports all variables to `$GITHUB_ENV`

## Branch to Environment Mapping

| Branch Pattern             | Environment   | Loaded Files                |
| -------------------------- | ------------- | --------------------------- |
| `main`                     | `production`  | `.env`, `.env.production`   |
| `dev`, `develop`           | `development` | `.env`, `.env.development`  |
| Other branches (with file) | Custom        | `.env`, `.env.$BRANCH_NAME` |
| Other branches (no file)   | Default       | `.env`                      |

## Usage in Workflows

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Load environment variables
    uses: ./.github/actions/setup-env

  - name: Use environment variables
    run: |
      echo "Compiler version: $COMPILER_VERSION"
      echo "Port: $PORT"
```

### With Custom Branch

```yaml
- name: Load environment variables for specific branch
  uses: ./.github/actions/setup-env
  with:
    branch: "staging"
```

### Access Detected Environment

```yaml
- name: Load environment variables
  id: env
  uses: ./.github/actions/setup-env

- name: Use detected environment
  run: echo "Running in ${{ steps.env.outputs.environment }} environment"
```

## Environment Variables Available

The `.env*` files cover **shell-tooling variables only**. Worker runtime variables
(`CLERK_*`, `TURNSTILE_*`, `CORS_*`, `ENVIRONMENT`, etc.) live in `.dev.vars` locally
and are injected as Worker Secrets / `wrangler.toml [vars]` in production — they are
not exported from `.env*` files and are not loaded by this action.

### From `.env` (all environments)

- `COMPILER_VERSION` — Current compiler version
- `PORT` — Server port (default: 8787)

### From `.env.development` (dev/develop branches)

- `DATABASE_URL` — Local SQLite database path (`file:./data/adblock.db`)
- `LOG_LEVEL` — `debug`
- `LOG_STRUCTURED` — `false`

### From `.env.production` (main branch)

This file is intentionally empty — production Worker vars come from
`wrangler.toml [vars]` and `wrangler secret put`, not from `.env` files.

**Note**: Never put `CLERK_*`, `TURNSTILE_*`, or other Worker runtime vars into `.env.*`
files or this action. Use GitHub Secrets → Worker Secrets for those.

## Setting Production Secrets

For production deployments, set secrets in GitHub repository settings:

```yaml
env:
  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  ADMIN_KEY: ${{ secrets.ADMIN_KEY }}
  TURNSTILE_SECRET_KEY: ${{ secrets.TURNSTILE_SECRET_KEY }}
```

Required GitHub Secrets for production (shell/CI tooling only):

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token for `wrangler deploy`
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

Worker runtime secrets (`CLERK_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `ADMIN_KEY`, etc.)
are **not** GitHub Secrets — they are Cloudflare Worker Secrets set via
`wrangler secret put` and are never injected through this action.
See [docs/auth/configuration.md](../auth/configuration.md) for the full list.

## Example: Deploy Workflow

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Load environment variables
        id: env
        uses: ./.github/actions/setup-env

      - name: Deploy to environment
        run: |
          if [ "${{ steps.env.outputs.environment }}" = "production" ]; then
            wrangler deploy  # production is the top-level default env; no --env flag needed
          else
            wrangler deploy --env development
          fi
        env:
          # Production secrets override file-based config
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          ADMIN_KEY: ${{ secrets.ADMIN_KEY }}
```

## Comparison: Local vs CI

| Aspect               | Local Development                     | GitHub Actions              |
| -------------------- | ------------------------------------- | --------------------------- |
| Shell-tooling loader | `.envrc` + `direnv`                   | `.github/actions/setup-env` |
| Branch detection     | Git branch (real-time)                | `github.ref_name`           |
| Shell secrets        | `.env.local` (gitignored)             | GitHub Secrets              |
| Worker runtime vars  | `.dev.vars` (gitignored)              | Cloudflare Worker Secrets   |
| Highest precedence   | `.dev.vars` (loaded last by `.envrc`) | `wrangler secret put`       |

## Debugging

To see what environment is detected and what variables are loaded:

```yaml
- name: Load environment variables
  id: env
  uses: ./.github/actions/setup-env

- name: Debug environment
  run: |
    echo "Environment: ${{ steps.env.outputs.environment }}"
    echo "Branch: ${{ github.ref_name }}"
    env | grep -E 'COMPILER_VERSION|PORT|DATABASE_URL' || true
```

## Security Best Practices

1. ✅ **DO** use GitHub Secrets for production credentials
2. ✅ **DO** load base config from `.env` files
3. ✅ **DO** use test keys in `.env.development`
4. ❌ **DON'T** commit real secrets to `.env.*` files
5. ❌ **DON'T** echo secret values in workflow logs
6. ❌ **DON'T** use production credentials in PR builds

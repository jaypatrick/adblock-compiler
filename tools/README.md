# tools/

Standalone operational diagnostic scripts for the bloqr-backend / Bloqr stack, with interactive [Marimo](https://marimo.io) runbooks that run in your browser.

| Script                | Purpose                                                            | Runbook                              |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| `auth-healthcheck.py` | End-to-end Better Auth diagnostic — sign-up, sign-in, KV, D1, Neon | `deno task runbook:auth-healthcheck` |

## Quick Start (Interactive Runbooks)

```bash
# One-time setup (from repo root)
uv sync --directory tools

# Launch the master pipeline runbook (recommended admin entry point)
deno task runbook:pipeline
# — or —
uv run --directory tools marimo run runbooks/pipeline.py
```

The master runbook opens in your browser at `http://localhost:2718` and includes:

- Health dashboard (last run status for every tool)
- Pipeline executor (run any combination of tools in sequence)
- Log browser (view and copy log files for AI assistants)

For a specific tool:

```bash
deno task runbook:auth-healthcheck
# — or —
uv run --directory tools marimo run runbooks/auth-healthcheck.py
```

## Setup (CLI Mode)

If you prefer to run scripts from the terminal, all dependencies are already managed via `uv`:

```bash
uv sync --directory tools
```

## Config

### marimo Configuration

`tools/.marimo.toml` is tracked by git and contains only safe defaults — **no credentials are stored in it**. AI provider API keys are passed via environment variables:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="github_pat_..."
```

If you want a reference showing all available configuration sections and recommended defaults, see [`.marimo.toml.example`](.marimo.toml.example) — no credentials or api_key fields are included.

**Where to get credentials:**

- **GitHub**: Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new with the `Models: Read` permission (no other scopes required)
- **Anthropic**: Get your API key from https://console.anthropic.com/account/keys

⚠️ **Security**: Never add real API keys directly to `tools/.marimo.toml` — it is tracked by git. Use environment variables or a local `.env` file instead.

### Script Configuration

Each script has a corresponding `.env` file:

```bash
cp tools/auth-healthcheck.env.example tools/auth-healthcheck.env
# Fill in NEON_URL and optionally BETTER_AUTH_API_KEY
```

## CLI Usage

```bash
uv run --directory tools python auth-healthcheck.py

# Non-interactive
uv run --directory tools python auth-healthcheck.py --mode all
uv run --directory tools python auth-healthcheck.py --mode checks
uv run --directory tools python auth-healthcheck.py --dry-run
```

## Tests

```bash
# From repo root
uv run --directory tools pytest tests/ -v
# — or —
deno task runbook:test
```

## Documentation

- [`docs/tools/README.md`](../docs/tools/README.md) — All tools, Marimo setup, pipeline chaining guide
- [`tools/docs/auth-healthcheck/README.md`](docs/auth-healthcheck/README.md) — In-depth auth-healthcheck reference
- [`tools/runbooks/README.md`](runbooks/README.md) — Runbook quick start

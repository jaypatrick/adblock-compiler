# tools/

Standalone operational diagnostic scripts for the adblock-compiler / Bloqr stack, with interactive [Marimo](https://marimo.io) runbooks that run in your browser.

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

The marimo environment requires API keys for AI features. A template is provided:

```bash
cp tools/.marimo.toml.example tools/.marimo.toml
```

Edit `tools/.marimo.toml` and populate your credentials:

```toml
[ai.github]
api_key = "YOUR_GITHUB_TOKEN_HERE"

[ai.anthropic]
api_key = "YOUR_ANTHROPIC_API_KEY_HERE"
```

**Where to get credentials:**

- **GitHub**: Create a personal access token at https://github.com/settings/personal-access-tokens/new (requires `gist` scope for model access)
- **Anthropic**: Get your API key from https://console.anthropic.com/account/keys

⚠️ **Security**: `.marimo.toml` is intentionally untracked by git. The local copy you create from the template will never be committed, so credentials stay on your machine. Never add real keys to `.marimo.toml.example` (the committed template). Use environment variables (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) for credentials whenever possible; the file exists only as a convenience for local dev.

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

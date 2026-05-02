# Ops Tools

This chapter documents the operational tooling suite for adblock-compiler / Bloqr. Each tool is a standalone Python script located in `tools/` at the repo root.

Tools are designed to:

- Run against **production** (or any environment) from a local machine
- Be entirely self-contained — config via `tools/<tool-name>.env`, no shell exports required
- Produce a machine-readable JSON report for sharing with AI assistants or storing as artifacts
- Produce a human-readable rich terminal output in parallel

---

## Philosophy

These scripts exist because production systems have many moving parts that need to be verified holistically — auth, caching, databases, worker logs — and doing that manually via individual CLI commands is slow and error-prone.

Each tool follows the same conventions:

| Convention | Detail |
|---|---|
| Config file | `tools/<tool-name>.env` (gitignored) |
| Config template | `tools/<tool-name>.env.example` (committed) |
| Virtual env | `tools/.venv/` (gitignored, shared across all tools) |
| JSON report | `<tool-name>-YYYYMMDD-HHMMSS.json` at repo root (gitignored) |
| Dependencies | `pip install requests rich psycopg2-binary` |

---

## Available Tools

| Script | Purpose | Doc |
|---|---|---|
| `auth-healthcheck.py` | End-to-end Better Auth diagnostic — sign-up, sign-in, session validation, KV, D1, Neon | [→](auth-healthcheck.md) |

> **Future tools planned:**
> - `db-healthcheck.py` — Neon / Prisma schema drift, row counts, replication lag
> - `kv-inspector.py` — Better Auth KV key explorer with TTL and prefix breakdown
> - `worker-smoke-test.py` — Smoke test all API endpoints and report status codes
> - `d1-audit.py` — D1 table structure, row counts, and index analysis across all bindings
> - `deployment-verify.py` — Post-deploy validation: worker version, secrets present, bindings wired

---

## Setup (one time)

```bash
# From repo root
python3 -m venv tools/.venv
source tools/.venv/bin/activate
pip install requests rich psycopg2-binary
```

Add a shell alias for convenience (add to `~/.zshrc`):

```bash
alias auth-check='cd /path/to/adblock-compiler && source tools/.venv/bin/activate && python tools/auth-healthcheck.py'
```

---

## Future: Control Panel

The long-term goal is to wrap these scripts in a unified control panel UI — a lightweight web interface (or Cloudflare Pages app) that:

- Lists all available tools
- Accepts configuration values via a form (no local env files needed)
- Streams tool output to the browser in real time
- Stores JSON reports as R2 artifacts with a history view
- Allows triggering tools remotely (e.g. post-deploy hooks)

Each script's clean JSON output format is intentionally designed with this future integration in mind.

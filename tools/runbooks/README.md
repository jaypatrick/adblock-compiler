# Bloqr Ops — Interactive Runbooks

Interactive runbooks powered by [Marimo](https://marimo.io) for diagnosing and operating the Bloqr / adblock-compiler stack.

## Quick Start

```bash
# One-time setup (from repo root)
python3 -m venv tools/.venv
source tools/.venv/bin/activate
pip install -r tools/runbooks/requirements.txt

# Launch the master pipeline runbook (recommended starting point)
marimo run tools/runbooks/pipeline.py

# Or launch a specific tool runbook
marimo run tools/runbooks/auth-healthcheck.py
```

Deno shortcut tasks are also available:

```bash
deno task runbook:setup             # Install Marimo + dependencies (one-time)
deno task runbook:pipeline          # Open master pipeline runbook
deno task runbook:auth-healthcheck  # Open auth-healthcheck runbook
```

## What Is Marimo?

[Marimo](https://marimo.io) is a reactive Python notebook that runs in your browser.
Each runbook is a single `.py` file — plain Python, no JSON, clean git diffs.

- Run `marimo run <file.py>` → browser opens at `http://localhost:2718`
- Cells are reactive — changing an input updates all downstream cells automatically
- No Jupyter knowledge required — just run the command and interact

## Available Runbooks

| Runbook | File | Purpose |
|---|---|---|
| **Master Pipeline** | `pipeline.py` | Health dashboard + run any combination of tools |
| **Auth Healthcheck** | `auth-healthcheck.py` | End-to-end Better Auth diagnostic |

More runbooks will be added as new tools are created.

## Runbook Structure

Every runbook is self-contained and follows this layout:

1. **Header** — purpose, what it does, quick start
2. **Prerequisites** — checks that required CLI tools and packages are installed
3. **Configuration** — editable env var form (changes apply only to current run)
4. **Run mode** — select what to execute
5. **Execute** — run button with live output
6. **Results** — inline JSON report display with pass/fail badges
7. **Log browser** — select log files, view inline, copy path for AI sharing
8. **Quick reference** — troubleshooting guide, pipeline chaining, tips

## Shared Library

`shared/__init__.py` provides common helpers used by all runbooks:

| Helper | Purpose |
|---|---|
| `load_env_file(tool)` | Load `tools/<tool>.env` into a dict |
| `check_command(cmd)` | Verify a CLI command is in PATH |
| `check_python_package(pkg)` | Verify a Python package is importable |
| `run_tool(script, mode, ...)` | Execute a tool script, capture output |
| `list_log_files(tool, ext)` | List log files for a tool (newest first) |
| `load_latest_report(tool)` | Load the most recent JSON report |
| `render_status_badge(status)` | HTML badge for PASS/FAIL/WARN |
| `all_tools_health_snapshot()` | Last-run status for all registered tools |
| `KNOWN_TOOLS` | Registry of all tools (name, label, paths, description) |

## Adding a New Runbook

1. Create the tool script at `tools/<tool-name>.py`
2. Add an entry to `KNOWN_TOOLS` in `tools/runbooks/shared/__init__.py`
3. Copy `tools/runbooks/auth-healthcheck.py` as a template
4. Rename and adapt the cells for your new tool
5. Create per-tool docs at `tools/docs/<tool-name>/README.md`
6. Add `runbook:<tool-name>` to `deno.json`
7. Create `tools/logs/<tool-name>/.gitkeep`
8. Write tests in `tools/tests/test_<tool-name>_runbook.py`
9. Open a PR using `.github/PULL_REQUEST_TEMPLATE/tools-runbooks.md`

## Testing Runbooks

```bash
cd tools
source .venv/bin/activate
pytest tests/ -v
```

Tests are in `tools/tests/` and cover:
- Shared helper functions
- Runbook Python syntax and importability
- KNOWN_TOOLS registry completeness
- Log file utilities

## Log Files

Tool logs are written to `tools/logs/<tool-name>/`:

```
tools/logs/
  auth-healthcheck/
    auth-healthcheck-20260502-100000.json   ← JSON report
    wrangler-tail-20260502-100000.log       ← wrangler tail output
```

Log directories are created automatically on first run.
`.gitkeep` files ensure directories are tracked in git.
Log files themselves are gitignored.

## Web Access (Future)

To expose runbooks over a network (e.g., `tools.bloqr.dev`):

```bash
# Serve on all interfaces
marimo run tools/runbooks/pipeline.py --host 0.0.0.0 --port 8080

# Gate with Cloudflare Access (recommended for production)
# Set up a Cloudflare Tunnel + Access policy for tools.bloqr.dev → localhost:8080
cloudflared tunnel --url http://localhost:8080
```

See [`docs/tools/README.md`](../../docs/tools/README.md) for full deployment instructions.

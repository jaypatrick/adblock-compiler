# Python Toolchain: marimo, uv, ty, ruff

← [Back to README](../../README.md) | [Monorepo Guide](../development/MONOREPO.md)

The `tools/` directory contains the project's Python operational tooling — runbooks, diagnostics scripts, and data-analysis notebooks — built on the **Astral toolchain** (uv, ruff, ty) and **marimo** reactive notebooks.

---

## Table of Contents

1. [Stack Overview](#stack-overview)
2. [Getting Started](#getting-started)
3. [uv — Package Manager](#uv--package-manager)
4. [marimo — Reactive Notebooks](#marimo--reactive-notebooks)
5. [ruff — Linter and Formatter](#ruff--linter-and-formatter)
6. [ty — Type Checker](#ty--type-checker)
7. [Language Server (pylsp + ty)](#language-server-pylsp--ty)
8. [AI Integration](#ai-integration)
9. [Runtime Configuration](#runtime-configuration)
10. [Task Reference](#task-reference)

---

## Stack Overview

| Tool | Version | Role |
|---|---|---|
| **marimo** | `>=0.17.0` with `[mcp]` extra | Reactive notebook runtime; runbook execution UI |
| **uv** | any | Package manager; virtual environment; script runner |
| **ruff** | `>=0.9.0` | Linter + formatter (replaces flake8, isort, black) |
| **ty** | `>=0.0.1a0` | Astral next-gen type checker; LSP mode (`ty server`) |
| **pylsp** | `>=1.12.0` with `[websockets]` | Marimo inline language server |
| **python-lsp-ruff** | `>=2.2.0` | ruff plugin for pylsp |
| **anthropic** | `>=0.25.0` | AI completions inside the marimo editor |

Python version requirement: `>=3.11` (set in `tools/pyproject.toml`).

---

## Getting Started

All commands are run from the **repository root** using Deno tasks:

```bash
# 1. Install all Python dependencies
deno task runbook:setup
```

This is equivalent to running `uv sync --directory tools`, which:
- Creates `tools/.venv/` if it does not exist
- Installs all runtime and dev dependencies from `tools/uv.lock`
- Makes `marimo`, `ruff`, `ty`, and `pylsp` available within the virtual environment

You do not need to activate the virtual environment manually — all `deno task runbook:*` commands invoke `uv run --directory tools ...`, which activates the correct environment inline.

---

## uv — Package Manager

uv is configured as the package manager in `tools/.marimo.toml`:

```toml
[package_management]
manager = "uv"
```

This means:
- The **Add package** button inside the marimo editor calls `uv add` rather than pip.
- `marimo run --sandbox` and `uv run marimo run` both use the uv-managed virtual environment.
- PEP 723 inline script headers in notebooks are honoured by uv automatically.

### Adding a dependency

```bash
# Add a runtime dependency
cd tools && uv add <package>

# Add a dev-only dependency
cd tools && uv add --dev <package>

# Update the lock file after editing pyproject.toml manually
deno task runbook:setup
```

### Project structure

```
tools/
├── pyproject.toml          ← Project metadata, deps, ruff/ty/pytest config
├── .marimo.toml            ← marimo editor/runtime configuration
├── uv.lock                 ← Reproducible lock file (commit this)
├── .venv/                  ← Virtual environment (git-ignored)
├── runbooks/
│   ├── pipeline.py         ← Compilation pipeline runbook
│   ├── auth-healthcheck.py ← Auth health-check runbook
│   └── tests/              ← pytest tests for runbook logic
└── tests/                  ← General pytest tests
```

---

## marimo — Reactive Notebooks

marimo is a reactive Python notebook framework. Unlike Jupyter, marimo tracks cell dependencies and re-executes only the cells that are actually affected by a change — similar to a spreadsheet.

The minimum version in this project is `0.17.0` because that release introduced the **MCP server** extra (`marimo[mcp]`), which exposes runbooks as Model Context Protocol tools.

### Running a runbook (read-only UI)

```bash
deno task runbook:pipeline
# equivalent: uv run --directory tools marimo run runbooks/pipeline.py
```

This starts a local HTTP server and opens the notebook in the default browser. The notebook is read-only — cell code cannot be edited in this mode.

### Starting the runbook server with a fixed address

```bash
deno task runbook:server
# equivalent: uv run --directory tools marimo run runbooks/pipeline.py --host 127.0.0.1 --port 2718
```

### Editing a runbook

```bash
deno task runbook:edit:pipeline
# equivalent: uv run --directory tools marimo edit runbooks/pipeline.py

deno task runbook:edit:auth-healthcheck
# equivalent: uv run --directory tools marimo edit runbooks/auth-healthcheck.py
```

Edit mode allows full cell editing. Changes are saved as valid Python files.

### Converting Jupyter notebooks

```bash
deno task runbook:convert
# equivalent: uv run --directory tools marimo convert
```

### Autosave and format-on-save

Configured in `tools/.marimo.toml`:

```toml
[save]
autosave = "after_delay"
autosave_delay = 1000       # milliseconds
format_on_save = true       # runs ruff format on each save
```

---

## ruff — Linter and Formatter

ruff is configured in `tools/pyproject.toml`:

```toml
[tool.ruff]
line-length = 120
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "RUF"]
ignore = ["E501"]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

### Rule sets enabled

| Code | Rule set |
|---|---|
| `E` | pycodestyle errors |
| `F` | Pyflakes |
| `I` | isort (import sorting) |
| `UP` | pyupgrade (modernise syntax) |
| `B` | flake8-bugbear |
| `RUF` | Ruff-specific rules |

`E501` (line-too-long) is ignored because `line-length = 120` already enforces the limit at the formatter level.

### Lint and format from the root

```bash
# Lint
deno task runbook:lint
# equivalent: uv run --directory tools ruff check .

# Format
deno task runbook:fmt
# equivalent: uv run --directory tools ruff format .
```

Both commands operate on all files under `tools/`.

---

## ty — Type Checker

`ty` (`>=0.0.1a0`) is the Astral next-generation Python type checker. It is faster than mypy and is used in two ways:

1. **CLI type-checking** via `deno task runbook:typecheck`
2. **LSP mode** inside the marimo editor via `ty server` (see [Language Server](#language-server-pylsp--ty))

### Checking types from the root

```bash
deno task runbook:typecheck
# equivalent: uv run --directory tools ty check auth-healthcheck.py runbooks/
```

Configured in `tools/pyproject.toml`:

```toml
[tool.ty]
# Astral type checker — https://github.com/astral-sh/ty
```

Additional per-file or per-directory `ty` configuration can be added under `[tool.ty]` as the project evolves.

---

## Language Server (pylsp + ty)

marimo embeds a Python language server that powers inline type errors, completions, and hover documentation in the notebook editor without requiring an external IDE.

Configured in `tools/.marimo.toml`:

```toml
[language_servers.pylsp]
enabled = true

[language_servers.ty]
enabled = true
```

Both servers are installed as dev dependencies:

```toml
[dependency-groups]
dev = [
    "ruff>=0.9.0",
    "ty>=0.0.1a0",
    "python-lsp-server[websockets]>=1.12.0",
    "python-lsp-ruff>=2.2.0",
]
```

**How it works:**

- `pylsp` is the main LSP server; it provides completions, diagnostics, and hover.
- `python-lsp-ruff` replaces pylsp's built-in pycodestyle and Pyflakes diagnostics with ruff output, ensuring the language server and the CLI use the same rule set.
- `ty` runs in its own LSP mode (`ty server`) and provides type inference, type errors, and go-to-definition.

---

## AI Integration

The marimo editor includes an AI code assistant powered by Anthropic Claude.

Configured in `tools/.marimo.toml`:

```toml
[ai.anthropic]
model = "claude-sonnet-4-5"
# api_key = ""  # Set via ANTHROPIC_API_KEY env var instead
```

### Setting the API key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# Then start marimo:
deno task runbook:edit:pipeline
```

Alternatively, add the key to `tools/auth-healthcheck.env` — the runbooks load this file automatically via `load_env_file()`.

Available models (as of 2026):
- `claude-opus-4-5` — most capable; best for complex reasoning
- `claude-sonnet-4-5` — balanced speed and capability (configured default)
- `claude-haiku-3-5` — fastest, lowest cost; suitable for completions

---

## Runtime Configuration

Auto-reload is configured in `tools/.marimo.toml`:

```toml
[runtime]
auto_instantiate = true
auto_reload = "lazy"
```

- **`auto_reload = "lazy"`** — when an imported Python module changes on disk, marimo marks dependent cells as stale but does not re-run them automatically. Change to `"autorun"` for a fully reactive experience.
- **`auto_instantiate = true`** — the notebook runs all cells on load (read-only mode).

Completions:

```toml
[completion]
activate_on_typing = true
copilot = false            # GitHub Copilot disabled; AI handled by Anthropic above
```

---

## Task Reference

| Task | Command | Notes |
|---|---|---|
| `runbook:setup` | `uv sync --directory tools` | First-time setup; updates lock file |
| `runbook:pipeline` | `marimo run runbooks/pipeline.py` | Run pipeline runbook (read-only) |
| `runbook:auth-healthcheck` | `marimo run runbooks/auth-healthcheck.py` | Run auth health-check (read-only) |
| `runbook:server` | `marimo run ... --host 127.0.0.1 --port 2718` | Fixed-address server |
| `runbook:edit:pipeline` | `marimo edit runbooks/pipeline.py` | Edit pipeline runbook |
| `runbook:edit:auth-healthcheck` | `marimo edit runbooks/auth-healthcheck.py` | Edit auth-healthcheck runbook |
| `runbook:convert` | `marimo convert` | Convert Jupyter → marimo |
| `runbook:test` | `pytest tests/ -v` | Run pytest suite |
| `runbook:lint` | `ruff check .` | Lint all Python under `tools/` |
| `runbook:fmt` | `ruff format .` | Format all Python under `tools/` |
| `runbook:typecheck` | `ty check auth-healthcheck.py runbooks/` | Type-check runbooks |

All tasks are invoked from the **repository root** as `deno task <name>`.

"""
tools/runbooks/shared/__init__.py
Shared helper utilities for all Bloqr Marimo runbooks.

These helpers provide:
  - Common UI building blocks (status badges, env checks, log viewers)
  - Tool execution wrappers with live output capture
  - JSON report loading and rendering
  - Log file browsing utilities
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Timestamp format used in log file names and dashboard display.
TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"

#: Timestamp format used in log file names (compact, no spaces).
LOG_FILE_TIMESTAMP_FORMAT = "%Y%m%d-%H%M%S"


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    """Return the repository root (parent of the tools/ directory)."""
    here = Path(__file__).resolve()
    # tools/runbooks/shared/__init__.py → tools/runbooks/shared → tools/runbooks → tools → repo root
    return here.parent.parent.parent.parent


def tools_dir() -> Path:
    return _repo_root() / "tools"


def logs_dir(tool_name: str) -> Path:
    return tools_dir() / "logs" / tool_name


def runbooks_dir() -> Path:
    return tools_dir() / "runbooks"


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------

def load_env_file(tool_name: str) -> dict[str, str]:
    """Load a tools/<tool_name>.env file and return a dict of variables."""
    env_path = tools_dir() / f"{tool_name}.env"
    if not env_path.exists():
        return {}
    result: dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip()
    return result


def check_env_var(name: str, required: bool = True) -> tuple[bool, str]:
    """Check whether an env var is set. Returns (is_ok, message)."""
    val = os.environ.get(name, "").strip()
    if val:
        # Mask secrets: always show at most first 2 + last 2 chars to avoid
        # over-exposing short secrets (≤8 chars show only ***)
        masked = val[:2] + "…" + val[-2:] if len(val) > 8 else "***"
        return True, f"✅ `{name}` = `{masked}`"
    if required:
        return False, f"❌ `{name}` is **not set** (required)"
    return True, f"ℹ️ `{name}` is not set (optional)"


def check_command(cmd: str) -> tuple[bool, str]:
    """Check whether a CLI command is available. Returns (is_ok, message)."""
    result = subprocess.run(
        ["which", cmd],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        path = result.stdout.strip()
        return True, f"✅ `{cmd}` found at `{path}`"
    return False, f"❌ `{cmd}` not found — check your PATH or installation"


def check_python_package(package: str) -> tuple[bool, str]:
    """Check whether a Python package is importable. Returns (is_ok, message)."""
    try:
        import importlib
        importlib.import_module(package.replace("-", "_"))
        return True, f"✅ `{package}` is installed"
    except ImportError:
        return False, f"❌ `{package}` is not installed — run: pip install {package}"


def prerequisites_summary(
    commands: list[str] | None = None,
    packages: list[str] | None = None,
    env_vars: list[tuple[str, bool]] | None = None,
) -> list[tuple[bool, str]]:
    """
    Run all prerequisite checks and return a list of (is_ok, message) tuples.

    Args:
        commands: CLI commands to check (e.g. ["wrangler", "python3"])
        packages: Python packages to check (e.g. ["requests", "rich"])
        env_vars: (name, required) tuples to check
    """
    results: list[tuple[bool, str]] = []
    for cmd in (commands or []):
        results.append(check_command(cmd))
    for pkg in (packages or []):
        results.append(check_python_package(pkg))
    for name, required in (env_vars or []):
        results.append(check_env_var(name, required))
    return results


# ---------------------------------------------------------------------------
# Log file helpers
# ---------------------------------------------------------------------------

def list_log_files(tool_name: str, extension: str = ".json") -> list[Path]:
    """Return a sorted list of log files for a tool (newest first)."""
    log_path = logs_dir(tool_name)
    if not log_path.exists():
        return []
    files = sorted(log_path.glob(f"*{extension}"), reverse=True)
    return files


def load_latest_report(tool_name: str) -> dict[str, Any] | None:
    """Load the most recent JSON report for a tool. Returns None if no reports exist."""
    files = list_log_files(tool_name, ".json")
    if not files:
        return None
    try:
        return json.loads(files[0].read_text())
    except Exception:
        return None


def load_report(path: Path) -> dict[str, Any] | None:
    """Load a specific JSON report. Returns None on parse error."""
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def read_log_file(path: Path, max_lines: int = 500) -> str:
    """Read a log file and return its contents (truncated to max_lines)."""
    try:
        lines = path.read_text().splitlines()
        if len(lines) > max_lines:
            return "\n".join(lines[:max_lines]) + f"\n\n… (truncated — {len(lines) - max_lines} more lines)"
        return "\n".join(lines)
    except Exception as exc:
        return f"[error reading file: {exc}]"


# ---------------------------------------------------------------------------
# Marimo UI rendering helpers
# (These return marimo objects and require `import marimo as mo` to be available)
# ---------------------------------------------------------------------------

def render_status_badge(status: str) -> str:
    """Return an HTML badge string for a status value."""
    colours = {
        "PASS": ("✅", "#d1fae5", "#065f46"),
        "FAIL": ("❌", "#fee2e2", "#991b1b"),
        "WARN": ("⚠️", "#fef3c7", "#92400e"),
        "SKIP": ("⏭️", "#f3f4f6", "#374151"),
        "RUN":  ("🔄", "#e0e7ff", "#3730a3"),
    }
    emoji, bg, fg = colours.get(status.upper(), ("❓", "#f9fafb", "#111827"))
    return (
        f'<span style="background:{bg};color:{fg};padding:2px 8px;'
        f'border-radius:4px;font-weight:600;font-size:0.85em">'
        f"{emoji} {status}</span>"
    )


def render_summary_table_html(summary: dict[str, int]) -> str:
    """Render a summary dict as an HTML table row."""
    passed = summary.get("passed", 0)
    failed = summary.get("failed", 0)
    warnings = summary.get("warnings", 0)
    total = passed + failed + warnings
    return (
        "<table style='border-collapse:collapse;width:100%'>"
        "<tr style='background:#f9fafb'>"
        f"<th style='padding:8px 16px;text-align:left'>Total</th>"
        f"<th style='padding:8px 16px;text-align:left'>Passed</th>"
        f"<th style='padding:8px 16px;text-align:left'>Failed</th>"
        f"<th style='padding:8px 16px;text-align:left'>Warnings</th>"
        "</tr><tr>"
        f"<td style='padding:8px 16px'>{total}</td>"
        f"<td style='padding:8px 16px;color:#065f46;font-weight:600'>{passed}</td>"
        f"<td style='padding:8px 16px;color:#991b1b;font-weight:600'>{failed}</td>"
        f"<td style='padding:8px 16px;color:#92400e;font-weight:600'>{warnings}</td>"
        "</tr></table>"
    )


def render_report_results_html(results: dict[str, dict]) -> str:
    """Render the results dict from a JSON report as an HTML table."""
    rows = []
    for check, info in results.items():
        status = info.get("status", "?")
        detail = info.get("detail", "")
        badge = render_status_badge(status)
        rows.append(
            f"<tr>"
            f"<td style='padding:6px 12px;font-family:monospace;font-size:0.85em'>{check}</td>"
            f"<td style='padding:6px 12px'>{badge}</td>"
            f"<td style='padding:6px 12px;color:#6b7280;font-size:0.85em'>{detail}</td>"
            "</tr>"
        )
    return (
        "<table style='border-collapse:collapse;width:100%;font-size:0.9em'>"
        "<tr style='background:#f9fafb;font-weight:600'>"
        "<th style='padding:6px 12px;text-align:left'>Check</th>"
        "<th style='padding:6px 12px;text-align:left'>Status</th>"
        "<th style='padding:6px 12px;text-align:left'>Detail</th>"
        "</tr>"
        + "".join(rows)
        + "</table>"
    )


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

def run_tool(
    script_path: Path,
    mode: str = "all",
    dry_run: bool = False,
    extra_args: list[str] | None = None,
    env_overrides: dict[str, str] | None = None,
    timeout: int = 300,
) -> tuple[int, str, str]:
    """
    Run a tool script and return (returncode, stdout, stderr).

    Args:
        script_path: Path to the Python script.
        mode: Value for the --mode flag.
        dry_run: If True, passes --dry-run flag.
        extra_args: Additional CLI arguments.
        env_overrides: Additional environment variable overrides.
        timeout: Timeout in seconds.
    """
    cmd = [sys.executable, str(script_path), f"--mode={mode}"]
    if dry_run:
        cmd.append("--dry-run")
    if extra_args:
        cmd.extend(extra_args)

    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=str(_repo_root()),
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"[timeout after {timeout}s]"
    except Exception as exc:
        return -1, "", f"[error: {exc}]"


# ---------------------------------------------------------------------------
# Health dashboard helpers
# ---------------------------------------------------------------------------

KNOWN_TOOLS: list[dict[str, str]] = [
    {
        "name": "auth-healthcheck",
        "label": "Auth Healthcheck",
        "script": "tools/auth-healthcheck.py",
        "description": "End-to-end Better Auth diagnostic — sign-up, sign-in, KV, D1, Neon",
        "runbook": "tools/runbooks/auth-healthcheck.py",
        "docs": "tools/docs/auth-healthcheck/README.md",
    },
    # Future tools — add entries here as they are created
    # {
    #     "name": "db-healthcheck",
    #     "label": "DB Healthcheck",
    #     "script": "tools/db-healthcheck.py",
    #     "description": "Neon / Prisma schema drift, row counts, replication lag",
    #     "runbook": "tools/runbooks/db-healthcheck.py",
    #     "docs": "tools/docs/db-healthcheck/README.md",
    # },
]


def get_tool_last_status(tool_name: str) -> dict[str, Any]:
    """
    Return the last run status for a tool from its most recent JSON report.
    Returns a dict with keys: ran_at, passed, failed, warnings, status.
    """
    report = load_latest_report(tool_name)
    if report is None:
        return {"ran_at": None, "passed": 0, "failed": 0, "warnings": 0, "status": "NEVER_RUN"}

    summary = report.get("summary", {})
    passed = summary.get("passed", 0)
    failed = summary.get("failed", 0)
    warnings = summary.get("warnings", 0)

    if failed > 0:
        overall = "FAIL"
    elif warnings > 0:
        overall = "WARN"
    else:
        overall = "PASS"

    return {
        "ran_at": report.get("timestamp"),
        "passed": passed,
        "failed": failed,
        "warnings": warnings,
        "status": overall,
    }


def all_tools_health_snapshot() -> list[dict[str, Any]]:
    """Return last-run status for all known tools."""
    result = []
    for tool in KNOWN_TOOLS:
        status = get_tool_last_status(tool["name"])
        result.append({**tool, **status})
    return result

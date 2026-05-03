"""
tools/runbooks/auth-healthcheck.py
Interactive Marimo runbook for auth-healthcheck.

Run:
    marimo run tools/runbooks/auth-healthcheck.py
    # or
    deno task runbook:auth-healthcheck

This runbook is entirely self-contained. All documentation, configuration,
execution, log viewing, and AI-sharing utilities are included here.
No external markdown files are needed.
"""

import marimo

__generated_with = "0.23.4"
app = marimo.App(
    width="full",
    app_title="Auth Healthcheck — Bloqr Ops Runbook",
)


@app.cell(hide_code=True)
def _imports():
    import html
    import json
    import os
    import subprocess
    import sys
    import threading
    import time
    from datetime import datetime
    from pathlib import Path

    import marimo as mo

    # Add the runbooks dir to sys.path so shared helpers are importable
    _rb_dir = Path(__file__).resolve().parent
    if str(_rb_dir) not in sys.path:
        sys.path.insert(0, str(_rb_dir))

    from shared import (
        KNOWN_TOOLS,
        _repo_root,
        check_command,
        check_python_package,
        list_log_files,
        load_env_file,
        load_latest_report,
        load_report,
        logs_dir,
        read_log_file,
        render_report_results_html,
        render_status_badge,
        render_summary_table_html,
        run_tool,
        tools_dir,
    )

    return (
        Path,
        check_command,
        check_python_package,
        html,
        json,
        list_log_files,
        load_env_file,
        load_report,
        mo,
        read_log_file,
        render_report_results_html,
        render_summary_table_html,
        run_tool,
        tools_dir,
    )


@app.cell(hide_code=True)
def _header():
    return


@app.cell(hide_code=True)
def _prerequisites(check_command, check_python_package, mo):
    _checks = [
        check_command("wrangler"),
        check_command("python3"),
        check_python_package("requests"),
        check_python_package("rich"),
        check_python_package("psycopg2", pip_name="psycopg2-binary"),
        check_python_package("marimo"),
    ]

    _all_ok = all(ok for ok, _ in _checks)
    _items = [msg for _, msg in _checks]

    _status_line = (
        mo.callout(mo.md("✅ All prerequisites satisfied"), kind="success")
        if _all_ok
        else mo.callout(
            mo.md(
                "⚠️ Some prerequisites are missing. Install them with:\n\n"
                "```bash\n"
                "# From the repo root — uv manages the venv automatically:\n"
                "uv sync --directory tools\n"
                "\n"
                "# Or run this runbook directly via uv (zero-setup):\n"
                "uv run --directory tools marimo run runbooks/auth-healthcheck.py\n"
                "```\n"
                "\n"
                "> **Never use pip or venv manually.** This project uses [uv](https://docs.astral.sh/uv/) exclusively."
            ),
            kind="warn",
        )
    )
    return


@app.cell(hide_code=True)
def _config_loader(load_env_file):
    # env is a cross-cell output — no _ prefix
    env = load_env_file("auth-healthcheck")
    return (env,)


@app.cell(hide_code=True)
def _config_form(env, mo):
    # All of these are cross-cell outputs consumed by _execute — no _ prefix
    api_base = mo.ui.text(
        label="API Base URL",
        value=env.get("API_BASE", "https://api.bloqr.dev/api"),
        placeholder="https://api.bloqr.dev/api",
        full_width=True,
    )
    test_email = mo.ui.text(
        label="Test email (leave blank to auto-generate)",
        value=env.get("TEST_EMAIL", ""),
        placeholder="auto-generated if blank",
        full_width=True,
    )
    neon_url = mo.ui.text(
        label="NEON_URL (PostgreSQL connection string)",
        value=env.get("NEON_URL", ""),
        placeholder="postgresql://user:pass@host.neon.tech/db?sslmode=require",
        full_width=True,
    )
    api_key = mo.ui.text(
        label="BETTER_AUTH_API_KEY (optional — enables admin API check)",
        value=env.get("BETTER_AUTH_API_KEY", ""),
        placeholder="Optional",
        full_width=True,
    )
    enable_tail = mo.ui.checkbox(
        label="Enable wrangler tail (background log capture)",
        value=env.get("ENABLE_TAIL", "true").lower() == "true",
    )
    wrangler_env = mo.ui.text(
        label="Wrangler environment (leave blank for production default)",
        value=env.get("WRANGLER_ENV", ""),
        placeholder="e.g. dev, staging",
        full_width=True,
    )

    _edit_note = mo.md(
        """
        Edit values below to override your `tools/auth-healthcheck.env` configuration.
        Changes here are **not saved** back to the file — they only apply to this run.

        > To persist changes: edit `tools/auth-healthcheck.env` directly.
        """
    )
    return api_base, api_key, enable_tail, neon_url, test_email, wrangler_env


@app.cell(hide_code=True)
def _run_mode(mo):
    # mode and dry_run are cross-cell outputs — no _ prefix
    mode = mo.ui.dropdown(
        label="Run mode",
        options={
            "checks": "🔍 Checks only — run all checks, leave test data in place",
            "all": "🔍🧹 All — run checks then clean up test data (recommended for CI)",
            "cleanup": "🧹 Cleanup — delete test data only, skip checks",
        },
        value="checks",
    )
    dry_run = mo.ui.checkbox(
        label="Dry run — print configuration and exit without making any requests",
        value=False,
    )

    _mode_table = mo.md(
        """
        | Mode | What happens |
        |---|---|
        | **checks** | Runs all 10 checks; leaves test user/session in place |
        | **all** | Runs all checks then deletes test user + session (recommended for CI/pipeline) |
        | **cleanup** | Deletes test data only — useful if a previous run left orphaned data |
        """
    )
    return dry_run, mode


@app.cell(hide_code=True)
def _execute_section():
    return


@app.cell
def _run_button(mo):
    # run_button is a cross-cell output — no _ prefix
    run_button = mo.ui.run_button(label="▶ Run auth-healthcheck")
    return (run_button,)


@app.cell
def _execute(
    api_base,
    api_key,
    dry_run,
    enable_tail,
    mo,
    mode,
    neon_url,
    run_button,
    run_tool,
    test_email,
    tools_dir,
    wrangler_env,
):
    if not run_button.value:
        mo.stop(True, mo.md("_Click **▶ Run auth-healthcheck** to execute._"))

    _script = tools_dir() / "auth-healthcheck.py"
    if not _script.exists():
        mo.stop(True, mo.callout(mo.md(f"❌ Script not found: `{_script}`"), kind="danger"))

    _env_overrides: dict[str, str] = {}
    if api_base.value:
        _env_overrides["API_BASE"] = api_base.value
    if test_email.value:
        _env_overrides["TEST_EMAIL"] = test_email.value
    if neon_url.value:
        _env_overrides["NEON_URL"] = neon_url.value
    if api_key.value:
        _env_overrides["BETTER_AUTH_API_KEY"] = api_key.value
    _env_overrides["ENABLE_TAIL"] = "true" if enable_tail.value else "false"
    if wrangler_env.value:
        _env_overrides["WRANGLER_ENV"] = wrangler_env.value

    with mo.status.spinner(title="Running auth-healthcheck…"):
        _rc, _stdout, _stderr = run_tool(
            script_path=_script,
            mode=mode.value,
            dry_run=dry_run.value,
            env_overrides=_env_overrides,
        )

    _output_combined = _stdout + ("\n\nSTDERR:\n" + _stderr if _stderr.strip() else "")

    _status_badge = "✅ PASSED" if _rc == 0 else "❌ FAILED"
    _callout_kind = "success" if _rc == 0 else "danger"
    _result_callout = mo.callout(
        mo.md(f"**Exit code {_rc}** — {_status_badge}"),
        kind=_callout_kind,
    )

    # returncode and output_combined are cross-cell outputs — no _ prefix
    returncode = _rc
    output_combined = _output_combined
    return (returncode,)


@app.cell(hide_code=True)
def _results_section(mo, returncode):
    if returncode is None:
        mo.stop(True, mo.md("_Run the tool first (step 4) to see results here._"))
    return


@app.cell(hide_code=True)
def _results(
    html,
    json,
    list_log_files,
    load_report,
    mo,
    render_report_results_html,
    render_summary_table_html,
    returncode,
):
    if returncode is None:
        mo.stop(True, None)

    _json_files = list_log_files("auth-healthcheck", ".json")
    if not _json_files:
        mo.stop(
            True,
            mo.callout(
                mo.md(
                    "No JSON report found in `tools/logs/auth-healthcheck/`. "
                    "The script may have exited before writing the report."
                ),
                kind="warn",
            ),
        )

    _latest = _json_files[0]
    _report = load_report(_latest)
    if _report is None:
        mo.stop(
            True,
            mo.callout(mo.md(f"Could not parse `{_latest}`"), kind="danger"),
        )

    _summary = _report.get("summary", {})
    _results_data = _report.get("results", {})
    _errors = _report.get("errors", [])
    _ts = _report.get("timestamp", "?")

    _summary_html = render_summary_table_html(_summary)
    _results_html = render_report_results_html(_results_data)

    _errors_section = ""
    if _errors:
        _error_items = "\n".join(
            f"- `{html.escape(str(e.get('check', '?')), quote=True)}`: {html.escape(str(e.get('detail', '')), quote=True)}"
            for e in _errors
        )
        _errors_section = f"\n### Errors\n\n{_error_items}"

    _raw_json = json.dumps(_report, indent=2)
    return


@app.cell(hide_code=True)
def _log_browser_header():
    return


@app.cell(hide_code=True)
def _log_browser(list_log_files, mo):
    _json_files = list_log_files("auth-healthcheck", ".json")
    _log_files_list = list_log_files("auth-healthcheck", ".log")
    # all_log_files and log_file_selector are cross-cell outputs — no _ prefix
    all_log_files = _json_files + _log_files_list

    if not all_log_files:
        mo.stop(
            True,
            mo.callout(
                mo.md("No log files found yet. Run the tool first (step 4)."),
                kind="neutral",
            ),
        )

    # Keys are full paths (returned by .value); display values are filenames.
    _file_options = {str(f): f.name for f in all_log_files}

    log_file_selector = mo.ui.dropdown(
        label="Select log file",
        options=_file_options,
        value=next(iter(_file_options.keys())) if _file_options else None,
    )
    return all_log_files, log_file_selector


@app.cell(hide_code=True)
def _log_viewer(Path, all_log_files, log_file_selector, mo, read_log_file):
    if not all_log_files:
        mo.stop(True, None)

    _selected_path = Path(log_file_selector.value) if log_file_selector.value else None
    if _selected_path is None or not _selected_path.exists():
        mo.stop(True, mo.md("_Select a file above to view its contents._"))

    _contents = read_log_file(_selected_path)
    _lang = "json" if _selected_path.suffix == ".json" else "text"
    return


@app.cell(hide_code=True)
def _ai_guide():
    return


if __name__ == "__main__":
    app.run()

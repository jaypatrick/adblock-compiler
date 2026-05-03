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

__generated_with = "0.8.0"
app = marimo.App(
    width="full",
    app_title="Auth Healthcheck — Bloqr Ops Runbook",
)


# ── Cell 0: imports (hidden utility cell) ──────────────────────────────────
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
        datetime,
        html,
        json,
        mo,
        os,
        subprocess,
        sys,
        threading,
        time,
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


# ── Cell 1: Header ──────────────────────────────────────────────────────────
@app.cell(hide_code=True)
def _header(mo):
    return mo.md(
        """
        # 🔐 Auth Healthcheck — Interactive Runbook

        **Purpose:** End-to-end production auth diagnostic for the Better Auth / Bloqr stack.
        Validates the full authentication chain from sign-up through session validation,
        then checks every backing store (KV, D1, Neon) and captures wrangler tail logs.

        ---

        ## What This Runbook Does

        | Step | Task |
        |---|---|
        | 1 | Check prerequisites (wrangler, Python packages) |
        | 2 | Load / edit environment configuration |
        | 3 | Select run mode |
        | 4 | Execute `auth-healthcheck.py` with live output |
        | 5 | Display results and JSON report inline |
        | 6 | Browse log files and copy them for AI assistants |

        > **Self-contained:** Everything you need is here. No other documentation required.
        > To run this runbook: `marimo run tools/runbooks/auth-healthcheck.py`
        """
    )


# ── Cell 2: Prerequisites check ─────────────────────────────────────────────
@app.cell(hide_code=True)
def _prerequisites(mo, check_command, check_python_package):
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

    return (
        mo.vstack(
            [
                mo.md("## 1 · Prerequisites"),
                _status_line,
                mo.md("\n".join(f"- {item}" for item in _items)),
            ]
        ),
    )


# ── Cell 3: Configuration ───────────────────────────────────────────────────
@app.cell(hide_code=True)
def _config_loader(mo, load_env_file):
    # env is a cross-cell output — no _ prefix
    env = load_env_file("auth-healthcheck")
    return (mo.md("## 2 · Configuration"), env)


@app.cell(hide_code=True)
def _config_form(mo, env):
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

    return (
        mo.vstack(
            [
                _edit_note,
                mo.hstack([api_base, wrangler_env], gap="1rem"),
                mo.hstack([test_email, api_key], gap="1rem"),
                neon_url,
                enable_tail,
            ]
        ),
        api_base,
        test_email,
        neon_url,
        api_key,
        enable_tail,
        wrangler_env,
    )


# ── Cell 4: Run mode ────────────────────────────────────────────────────────
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

    return (
        mo.vstack([mo.md("## 3 · Run Mode"), mode, dry_run, _mode_table]),
        mode,
        dry_run,
    )


# ── Cell 5: Execute ──────────────────────────────────────────────────────────
@app.cell(hide_code=True)
def _execute_section(mo):
    return mo.md("## 4 · Execute")


@app.cell
def _run_button(mo):
    # run_button is a cross-cell output — no _ prefix
    run_button = mo.ui.run_button(label="▶ Run auth-healthcheck")
    return (run_button,)


@app.cell
def _execute(
    mo,
    run_button,
    mode,
    dry_run,
    api_base,
    test_email,
    neon_url,
    api_key,
    enable_tail,
    wrangler_env,
    Path,
    run_tool,
    tools_dir,
    logs_dir,
    datetime,
    json,
    os,
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

    return (
        mo.vstack(
            [
                _result_callout,
                mo.md("### Output"),
                mo.code(_output_combined, language="text"),
            ]
        ),
        returncode,
        output_combined,
    )


# ── Cell 6: Results / JSON report ───────────────────────────────────────────
@app.cell(hide_code=True)
def _results_section(mo, returncode):
    if returncode is None:
        mo.stop(True, mo.md("_Run the tool first (step 4) to see results here._"))
    return mo.md("## 5 · Results")


@app.cell(hide_code=True)
def _results(
    mo,
    html,
    returncode,
    list_log_files,
    load_report,
    render_report_results_html,
    render_summary_table_html,
    json,
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

    return (
        mo.vstack(
            [
                mo.md(f"**Report:** `{_latest.name}` · **Ran at:** {_ts}"),
                mo.Html(_summary_html),
                mo.md("### Check Details"),
                mo.Html(_results_html),
                mo.md(_errors_section) if _errors_section else mo.md(""),
                mo.accordion(
                    {
                        "📋 Raw JSON report (click to expand)": mo.code(_raw_json, language="json"),
                    }
                ),
            ]
        ),
    )


# ── Cell 7: Log file browser ────────────────────────────────────────────────
@app.cell(hide_code=True)
def _log_browser_header(mo):
    return mo.md(
        """
        ## 6 · Log Files

        Browse log files below. Select a file to view its contents inline.
        Copy the **file path** to share with an AI assistant — paste the path
        and the AI will be able to read the full report.
        """
    )


@app.cell(hide_code=True)
def _log_browser(mo, list_log_files, Path):
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
    return (log_file_selector, all_log_files)


@app.cell(hide_code=True)
def _log_viewer(mo, log_file_selector, all_log_files, read_log_file, Path):
    if not all_log_files:
        mo.stop(True, None)

    _selected_path = Path(log_file_selector.value) if log_file_selector.value else None
    if _selected_path is None or not _selected_path.exists():
        mo.stop(True, mo.md("_Select a file above to view its contents._"))

    _contents = read_log_file(_selected_path)
    _lang = "json" if _selected_path.suffix == ".json" else "text"

    return (
        mo.vstack(
            [
                mo.md(f"**File:** `{_selected_path}`"),
                mo.callout(
                    mo.md(
                        f"📁 **To share with an AI assistant:** Copy the file path below "
                        f"and paste it into your chat, or drag the file from your file manager.\n\n"
                        f"```\n{_selected_path}\n```"
                    ),
                    kind="info",
                ),
                mo.code(_contents, language=_lang),
            ]
        ),
    )


# ── Cell 8: AI assistant guide ──────────────────────────────────────────────
@app.cell(hide_code=True)
def _ai_guide(mo):
    return mo.md(
        """
        ## 7 · Sharing Logs with an AI Assistant

        When auth checks fail, the fastest path to root-cause analysis is to share
        the JSON report with a Copilot or Claude instance.

        ### Option A — Copy the file path

        1. Find the file path in the **Log Files** section above (step 6)
        2. In your AI chat, type: *"Here is the auth-healthcheck report:"*
        3. Drag and drop the `.json` file into the chat

        ### Option B — Paste the JSON directly

        1. Expand the **Raw JSON report** accordion in step 5
        2. Select all (`Cmd+A` / `Ctrl+A`) and copy
        3. Paste into your AI chat with context like:
           *"My auth-healthcheck script produced this report, help me diagnose the failures:"*

        ### Suggested prompts

        - *"Diagnose the failures in this auth-healthcheck report and give me specific fix steps"*
        - *"What does `session.token present FAIL` mean and how do I fix it?"*
        - *"Is the KV binding error related to the D1 error, or are they independent?"*

        ---

        ## 8 · Troubleshooting Quick Reference

        | Symptom | First thing to check |
        |---|---|
        | `GET /api/version` ❌ | Is the worker deployed? Is `API_BASE` correct? VPN? |
        | `session.token present` ❌ | Check `storeSessionInDatabase` and KV binding config |
        | `POST /auth/sign-in` HTTP 500 | See tail log — likely a Prisma or Better Auth crash |
        | `KV accessible` ❌ | Check `KV_BINDING` matches `wrangler.toml` |
        | `D1 execute` ❌ | Check `D1_BINDING` / `D1_ADMIN_BINDING` match `wrangler.toml` |
        | `emailVerified` ⚠️ | Normal if `requireEmailVerification=false` — not a real failure |
        | `Session in Neon` ⚠️ | Normal when `storeSessionInDatabase=false` — sessions in KV |

        ---

        ## 9 · Pipeline Usage

        To chain this tool with others, use the **Master Pipeline runbook**:

        ```bash
        marimo run tools/runbooks/pipeline.py
        # or
        deno task runbook:pipeline
        ```

        Or run directly from CLI:

        ```bash
        python tools/auth-healthcheck.py --mode all
        LATEST=$(ls -t tools/logs/auth-healthcheck/*.json | head -1)
        jq '.summary' "$LATEST"
        ```

        ---

        ## 10 · Re-running and Cleanup

        If a previous run left orphaned test data:

        1. Return to step 3 above
        2. Select **🧹 Cleanup — delete test data only**
        3. Click **▶ Run auth-healthcheck** again

        To run a fresh check with guaranteed clean state:
        1. Select **🔍🧹 All — run checks then clean up**
        2. Click **▶ Run auth-healthcheck**
        """
    )


if __name__ == "__main__":
    app.run()

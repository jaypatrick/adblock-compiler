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
    mo.md(
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
    return


# ── Cell 2: Prerequisites check ─────────────────────────────────────────────
@app.cell(hide_code=True)
def _prerequisites(mo, check_command, check_python_package):
    mo.md("## 1 · Prerequisites")

    checks = [
        check_command("wrangler"),
        check_command("python3"),
        check_python_package("requests"),
        check_python_package("rich"),
        check_python_package("psycopg2"),
        check_python_package("marimo"),
    ]

    all_ok = all(ok for ok, _ in checks)
    items = [msg for _, msg in checks]

    status_line = (
        mo.callout(mo.md("✅ All prerequisites satisfied"), kind="success")
        if all_ok
        else mo.callout(
            mo.md(
                "⚠️ Some prerequisites are missing. Install them with:\n\n"
                "```bash\n"
                "python3 -m venv tools/.venv\n"
                "source tools/.venv/bin/activate\n"
                "pip install -r tools/runbooks/requirements.txt\n"
                "```"
            ),
            kind="warn",
        )
    )

    return (
        mo.vstack([
            status_line,
            mo.md("\n".join(f"- {item}" for item in items)),
        ]),
    )


# ── Cell 3: Configuration ───────────────────────────────────────────────────
@app.cell(hide_code=True)
def _config_loader(mo, load_env_file):
    mo.md("## 2 · Configuration")
    _env = load_env_file("auth-healthcheck")
    return (_env,)


@app.cell(hide_code=True)
def _config_form(mo, _env):
    _api_base = mo.ui.text(
        label="API Base URL",
        value=_env.get("API_BASE", "https://api.bloqr.dev/api"),
        placeholder="https://api.bloqr.dev/api",
        full_width=True,
    )
    _test_email = mo.ui.text(
        label="Test email (leave blank to auto-generate)",
        value=_env.get("TEST_EMAIL", ""),
        placeholder="auto-generated if blank",
        full_width=True,
    )
    _neon_url = mo.ui.text(
        label="NEON_URL (PostgreSQL connection string)",
        value=_env.get("NEON_URL", ""),
        placeholder="postgresql://user:pass@host.neon.tech/db?sslmode=require",
        full_width=True,
    )
    _api_key = mo.ui.text(
        label="BETTER_AUTH_API_KEY (optional — enables admin API check)",
        value=_env.get("BETTER_AUTH_API_KEY", ""),
        placeholder="Optional",
        full_width=True,
    )
    _enable_tail = mo.ui.checkbox(
        label="Enable wrangler tail (background log capture)",
        value=_env.get("ENABLE_TAIL", "true").lower() == "true",
    )
    _wrangler_env = mo.ui.text(
        label="Wrangler environment (leave blank for production default)",
        value=_env.get("WRANGLER_ENV", ""),
        placeholder="e.g. dev, staging",
        full_width=True,
    )

    mo.md(
        """
        Edit values below to override your `tools/auth-healthcheck.env` configuration.
        Changes here are **not saved** back to the file — they only apply to this run.

        > To persist changes: edit `tools/auth-healthcheck.env` directly.
        """
    )

    return (
        mo.vstack([
            mo.hstack([_api_base, _wrangler_env], gap="1rem"),
            mo.hstack([_test_email, _api_key], gap="1rem"),
            _neon_url,
            _enable_tail,
        ]),
        _api_base,
        _test_email,
        _neon_url,
        _api_key,
        _enable_tail,
        _wrangler_env,
    )


# ── Cell 4: Run mode ────────────────────────────────────────────────────────
@app.cell(hide_code=True)
def _run_mode(mo):
    mo.md("## 3 · Run Mode")

    _mode = mo.ui.dropdown(
        label="Run mode",
        options={
            "checks": "🔍 Checks only — run all checks, leave test data in place",
            "all": "🔍🧹 All — run checks then clean up test data (recommended for CI)",
            "cleanup": "🧹 Cleanup — delete test data only, skip checks",
        },
        value="checks",
    )
    _dry_run = mo.ui.checkbox(
        label="Dry run — print configuration and exit without making any requests",
        value=False,
    )

    mo.md(
        """
        | Mode | What happens |
        |---|---|
        | **checks** | Runs all 10 checks; leaves test user/session in place |
        | **all** | Runs all checks then deletes test user + session (recommended for CI/pipeline) |
        | **cleanup** | Deletes test data only — useful if a previous run left orphaned data |
        """
    )

    return (
        mo.vstack([_mode, _dry_run]),
        _mode,
        _dry_run,
    )


# ── Cell 5: Execute ─────────────────────────────────────────────────────────
@app.cell(hide_code=True)
def _execute_section(mo):
    mo.md("## 4 · Execute")
    return


@app.cell
def _run_button(mo):
    _run = mo.ui.run_button(label="▶ Run auth-healthcheck")
    return (_run,)


@app.cell
def _execute(
    mo,
    _run,
    _mode,
    _dry_run,
    _api_base,
    _test_email,
    _neon_url,
    _api_key,
    _enable_tail,
    _wrangler_env,
    Path,
    run_tool,
    tools_dir,
    logs_dir,
    datetime,
    json,
    os,
):
    if not _run.value:
        mo.stop(True, mo.md("_Click **▶ Run auth-healthcheck** to execute._"))

    script = tools_dir() / "auth-healthcheck.py"
    if not script.exists():
        mo.stop(True, mo.callout(mo.md(f"❌ Script not found: `{script}`"), kind="danger"))

    env_overrides: dict[str, str] = {}
    if _api_base.value:
        env_overrides["API_BASE"] = _api_base.value
    if _test_email.value:
        env_overrides["TEST_EMAIL"] = _test_email.value
    if _neon_url.value:
        env_overrides["NEON_URL"] = _neon_url.value
    if _api_key.value:
        env_overrides["BETTER_AUTH_API_KEY"] = _api_key.value
    env_overrides["ENABLE_TAIL"] = "true" if _enable_tail.value else "false"
    if _wrangler_env.value:
        env_overrides["WRANGLER_ENV"] = _wrangler_env.value

    with mo.status.spinner(title="Running auth-healthcheck…"):
        returncode, stdout, stderr = run_tool(
            script_path=script,
            mode=_mode.value,
            dry_run=_dry_run.value,
            env_overrides=env_overrides,
        )

    output_combined = stdout + ("\n\nSTDERR:\n" + stderr if stderr.strip() else "")

    status_badge = "✅ PASSED" if returncode == 0 else "❌ FAILED"
    callout_kind = "success" if returncode == 0 else "danger"
    result_callout = mo.callout(
        mo.md(f"**Exit code {returncode}** — {status_badge}"),
        kind=callout_kind,
    )

    return (
        mo.vstack([
            result_callout,
            mo.md("### Output"),
            mo.code(output_combined, language="text"),
        ]),
        returncode,
        output_combined,
    )


# ── Cell 6: Results / JSON report ───────────────────────────────────────────
@app.cell(hide_code=True)
def _results_section(mo, returncode):
    if returncode is None:
        mo.stop(True, mo.md("_Run the tool first (step 4) to see results here._"))

    mo.md("## 5 · Results")
    return


@app.cell(hide_code=True)
def _results(
    mo,
    returncode,
    list_log_files,
    load_report,
    render_report_results_html,
    render_summary_table_html,
    json,
):
    if returncode is None:
        mo.stop(True, None)

    json_files = list_log_files("auth-healthcheck", ".json")
    if not json_files:
        mo.stop(
            True,
            mo.callout(
                mo.md("No JSON report found in `tools/logs/auth-healthcheck/`. "
                      "The script may have exited before writing the report."),
                kind="warn",
            ),
        )

    latest = json_files[0]
    report = load_report(latest)
    if report is None:
        mo.stop(
            True,
            mo.callout(mo.md(f"Could not parse `{latest}`"), kind="danger"),
        )

    summary = report.get("summary", {})
    results = report.get("results", {})
    errors = report.get("errors", [])
    ts = report.get("timestamp", "?")

    summary_html = render_summary_table_html(summary)
    results_html = render_report_results_html(results)

    errors_section = ""
    if errors:
        error_items = "\n".join(
            f"- **{e.get('check', '?')}**: {e.get('detail', '')}" for e in errors
        )
        errors_section = f"\n### Errors\n\n{error_items}"

    raw_json = json.dumps(report, indent=2)

    return (
        mo.vstack([
            mo.md(f"**Report:** `{latest.name}` · **Ran at:** {ts}"),
            mo.Html(summary_html),
            mo.md("### Check Details"),
            mo.Html(results_html),
            mo.md(errors_section) if errors_section else mo.md(""),
            mo.accordion({
                "📋 Raw JSON report (click to expand)": mo.code(raw_json, language="json"),
            }),
        ]),
    )


# ── Cell 7: Log file browser ────────────────────────────────────────────────
@app.cell(hide_code=True)
def _log_browser_header(mo):
    mo.md(
        """
        ## 6 · Log Files

        Browse log files below. Select a file to view its contents inline.
        Copy the **file path** to share with an AI assistant — paste the path
        and the AI will be able to read the full report.
        """
    )
    return


@app.cell(hide_code=True)
def _log_browser(mo, list_log_files, Path):
    _json_files = list_log_files("auth-healthcheck", ".json")
    _log_files = list_log_files("auth-healthcheck", ".log")
    _all_files = _json_files + _log_files

    if not _all_files:
        mo.stop(
            True,
            mo.callout(
                mo.md("No log files found yet. Run the tool first (step 4)."),
                kind="neutral",
            ),
        )

    _file_options = {str(f.name): str(f) for f in _all_files}

    _file_selector = mo.ui.dropdown(
        label="Select log file",
        options=_file_options,
        value=list(_file_options.keys())[0] if _file_options else None,
    )
    return (_file_selector, _all_files, _file_options)


@app.cell(hide_code=True)
def _log_viewer(mo, _file_selector, _all_files, read_log_file, Path):
    if not _all_files:
        mo.stop(True, None)

    selected_path = Path(_file_selector.value) if _file_selector.value else None
    if selected_path is None or not selected_path.exists():
        mo.stop(True, mo.md("_Select a file above to view its contents._"))

    contents = read_log_file(selected_path)
    lang = "json" if selected_path.suffix == ".json" else "text"

    return (
        mo.vstack([
            mo.md(f"**File:** `{selected_path}`"),
            mo.callout(
                mo.md(
                    f"📁 **To share with an AI assistant:** Copy the file path below "
                    f"and paste it into your chat, or drag the file from your file manager.\n\n"
                    f"```\n{selected_path}\n```"
                ),
                kind="info",
            ),
            mo.code(contents, language=lang),
        ]),
    )


# ── Cell 8: AI assistant guide ──────────────────────────────────────────────
@app.cell(hide_code=True)
def _ai_guide(mo):
    mo.md(
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
    return


if __name__ == "__main__":
    app.run()

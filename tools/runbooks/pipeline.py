"""
tools/runbooks/pipeline.py
Master pipeline / health dashboard Marimo runbook for Bloqr Ops.

Run:
    marimo run tools/runbooks/pipeline.py
    # or
    deno task runbook:pipeline

This runbook is the single entry point for admins. It provides:
  - System-wide health dashboard (last run status for every tool)
  - Tool selector to run any combination of tools in sequence
  - Per-tool flag configuration
  - Pipeline execution with progress tracking
  - Aggregate results summary
  - Log file browser for all tools
  - AI assistant log sharing

No external markdown or documentation is needed — everything is self-contained.
"""

import marimo

__generated_with = "0.8.0"
app = marimo.App(
    width="full",
    app_title="Bloqr Ops — Master Pipeline Runbook",
)


# ── Cell 0: imports (hidden) ────────────────────────────────────────────────
@app.cell(hide_code=True)
def _imports():
    import html
    import json
    import os
    import sys
    import time
    from datetime import datetime
    from pathlib import Path

    import marimo as mo

    _rb_dir = Path(__file__).resolve().parent
    if str(_rb_dir) not in sys.path:
        sys.path.insert(0, str(_rb_dir))

    from shared import (
        KNOWN_TOOLS,
        TIMESTAMP_FORMAT,
        _repo_root,
        all_tools_health_snapshot,
        get_tool_last_status,
        list_log_files,
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
        sys,
        time,
        KNOWN_TOOLS,
        TIMESTAMP_FORMAT,
        _repo_root,
        all_tools_health_snapshot,
        get_tool_last_status,
        list_log_files,
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
        # 🚀 Bloqr Ops — Master Pipeline Runbook

        **Purpose:** System-wide health dashboard and pipeline composer.
        Run any combination of diagnostic tools in sequence and review aggregate results.

        ---

        | Section | What it does |
        |---|---|
        | **Health Dashboard** | Last run status for every tool at a glance |
        | **Pipeline Composer** | Select tools and configure flags |
        | **Execute Pipeline** | Run selected tools in sequence with progress |
        | **Results** | Per-tool results + aggregate summary |
        | **Log Browser** | Browse and share log files for any tool |
        | **Quick Reference** | Pipeline chaining guide, common switches, tips |

        > **Self-contained:** Everything you need is in this runbook.
        > To run: `marimo run tools/runbooks/pipeline.py`
        """
    )
    return


# ── Cell 2: Health dashboard ────────────────────────────────────────────────
@app.cell(hide_code=True)
def _dashboard_header(mo):
    mo.md("## 🏥 System Health Dashboard\n\n_Last-run status for every registered tool._")
    return


@app.cell(hide_code=True)
def _health_dashboard(mo, html, all_tools_health_snapshot, render_status_badge, datetime, TIMESTAMP_FORMAT):
    _snapshot = all_tools_health_snapshot()

    _rows = []
    for _tool in _snapshot:
        _status = _tool.get("status", "NEVER_RUN")
        _badge = render_status_badge(_status if _status != "NEVER_RUN" else "SKIP")
        _ran_at = _tool.get("ran_at") or "—"
        _passed = _tool.get("passed", 0)
        _failed = _tool.get("failed", 0)
        _warnings = _tool.get("warnings", 0)
        _rows.append(
            f"<tr>"
            f"<td style='padding:8px 14px;font-weight:600'>{html.escape(_tool['label'], quote=True)}</td>"
            f"<td style='padding:8px 14px'>{_badge}</td>"
            f"<td style='padding:8px 14px;color:#6b7280;font-size:0.85em'>{html.escape(str(_ran_at), quote=True)}</td>"
            f"<td style='padding:8px 14px;color:#065f46'>{_passed}</td>"
            f"<td style='padding:8px 14px;color:#991b1b'>{_failed}</td>"
            f"<td style='padding:8px 14px;color:#92400e'>{_warnings}</td>"
            f"<td style='padding:8px 14px;color:#4b5563;font-size:0.82em'>{html.escape(_tool.get('description', ''), quote=True)}</td>"
            f"</tr>"
        )

    _table_html = (
        "<table style='border-collapse:collapse;width:100%'>"
        "<tr style='background:#f9fafb;font-weight:600'>"
        "<th style='padding:8px 14px;text-align:left'>Tool</th>"
        "<th style='padding:8px 14px;text-align:left'>Last Status</th>"
        "<th style='padding:8px 14px;text-align:left'>Last Run</th>"
        "<th style='padding:8px 14px;text-align:left'>Pass</th>"
        "<th style='padding:8px 14px;text-align:left'>Fail</th>"
        "<th style='padding:8px 14px;text-align:left'>Warn</th>"
        "<th style='padding:8px 14px;text-align:left'>Description</th>"
        "</tr>" + "".join(_rows) + "</table>"
    )

    _refresh_note = mo.md(f"_Dashboard as of: {datetime.now().strftime(TIMESTAMP_FORMAT)}_")

    return (
        mo.vstack(
            [
                mo.Html(_table_html),
                _refresh_note,
            ]
        ),
    )


# ── Cell 3: Pipeline composer ───────────────────────────────────────────────
@app.cell(hide_code=True)
def _composer_header(mo):
    mo.md(
        """
        ## 🔧 Pipeline Composer

        Select the tools you want to run and configure options for each.
        Tools run in order (top to bottom). A tool failure does **not** stop subsequent tools by default.
        """
    )
    return


@app.cell(hide_code=True)
def _tool_selector(mo, KNOWN_TOOLS):
    _checkboxes = {
        tool["name"]: mo.ui.checkbox(
            label=f"**{tool['label']}** — {tool['description']}",
            value=True,
        )
        for tool in KNOWN_TOOLS
    }

    _mode_selectors = {
        tool["name"]: mo.ui.dropdown(
            label=f"{tool['label']} mode",
            options={
                "checks": "🔍 Checks only",
                "all": "🔍🧹 All (checks + cleanup)",
                "cleanup": "🧹 Cleanup only",
            },
            value="checks",
        )
        for tool in KNOWN_TOOLS
    }

    _dry_run = mo.ui.checkbox(label="🧪 Dry run — print config, make no real requests", value=False)
    _stop_on_failure = mo.ui.checkbox(label="🛑 Stop pipeline on first tool failure", value=False)

    _composer_rows = []
    for _tool in KNOWN_TOOLS:
        _name = _tool["name"]
        _composer_rows.append(
            mo.hstack(
                [
                    _checkboxes[_name],
                    _mode_selectors[_name],
                ],
                gap="2rem",
            )
        )

    return (
        mo.vstack(
            [
                mo.md("### Tools to run"),
                *_composer_rows,
                mo.md("### Pipeline options"),
                mo.hstack([_dry_run, _stop_on_failure], gap="2rem"),
            ]
        ),
        _checkboxes,
        _mode_selectors,
        _dry_run,
        _stop_on_failure,
    )


# ── Cell 4: Execute pipeline ─────────────────────────────────────────────────
@app.cell(hide_code=True)
def _execute_header(mo):
    mo.md("## ▶ Execute Pipeline")
    return


@app.cell
def _pipeline_run_button(mo):
    _run = mo.ui.run_button(label="▶ Run Selected Tools")
    return (_run,)


@app.cell
def _pipeline_execute(
    mo,
    _run,
    _checkboxes,
    _mode_selectors,
    _dry_run,
    _stop_on_failure,
    KNOWN_TOOLS,
    run_tool,
    _repo_root,
    tools_dir,
    datetime,
):
    if not _run.value:
        mo.stop(True, mo.md("_Click **▶ Run Selected Tools** to execute the pipeline._"))

    _selected_tools = [t for t in KNOWN_TOOLS if _checkboxes[t["name"]].value]
    if not _selected_tools:
        mo.stop(
            True,
            mo.callout(mo.md("No tools selected. Check at least one tool in the Pipeline Composer."), kind="warn"),
        )

    pipeline_results: list[dict] = []
    _output_sections = []

    for _tool in _selected_tools:
        _name = _tool["name"]
        _label = _tool["label"]
        _script = _repo_root() / _tool["script"]
        _mode = _mode_selectors[_name].value

        if not _script.exists():
            pipeline_results.append(
                {
                    "name": _name,
                    "label": _label,
                    "returncode": -1,
                    "status": "FAIL",
                    "stdout": "",
                    "stderr": f"Script not found: {_script}",
                }
            )
            _output_sections.append(mo.callout(mo.md(f"❌ `{_name}` — script not found: `{_script}`"), kind="danger"))
            if _stop_on_failure.value:
                break
            continue

        with mo.status.spinner(title=f"Running {_label}…"):
            _returncode, _stdout, _stderr = run_tool(
                script_path=_script,
                mode=_mode,
                dry_run=_dry_run.value,
            )

        _status = "PASS" if _returncode == 0 else "FAIL"
        pipeline_results.append(
            {
                "name": _name,
                "label": _label,
                "returncode": _returncode,
                "status": _status,
                "stdout": _stdout,
                "stderr": _stderr,
            }
        )

        _combined = _stdout + ("\n\nSTDERR:\n" + _stderr if _stderr.strip() else "")
        _callout_kind = "success" if _returncode == 0 else "danger"
        _badge = "✅ PASSED" if _returncode == 0 else "❌ FAILED"
        _output_sections.append(
            mo.accordion(
                {
                    f"{_badge} · {_label} (click to expand output)": mo.vstack(
                        [
                            mo.callout(mo.md(f"Exit code: `{_returncode}`"), kind=_callout_kind),
                            mo.code(_combined, language="text"),
                        ]
                    )
                }
            )
        )

        if _stop_on_failure.value and _returncode != 0:
            _output_sections.append(
                mo.callout(
                    mo.md(f"🛑 Pipeline stopped after **{_label}** failed (stop-on-failure is enabled)."),
                    kind="warn",
                )
            )
            break

    return (
        mo.vstack(_output_sections),
        pipeline_results,
    )


# ── Cell 5: Aggregate results ────────────────────────────────────────────────
@app.cell(hide_code=True)
def _aggregate_header(mo, pipeline_results):
    if not pipeline_results:
        mo.stop(True, mo.md("_Run the pipeline first (step 4) to see aggregate results._"))
    mo.md("## 📊 Aggregate Results")
    return


@app.cell(hide_code=True)
def _aggregate_results(
    mo, pipeline_results, render_status_badge, list_log_files, load_report, render_report_results_html
):
    if not pipeline_results:
        mo.stop(True, None)

    _rows = []
    for _result in pipeline_results:
        _badge = render_status_badge(_result["status"])
        _rows.append(
            f"<tr>"
            f"<td style='padding:8px 14px;font-weight:600'>{_result['label']}</td>"
            f"<td style='padding:8px 14px'>{_badge}</td>"
            f"<td style='padding:8px 14px;font-family:monospace;color:#6b7280'>{_result['returncode']}</td>"
            f"</tr>"
        )

    _summary_html = (
        "<table style='border-collapse:collapse;width:100%'>"
        "<tr style='background:#f9fafb;font-weight:600'>"
        "<th style='padding:8px 14px;text-align:left'>Tool</th>"
        "<th style='padding:8px 14px;text-align:left'>Status</th>"
        "<th style='padding:8px 14px;text-align:left'>Exit Code</th>"
        "</tr>" + "".join(_rows) + "</table>"
    )

    _total = len(pipeline_results)
    _passed = sum(1 for r in pipeline_results if r["status"] == "PASS")
    _failed = _total - _passed
    _overall_badge = render_status_badge("PASS" if _failed == 0 else "FAIL")

    _report_accordions = []
    for _result in pipeline_results:
        _json_files = list_log_files(_result["name"], ".json")
        if _json_files:
            _report = load_report(_json_files[0])
            if _report:
                _results_html = render_report_results_html(_report.get("results", {}))
                _report_accordions.append(
                    mo.accordion({f"📋 {_result['label']} — detailed checks": mo.Html(_results_html)})
                )

    return (
        mo.vstack(
            [
                mo.md(f"**Pipeline complete.** {_overall_badge} — {_passed}/{_total} tools passed"),
                mo.Html(_summary_html),
                *_report_accordions,
            ]
        ),
    )


# ── Cell 6: Cross-tool log browser ──────────────────────────────────────────
@app.cell(hide_code=True)
def _log_browser_header(mo):
    mo.md(
        """
        ## 📂 Log Browser

        Browse and view log files from any tool. Copy the file path to share with
        an AI assistant — no copy-pasting of log contents required.
        """
    )
    return


@app.cell(hide_code=True)
def _log_browser(mo, KNOWN_TOOLS, list_log_files, Path):
    _all_files: dict[str, Path] = {}
    for _tool in KNOWN_TOOLS:
        for _f in list_log_files(_tool["name"], ".json"):
            _all_files[f"{_tool['label']} · {_f.name}"] = _f
        for _f in list_log_files(_tool["name"], ".log"):
            _all_files[f"{_tool['label']} · {_f.name}"] = _f

    if not _all_files:
        mo.stop(
            True,
            mo.callout(mo.md("No log files found yet. Run the pipeline first."), kind="neutral"),
        )

    _file_selector = mo.ui.dropdown(
        label="Select log file",
        options={str(v): k for k, v in _all_files.items()},
        value=str(next(iter(_all_files.values()))) if _all_files else None,
    )
    return (_file_selector, _all_files)


@app.cell(hide_code=True)
def _log_viewer(mo, _file_selector, _all_files, read_log_file, Path):
    if not _all_files:
        mo.stop(True, None)

    selected = Path(_file_selector.value) if _file_selector.value else None
    if selected is None or not selected.exists():
        mo.stop(True, mo.md("_Select a file above to view it._"))

    contents = read_log_file(selected)
    lang = "json" if selected.suffix == ".json" else "text"

    return (
        mo.vstack(
            [
                mo.callout(
                    mo.md(f"📁 **File path for AI sharing:**\n```\n{selected}\n```"),
                    kind="info",
                ),
                mo.code(contents, language=lang),
            ]
        ),
    )


# ── Cell 7: Quick reference ──────────────────────────────────────────────────
@app.cell(hide_code=True)
def _quick_reference(mo):
    mo.md(
        """
        ## 📖 Quick Reference

        ### Pipeline chaining (CLI)

        ```bash
        # Run all tools in sequence — collect exit codes
        python tools/auth-healthcheck.py --mode all
        # ... future: python tools/db-healthcheck.py --mode all
        # ... future: python tools/queue-healthcheck.py --mode all

        # Inspect the latest report for each tool
        jq '.summary' "$(ls -t tools/logs/auth-healthcheck/*.json | head -1)"
        ```

        ### deno task shortcuts

        ```bash
        deno task runbook:auth-healthcheck   # Open auth-healthcheck runbook
        deno task runbook:pipeline           # Open this master pipeline runbook
        deno task runbook:setup              # Install Marimo and runbook dependencies
        ```

        ### Common `--mode` flags

        | Mode | Description |
        |---|---|
        | `checks` | Run all checks, leave test data in place |
        | `all` | Run all checks then clean up (recommended for CI) |
        | `cleanup` | Delete test data only — skip checks |

        ### Adding a new tool to the pipeline

        1. Create the tool script at `tools/<tool-name>.py`
        2. Create per-tool docs at `tools/docs/<tool-name>/README.md`
        3. Create the Marimo runbook at `tools/runbooks/<tool-name>.py`
        4. Add the tool entry to `KNOWN_TOOLS` in `tools/runbooks/shared/__init__.py`
        5. Create the log directory `tools/logs/<tool-name>/` (add `.gitkeep`)
        6. Add `runbook:<tool-name>` task to `deno.json`
        7. Update `docs/tools/README.md` with the new tool
        8. Open a PR using the `.github/PULL_REQUEST_TEMPLATE/tools-runbooks.md` template

        ### Cloudflare web access (future)

        To expose runbooks over the web:

        ```bash
        # Marimo can serve runbooks at a URL
        # Option A: Marimo's built-in HTTPS server (requires auth setup)
        marimo run tools/runbooks/pipeline.py --host 0.0.0.0 --port 8080

        # Option B: Expose via Cloudflare Tunnel (zero-config)
        cloudflared tunnel --url http://localhost:8080

        # Recommended: Gate access with Cloudflare Access policy
        # (tools.bloqr.dev → CF Access → Marimo server)
        ```

        See `docs/tools/README.md` for the full web deployment guide.

        ### Troubleshooting this runbook

        | Problem | Fix |
        |---|---|
        | `ImportError: No module named 'marimo'` | `pip install marimo` |
        | `ImportError: No module named 'shared'` | Run from repo root: `marimo run tools/runbooks/pipeline.py` |
        | Cells show `None` | A dependency cell stopped early — check the cell above it |
        | Dashboard shows all `NEVER_RUN` | No tool has been run yet — run at least one tool first |
        | Script not found | Check that `tools/<tool-name>.py` exists |
        """
    )
    return


if __name__ == "__main__":
    app.run()

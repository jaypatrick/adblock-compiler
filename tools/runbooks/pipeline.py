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

from __future__ import annotations

import marimo

__generated_with = "0.23.4"
app = marimo.App(width="full", app_title="Bloqr Ops — Master Pipeline Runbook")


@app.cell(hide_code=True)
def _imports():
    import html
    import sys
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
        list_log_files,
        load_report,
        read_log_file,
        render_report_results_html,
        render_status_badge,
        run_tool,
    )

    return (
        KNOWN_TOOLS,
        Path,
        TIMESTAMP_FORMAT,
        _repo_root,
        all_tools_health_snapshot,
        datetime,
        html,
        list_log_files,
        load_report,
        mo,
        read_log_file,
        render_report_results_html,
        render_status_badge,
        run_tool,
    )


@app.cell(hide_code=True)
def _header(mo):
    return mo.md("""
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
    """)


@app.cell(hide_code=True)
def _dashboard_header(mo):
    return mo.md("""
    ## 🏥 System Health Dashboard

    _Last-run status for every registered tool._
    """)


@app.cell(hide_code=True)
def _health_dashboard(
    TIMESTAMP_FORMAT,
    all_tools_health_snapshot,
    datetime,
    html,
    mo,
    render_status_badge,
):
    # All variables here are cell-private (_-prefixed) — none are consumed by other cells.
    _snapshot = all_tools_health_snapshot()

    _rows = []
    for _t in _snapshot:
        _st = _t.get("status", "NEVER_RUN")
        _bdg = render_status_badge(_st if _st != "NEVER_RUN" else "SKIP")
        _ran_at = _t.get("ran_at") or "—"
        _passed = _t.get("passed", 0)
        _failed = _t.get("failed", 0)
        _warnings = _t.get("warnings", 0)
        _rows.append(
            f"<tr>"
            f"<td style='padding:8px 14px;font-weight:600'>{html.escape(_t['label'], quote=True)}</td>"
            f"<td style='padding:8px 14px'>{_bdg}</td>"
            f"<td style='padding:8px 14px;color:#6b7280;font-size:0.85em'>{html.escape(str(_ran_at), quote=True)}</td>"
            f"<td style='padding:8px 14px;color:#065f46'>{_passed}</td>"
            f"<td style='padding:8px 14px;color:#991b1b'>{_failed}</td>"
            f"<td style='padding:8px 14px;color:#92400e'>{_warnings}</td>"
            f"<td style='padding:8px 14px;color:#4b5563;font-size:0.82em'>{html.escape(_t.get('description', ''), quote=True)}</td>"
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
    return mo.vstack([mo.Html(_table_html), _refresh_note])


@app.cell(hide_code=True)
def _composer_header(mo):
    return mo.md("""
    ## 🔧 Pipeline Composer

    Select the tools you want to run and configure options for each.
    Tools run in order (top to bottom). A tool failure does **not** stop subsequent tools by default.
    """)


@app.cell(hide_code=True)
def _tool_selector(KNOWN_TOOLS, mo):
    # Cross-cell outputs: tool_checkboxes, tool_mode_selectors, dry_run_flag, stop_on_failure_flag
    # (no _ prefix — these are consumed by _pipeline_execute)
    tool_checkboxes = {
        t["name"]: mo.ui.checkbox(
            label=f"**{t['label']}** — {t['description']}",
            value=True,
        )
        for t in KNOWN_TOOLS
    }

    tool_mode_selectors = {
        t["name"]: mo.ui.dropdown(
            label=f"{t['label']} mode",
            options={
                "checks": "🔍 Checks only",
                "all": "🔍🧹 All (checks + cleanup)",
                "cleanup": "🧹 Cleanup only",
            },
            value="checks",
        )
        for t in KNOWN_TOOLS
    }

    dry_run_flag = mo.ui.checkbox(label="🧪 Dry run — print config, make no real requests", value=False)
    stop_on_failure_flag = mo.ui.checkbox(label="🛑 Stop pipeline on first tool failure", value=False)

    # _composer_rows is local-only — not returned — so _ prefix is correct.
    _composer_rows = []
    for _ct in KNOWN_TOOLS:
        _cn = _ct["name"]
        _composer_rows.append(
            mo.hstack(
                [
                    tool_checkboxes[_cn],
                    tool_mode_selectors[_cn],
                ],
                gap="2rem",
            )
        )
    return (
        dry_run_flag,
        stop_on_failure_flag,
        tool_checkboxes,
        tool_mode_selectors,
    )


@app.cell(hide_code=True)
def _execute_header(mo):
    return mo.md("""
    ## ▶ Execute Pipeline
    """)


@app.cell
def _pipeline_run_button(mo):
    # run_button is a cross-cell output — no _ prefix.
    run_button = mo.ui.run_button(label="▶ Run Selected Tools")
    return (run_button,)


@app.cell
def _pipeline_execute(
    KNOWN_TOOLS,
    _repo_root,
    dry_run_flag,
    mo,
    run_button,
    run_tool,
    stop_on_failure_flag,
    tool_checkboxes,
    tool_mode_selectors,
):
    if not run_button.value:
        mo.stop(True, mo.md("_Click **▶ Run Selected Tools** to execute the pipeline._"))

    _selected_tools = [t for t in KNOWN_TOOLS if tool_checkboxes[t["name"]].value]
    if not _selected_tools:
        mo.stop(
            True,
            mo.callout(mo.md("No tools selected. Check at least one tool in the Pipeline Composer."), kind="warn"),
        )

    # pipeline_results and output_sections are cross-cell outputs — no _ prefix.
    pipeline_results: list[dict] = []
    output_sections = []

    for _pt in _selected_tools:
        _pn = _pt["name"]
        _pl = _pt["label"]
        _ps = _repo_root() / _pt["script"]
        _pm = tool_mode_selectors[_pn].value

        if not _ps.exists():
            pipeline_results.append(
                {
                    "name": _pn,
                    "label": _pl,
                    "returncode": -1,
                    "status": "FAIL",
                    "stdout": "",
                    "stderr": f"Script not found: {_ps}",
                }
            )
            output_sections.append(mo.callout(mo.md(f"❌ `{_pn}` — script not found: `{_ps}`"), kind="danger"))
            if stop_on_failure_flag.value:
                break
            continue

        with mo.status.spinner(title=f"Running {_pl}…"):
            _prc, _pout, _perr = run_tool(
                script_path=_ps,
                mode=_pm,
                dry_run=dry_run_flag.value,
            )

        _pst = "PASS" if _prc == 0 else "FAIL"
        pipeline_results.append(
            {
                "name": _pn,
                "label": _pl,
                "returncode": _prc,
                "status": _pst,
                "stdout": _pout,
                "stderr": _perr,
            }
        )

        _combined = _pout + ("\n\nSTDERR:\n" + _perr if _perr.strip() else "")
        _ck = "success" if _prc == 0 else "danger"
        _pbdg = "✅ PASSED" if _prc == 0 else "❌ FAILED"
        output_sections.append(
            mo.accordion(
                {
                    f"{_pbdg} · {_pl} (click to expand output)": mo.vstack(
                        [
                            mo.callout(mo.md(f"Exit code: `{_prc}`"), kind=_ck),
                            mo.code(_combined, language="text"),
                        ]
                    )
                }
            )
        )

        if stop_on_failure_flag.value and _prc != 0:
            output_sections.append(
                mo.callout(
                    mo.md(f"🛑 Pipeline stopped after **{_pl}** failed (stop-on-failure is enabled)."),
                    kind="warn",
                )
            )
            break
    return pipeline_results, output_sections


@app.cell(hide_code=True)
def _pipeline_output_display(mo, output_sections):
    if not output_sections:
        return
    return mo.vstack(output_sections)


@app.cell(hide_code=True)
def _aggregate_header(mo, pipeline_results: list[dict]):
    if not pipeline_results:
        mo.stop(True, mo.md("_Run the pipeline first (step 4) to see aggregate results._"))
    return mo.md("## 📊 Aggregate Results")


@app.cell(hide_code=True)
def _aggregate_results(
    list_log_files,
    load_report,
    mo,
    pipeline_results: list[dict],
    render_report_results_html,
    render_status_badge,
):
    if not pipeline_results:
        mo.stop(True, None)

    _rows = []
    for _ar in pipeline_results:
        _abdg = render_status_badge(_ar["status"])
        _rows.append(
            f"<tr>"
            f"<td style='padding:8px 14px;font-weight:600'>{_ar['label']}</td>"
            f"<td style='padding:8px 14px'>{_abdg}</td>"
            f"<td style='padding:8px 14px;font-family:monospace;color:#6b7280'>{_ar['returncode']}</td>"
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
    _npassed = sum(1 for r in pipeline_results if r["status"] == "PASS")
    _nfailed = _total - _npassed
    _overall_badge = render_status_badge("PASS" if _nfailed == 0 else "FAIL")

    _report_accordions = []
    for _ar2 in pipeline_results:
        _jfiles = list_log_files(_ar2["name"], ".json")
        if _jfiles:
            _rpt = load_report(_jfiles[0])
            if _rpt:
                _rhtml = render_report_results_html(_rpt.get("results", {}))
                _report_accordions.append(mo.accordion({f"📋 {_ar2['label']} — detailed checks": mo.Html(_rhtml)}))

    _totals_panel = mo.callout(
        mo.md(f"{_overall_badge} &nbsp; **{_npassed}/{_total} passed** &nbsp;·&nbsp; {_nfailed} failed"),
        kind="success" if _nfailed == 0 else "danger",
    )
    return mo.vstack([mo.Html(_summary_html), _totals_panel, *_report_accordions])


@app.cell(hide_code=True)
def _log_browser_header(mo):
    return mo.md("""
    ## 📂 Log Browser

    Browse and view log files from any tool. The selected file path is shown
    below the dropdown so you can copy it and share it with an AI assistant.
    """)


@app.cell(hide_code=True)
def _log_browser(KNOWN_TOOLS, Path, list_log_files, mo):
    # Cross-cell outputs: log_file_selector, all_log_files (no _ prefix)
    all_log_files: dict[str, Path] = {}
    for _lbt in KNOWN_TOOLS:
        for _lbf in list_log_files(_lbt["name"], ".json"):
            all_log_files[f"{_lbt['label']} · {_lbf.name}"] = _lbf
        for _lbf in list_log_files(_lbt["name"], ".log"):
            all_log_files[f"{_lbt['label']} · {_lbf.name}"] = _lbf

    if not all_log_files:
        mo.stop(
            True,
            mo.callout(mo.md("No log files found yet. Run the pipeline first."), kind="neutral"),
        )

    log_file_selector = mo.ui.dropdown(
        label="Select log file",
        options={str(v): k for k, v in all_log_files.items()},
        value=str(next(iter(all_log_files.values()))) if all_log_files else None,
    )
    return all_log_files, log_file_selector


@app.cell(hide_code=True)
def _log_viewer(
    Path,
    all_log_files,  # dict[str, Path] — annotating with Path (another param) causes F821
    log_file_selector,
    mo,
    read_log_file,
):
    if not all_log_files:
        mo.stop(True, None)

    _selected = Path(log_file_selector.value) if log_file_selector.value else None
    if _selected is None or not _selected.exists():
        mo.stop(True, mo.md("_Select a file above to view it._"))

    _contents = read_log_file(_selected)
    _lang = "json" if _selected.suffix == ".json" else "text"
    _path_display = mo.callout(mo.md(f"**Path:** `{_selected}`"), kind="neutral")
    return mo.vstack([_path_display, mo.code(_contents, language=_lang)])


@app.cell(hide_code=True)
def _quick_reference(mo):
    return mo.md("""
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
    | `ImportError: No module named 'marimo'` | `uv sync --directory tools` (run from repo root) |
    | `ImportError: No module named 'shared'` | Run from repo root: `marimo run tools/runbooks/pipeline.py` |
    | Cells show `None` | A dependency cell stopped early — check the cell above it |
    | Dashboard shows all `NEVER_RUN` | No tool has been run yet — run at least one tool first |
    | Script not found | Check that `tools/<tool-name>.py` exists |
    """)


if __name__ == "__main__":
    app.run()

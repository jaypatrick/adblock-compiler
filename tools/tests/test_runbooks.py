"""
tools/tests/test_runbooks.py
Tests for the Bloqr Ops Marimo runbooks.

Run:
    cd tools
    source .venv/bin/activate   # or: pip install -r runbooks/requirements.txt
    pytest tests/ -v

These tests do NOT start Marimo or make network requests.
They validate:
  - Python syntax and importability of each runbook file
  - Shared helper library correctness
  - KNOWN_TOOLS registry integrity
  - Log file utilities
  - Runbook cell structure
"""

from __future__ import annotations

import ast
import importlib
import json
import os
import sys
from pathlib import Path

import pytest

# ── Shared library import ────────────────────────────────────────────────────

try:
    from shared import (
        KNOWN_TOOLS,
        _repo_root,
        all_tools_health_snapshot,
        check_command,
        check_env_var,
        check_python_package,
        get_tool_last_status,
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
    _shared_available = True
except ImportError:
    _shared_available = False

shared_required = pytest.mark.skipif(
    not _shared_available,
    reason="shared library not importable — run from tools/runbooks/ on sys.path",
)


# ── Syntax / importability tests ─────────────────────────────────────────────


class TestRunbookSyntax:
    """Every .py file in tools/runbooks/ must be valid Python."""

    @pytest.fixture(autouse=True)
    def _runbooks_dir(self, runbooks_dir: Path):
        self.runbooks_dir = runbooks_dir

    def _runbook_files(self) -> list[Path]:
        return [
            f for f in self.runbooks_dir.rglob("*.py")
            if "__pycache__" not in str(f)
        ]

    def test_runbook_files_exist(self):
        files = self._runbook_files()
        assert len(files) > 0, "No .py runbook files found"

    @pytest.mark.parametrize(
        "runbook",
        [
            Path("auth-healthcheck.py"),
            Path("pipeline.py"),
            Path("shared/__init__.py"),
        ],
    )
    def test_expected_runbooks_exist(self, runbook: Path):
        assert (self.runbooks_dir / runbook).exists(), (
            f"Expected runbook {runbook} not found in {self.runbooks_dir}"
        )

    def test_auth_healthcheck_valid_python(self):
        src = (self.runbooks_dir / "auth-healthcheck.py").read_text()
        try:
            ast.parse(src)
        except SyntaxError as exc:
            pytest.fail(f"auth-healthcheck.py has a syntax error: {exc}")

    def test_pipeline_valid_python(self):
        src = (self.runbooks_dir / "pipeline.py").read_text()
        try:
            ast.parse(src)
        except SyntaxError as exc:
            pytest.fail(f"pipeline.py has a syntax error: {exc}")

    def test_shared_valid_python(self):
        src = (self.runbooks_dir / "shared/__init__.py").read_text()
        try:
            ast.parse(src)
        except SyntaxError as exc:
            pytest.fail(f"shared/__init__.py has a syntax error: {exc}")

    def test_all_runbooks_valid_python(self):
        for f in self._runbook_files():
            src = f.read_text()
            try:
                ast.parse(src)
            except SyntaxError as exc:
                pytest.fail(f"{f.name} has a syntax error: {exc}")


class TestRunbookStructure:
    """Marimo runbooks must declare `app = marimo.App(...)` and have `@app.cell` cells."""

    @pytest.fixture(autouse=True)
    def _runbooks_dir(self, runbooks_dir: Path):
        self.runbooks_dir = runbooks_dir

    @pytest.mark.parametrize("runbook", ["auth-healthcheck.py", "pipeline.py"])
    def test_marimo_app_declared(self, runbook: str):
        src = (self.runbooks_dir / runbook).read_text()
        assert "marimo.App(" in src, f"{runbook} must declare a marimo.App instance"

    @pytest.mark.parametrize("runbook", ["auth-healthcheck.py", "pipeline.py"])
    def test_app_cell_decorators_present(self, runbook: str):
        src = (self.runbooks_dir / runbook).read_text()
        assert "@app.cell" in src, f"{runbook} must have at least one @app.cell decorator"

    @pytest.mark.parametrize("runbook", ["auth-healthcheck.py", "pipeline.py"])
    def test_main_guard_present(self, runbook: str):
        src = (self.runbooks_dir / runbook).read_text()
        assert 'if __name__ == "__main__"' in src, (
            f"{runbook} must have an `if __name__ == '__main__': app.run()` guard"
        )

    @pytest.mark.parametrize("runbook", ["auth-healthcheck.py", "pipeline.py"])
    def test_imports_shared(self, runbook: str):
        src = (self.runbooks_dir / runbook).read_text()
        assert "from shared import" in src, (
            f"{runbook} must import from the shared helper library"
        )


# ── Shared library tests ──────────────────────────────────────────────────────


@shared_required
class TestSharedRenderHelpers:
    """Unit tests for HTML rendering helpers."""

    def test_render_status_badge_pass(self):
        html = render_status_badge("PASS")
        assert "PASS" in html
        assert "#065f46" in html  # green text colour

    def test_render_status_badge_fail(self):
        html = render_status_badge("FAIL")
        assert "FAIL" in html
        assert "#991b1b" in html  # red text colour

    def test_render_status_badge_warn(self):
        html = render_status_badge("WARN")
        assert "WARN" in html
        assert "#92400e" in html  # amber text colour

    def test_render_status_badge_unknown(self):
        html = render_status_badge("UNKNOWN")
        assert "UNKNOWN" in html  # should still render something

    def test_render_summary_table_html(self):
        html = render_summary_table_html({"passed": 10, "failed": 2, "warnings": 1})
        assert "10" in html
        assert "2" in html
        assert "1" in html
        assert "<table" in html

    def test_render_summary_table_html_zeros(self):
        html = render_summary_table_html({})
        assert "<table" in html

    def test_render_report_results_html_empty(self):
        html = render_report_results_html({})
        assert "<table" in html

    def test_render_report_results_html_with_data(self):
        results = {
            "POST /auth/sign-in/email": {"status": "PASS", "detail": "HTTP 200"},
            "session.token present": {"status": "FAIL", "detail": "missing"},
        }
        html = render_report_results_html(results)
        assert "PASS" in html
        assert "FAIL" in html
        assert "HTTP 200" in html
        assert "missing" in html


@shared_required
class TestSharedEnvHelpers:
    """Unit tests for environment variable helpers."""

    def test_check_env_var_set(self, monkeypatch):
        monkeypatch.setenv("TEST_MY_VAR_BLOQR", "SomeSecretValue1234")
        ok, msg = check_env_var("TEST_MY_VAR_BLOQR", required=True)
        assert ok is True
        assert "✅" in msg
        # Should not leak full value
        assert "SomeSecretValue1234" not in msg

    def test_check_env_var_missing_required(self, monkeypatch):
        monkeypatch.delenv("MISSING_ENV_VAR_BLOQR_TEST", raising=False)
        ok, msg = check_env_var("MISSING_ENV_VAR_BLOQR_TEST", required=True)
        assert ok is False
        assert "❌" in msg
        assert "required" in msg

    def test_check_env_var_missing_optional(self, monkeypatch):
        monkeypatch.delenv("OPTIONAL_ENV_VAR_BLOQR_TEST", raising=False)
        ok, msg = check_env_var("OPTIONAL_ENV_VAR_BLOQR_TEST", required=False)
        assert ok is True
        assert "optional" in msg.lower()

    def test_load_env_file_nonexistent_returns_empty(self, tmp_path, monkeypatch):
        # Point tools_dir to tmp_path so the env file doesn't exist
        # We just test the function handles missing files gracefully
        result = load_env_file("nonexistent-tool-xyzzy")
        assert isinstance(result, dict)
        assert len(result) == 0

    def test_load_env_file_parses_values(self, tmp_path, monkeypatch):
        env_file = tmp_path / "mytool.env"
        env_file.write_text(
            "# comment\nAPI_BASE=https://example.com\nTEST_EMAIL=\nFOO=bar baz\n"
        )
        # Patch tools_dir to use tmp_path
        import shared as _shared
        original = _shared.tools_dir
        _shared.tools_dir = lambda: tmp_path
        try:
            result = load_env_file("mytool")
        finally:
            _shared.tools_dir = original
        assert result.get("API_BASE") == "https://example.com"
        assert result.get("TEST_EMAIL") == ""
        assert result.get("FOO") == "bar baz"


@shared_required
class TestSharedLogHelpers:
    """Unit tests for log file helpers."""

    def test_list_log_files_empty_dir(self, tmp_log_dir: Path, monkeypatch):
        import shared as _shared
        original = _shared.logs_dir
        _shared.logs_dir = lambda name: tmp_log_dir
        try:
            files = list_log_files("auth-healthcheck", ".json")
        finally:
            _shared.logs_dir = original
        assert files == []

    def test_list_log_files_returns_sorted_newest_first(self, tmp_log_dir: Path, monkeypatch):
        # Create some dummy log files
        (tmp_log_dir / "report-001.json").write_text('{"a": 1}')
        (tmp_log_dir / "report-002.json").write_text('{"a": 2}')
        (tmp_log_dir / "report-003.json").write_text('{"a": 3}')

        import shared as _shared
        original = _shared.logs_dir
        _shared.logs_dir = lambda name: tmp_log_dir
        try:
            files = list_log_files("auth-healthcheck", ".json")
        finally:
            _shared.logs_dir = original

        assert len(files) == 3
        names = [f.name for f in files]
        assert names == sorted(names, reverse=True)

    def test_load_report_valid(self, tmp_path: Path):
        report = {"timestamp": "2026-01-01", "summary": {"passed": 5, "failed": 0}}
        report_file = tmp_path / "report.json"
        report_file.write_text(json.dumps(report))
        result = load_report(report_file)
        assert result is not None
        assert result["summary"]["passed"] == 5

    def test_load_report_invalid_json(self, tmp_path: Path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not json {{{")
        result = load_report(bad_file)
        assert result is None

    def test_load_latest_report_no_files(self, monkeypatch):
        import shared as _shared
        original = _shared.logs_dir
        _shared.logs_dir = lambda name: Path("/nonexistent/path/xyzzy")
        try:
            result = load_latest_report("auth-healthcheck")
        finally:
            _shared.logs_dir = original
        assert result is None

    def test_read_log_file_reads_content(self, tmp_path: Path):
        f = tmp_path / "output.log"
        f.write_text("line1\nline2\nline3\n")
        content = read_log_file(f)
        assert "line1" in content
        assert "line2" in content

    def test_read_log_file_truncates_large_file(self, tmp_path: Path):
        f = tmp_path / "big.log"
        f.write_text("\n".join(f"line {i}" for i in range(1000)))
        content = read_log_file(f, max_lines=100)
        assert "truncated" in content.lower()

    def test_read_log_file_missing(self, tmp_path: Path):
        content = read_log_file(tmp_path / "nonexistent.log")
        assert "error" in content.lower()


@shared_required
class TestKnownTools:
    """Validate the KNOWN_TOOLS registry."""

    def test_known_tools_is_list(self):
        assert isinstance(KNOWN_TOOLS, list)
        assert len(KNOWN_TOOLS) > 0, "KNOWN_TOOLS must have at least one entry"

    @pytest.mark.parametrize("required_key", ["name", "label", "script", "description", "runbook", "docs"])
    def test_each_tool_has_required_keys(self, required_key: str):
        for tool in KNOWN_TOOLS:
            assert required_key in tool, (
                f"KNOWN_TOOLS entry '{tool.get('name', '?')}' is missing key '{required_key}'"
            )

    def test_auth_healthcheck_registered(self):
        names = [t["name"] for t in KNOWN_TOOLS]
        assert "auth-healthcheck" in names, "auth-healthcheck must be in KNOWN_TOOLS"

    def test_tool_names_are_kebab_case(self):
        import re
        pattern = re.compile(r"^[a-z][a-z0-9-]*$")
        for tool in KNOWN_TOOLS:
            assert pattern.match(tool["name"]), (
                f"Tool name '{tool['name']}' must be kebab-case (e.g. auth-healthcheck)"
            )

    def test_get_tool_last_status_never_run(self, monkeypatch):
        import shared as _shared
        original = _shared.logs_dir
        _shared.logs_dir = lambda name: Path("/nonexistent/path/xyzzy")
        try:
            result = get_tool_last_status("auth-healthcheck")
        finally:
            _shared.logs_dir = original
        assert result["status"] == "NEVER_RUN"
        assert result["ran_at"] is None

    def test_get_tool_last_status_with_report(self, tmp_path, monkeypatch):
        log_dir = tmp_path / "auth-healthcheck"
        log_dir.mkdir()
        report = {
            "timestamp": "2026-01-01T10:00:00",
            "summary": {"passed": 12, "failed": 0, "warnings": 1},
        }
        (log_dir / "report-001.json").write_text(json.dumps(report))

        import shared as _shared
        original = _shared.logs_dir
        _shared.logs_dir = lambda name: log_dir
        try:
            result = get_tool_last_status("auth-healthcheck")
        finally:
            _shared.logs_dir = original

        assert result["status"] == "WARN"  # has warnings but no failures
        assert result["passed"] == 12
        assert result["warnings"] == 1

    def test_get_tool_last_status_fail(self, tmp_path, monkeypatch):
        log_dir = tmp_path / "auth-healthcheck"
        log_dir.mkdir()
        report = {
            "timestamp": "2026-01-01T10:00:00",
            "summary": {"passed": 5, "failed": 3, "warnings": 0},
        }
        (log_dir / "report-001.json").write_text(json.dumps(report))

        import shared as _shared
        original = _shared.logs_dir
        _shared.logs_dir = lambda name: log_dir
        try:
            result = get_tool_last_status("auth-healthcheck")
        finally:
            _shared.logs_dir = original

        assert result["status"] == "FAIL"

    def test_all_tools_health_snapshot_returns_list(self, monkeypatch):
        import shared as _shared
        original = _shared.logs_dir
        _shared.logs_dir = lambda name: Path("/nonexistent/path/xyzzy")
        try:
            snapshot = all_tools_health_snapshot()
        finally:
            _shared.logs_dir = original
        assert isinstance(snapshot, list)
        assert len(snapshot) == len(KNOWN_TOOLS)


# ── Directory structure tests ─────────────────────────────────────────────────


class TestDirectoryStructure:
    """Validate that required directories and files exist."""

    def test_tools_runbooks_dir_exists(self, runbooks_dir: Path):
        assert runbooks_dir.exists(), f"tools/runbooks/ directory must exist"

    def test_tools_runbooks_shared_exists(self, runbooks_dir: Path):
        assert (runbooks_dir / "shared").exists()
        assert (runbooks_dir / "shared/__init__.py").exists()

    def test_tools_runbooks_requirements_exists(self, runbooks_dir: Path):
        assert (runbooks_dir / "requirements.txt").exists()

    def test_tools_logs_gitkeep(self, logs_dir: Path):
        assert (logs_dir / "auth-healthcheck/.gitkeep").exists(), (
            "tools/logs/auth-healthcheck/.gitkeep must exist to track the log directory"
        )

    def test_tools_docs_auth_healthcheck_readme(self, tools_dir: Path):
        assert (tools_dir / "docs/auth-healthcheck/README.md").exists(), (
            "tools/docs/auth-healthcheck/README.md must exist"
        )

    def test_docs_tools_readme_exists(self, repo_root: Path):
        assert (repo_root / "docs/tools/README.md").exists(), (
            "docs/tools/README.md must exist"
        )

    def test_pr_template_tools_runbooks(self, repo_root: Path):
        assert (repo_root / ".github/PULL_REQUEST_TEMPLATE/tools-runbooks.md").exists(), (
            ".github/PULL_REQUEST_TEMPLATE/tools-runbooks.md must exist"
        )

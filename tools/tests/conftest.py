"""
tools/tests/conftest.py
Shared pytest fixtures for runbook tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest


# Make the runbooks/shared package importable from tests
_runbooks_dir = Path(__file__).resolve().parent.parent / "runbooks"
if str(_runbooks_dir) not in sys.path:
    sys.path.insert(0, str(_runbooks_dir))


@pytest.fixture()
def repo_root() -> Path:
    """Return the repository root directory."""
    # tools/tests/conftest.py → tools/tests → tools → repo root
    return Path(__file__).resolve().parent.parent.parent


@pytest.fixture()
def tools_dir(repo_root: Path) -> Path:
    return repo_root / "tools"


@pytest.fixture()
def runbooks_dir(tools_dir: Path) -> Path:
    return tools_dir / "runbooks"


@pytest.fixture()
def logs_dir(tools_dir: Path) -> Path:
    return tools_dir / "logs"


@pytest.fixture()
def tmp_log_dir(tmp_path: Path) -> Path:
    """A temporary log directory for tests that write log files."""
    d = tmp_path / "logs" / "auth-healthcheck"
    d.mkdir(parents=True)
    return d

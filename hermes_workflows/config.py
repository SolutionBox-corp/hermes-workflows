"""Resolve user-owned storage paths. Everything lives under the Hermes home
(``~/.hermes`` by default, override with ``HERMES_HOME``). The runtime board is
where agent_task Kanban cards are created."""

from __future__ import annotations

import os
from pathlib import Path


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))


def workflows_dir() -> Path:
    return hermes_home() / "workflows"


def global_workflows_dir() -> Path:
    return workflows_dir() / "global"


def templates_dir() -> Path:
    return workflows_dir() / "templates"


def runs_db_path() -> Path:
    return workflows_dir() / "runs.db"


def runs_artifacts_dir() -> Path:
    return workflows_dir() / "runs"


def runtime_board() -> str:
    """Kanban board agent_task cards are created on."""
    return os.environ.get("HERMES_WORKFLOWS_BOARD", "hermes-workflows")

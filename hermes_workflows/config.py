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


def runner_dir() -> Path:
    """Where profile runners live (``<profile>`` executables). Used by the
    DirectExecutor to run global, unbound workflow nodes."""
    return Path(os.environ.get("HERMES_AGENT_RUNNERS", str(hermes_home() / "bin" / "agents")))


def direct_store_dir() -> Path:
    """Completion store for global (no-board) node runs."""
    return workflows_dir() / "direct"


def default_deliver() -> str | None:
    """Fallback Hermes delivery target for run lifecycle notifications when a run
    has no captured origin. ``None`` means deliver nowhere by default."""
    return os.environ.get("HERMES_WORKFLOWS_DELIVER") or None


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def command_path() -> Path:
    """Absolute path to the ``hermes-workflows`` entrypoint that cron shims exec.
    Prefers the installed symlink, falls back to the in-repo wrapper."""
    override = os.environ.get("HERMES_WORKFLOWS_BIN")
    if override:
        return Path(override)
    installed = hermes_home() / "bin" / "hermes-workflows"
    if installed.exists():
        return installed
    return repo_root() / "bin" / "hermes-workflows"


def scripts_dir() -> Path:
    """Hermes cron only runs scripts living under ``HERMES_HOME/scripts``."""
    return hermes_home() / "scripts"


def core_cli() -> list[str]:
    """Argv prefix to invoke the TypeScript core CLI."""
    return ["bun", "run", str(repo_root() / "packages" / "core" / "src" / "cli.ts")]


def spec_roots() -> list[str]:
    return [str(global_workflows_dir()), str(templates_dir())]

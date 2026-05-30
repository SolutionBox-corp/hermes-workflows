"""P5.1 — per-project board resolution: project scope resolves and auto-ensures
the project's board; global scope has none.
"""

from __future__ import annotations

from pathlib import Path

import pytest

kb = pytest.importorskip("hermes_cli.kanban_db")

from hermes_workflows.bridge import boards


@pytest.fixture(autouse=True)
def kanban_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "kanban-home"
    monkeypatch.setenv("HERMES_KANBAN_HOME", str(home))
    return home


def test_global_scope_has_no_board() -> None:
    assert boards.resolve_board({"type": "global"}) is None


def test_project_scope_resolves_and_creates_board() -> None:
    slug = boards.resolve_board({"type": "project", "projects": ["acme"]})
    assert slug == "acme"
    assert kb.board_exists("acme")


def test_projects_scope_uses_first_declared_project() -> None:
    slug = boards.resolve_board({"type": "projects", "projects": ["alpha", "beta"]})
    assert slug == "alpha"
    assert kb.board_exists("alpha")


def test_run_project_id_overrides_scope_projects() -> None:
    slug = boards.resolve_board(
        {"type": "projects", "projects": ["alpha", "beta"]}, project_id="chosen"
    )
    assert slug == "chosen"
    assert kb.board_exists("chosen")


def test_project_scope_without_a_project_is_none() -> None:
    assert boards.resolve_board({"type": "project", "projects": []}) is None


def test_ensure_board_is_idempotent() -> None:
    assert boards.ensure_board("repeat") == "repeat"
    assert boards.ensure_board("repeat") == "repeat"
    assert kb.board_exists("repeat")

"""P3.1 — advance_all advances every active run in one pass and skips terminal
runs, resolving each run's spec by workflow id across the configured roots.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

kb = pytest.importorskip("hermes_cli.kanban_db")

from hermes_workflows.engine import Engine
from hermes_workflows.executor import KanbanExecutor

ROOT = Path(__file__).resolve().parents[2]
CLI = ["bun", "run", str(ROOT / "packages" / "core" / "src" / "cli.ts")]
SPEC = ROOT / "examples" / "feature-development.workflow.yaml"
ROOTS = [str(ROOT / "examples")]


@pytest.fixture()
def engine(tmp_path: Path):
    board = kb.connect(db_path=tmp_path / "kanban.db")
    eng = Engine(
        core_cli=CLI, db_path=str(tmp_path / "runs.db"), kanban=KanbanExecutor(board)
    )
    yield eng
    board.close()


def _complete(board: sqlite3.Connection, task_id: str) -> None:
    board.execute("UPDATE tasks SET status = 'done' WHERE id = ?", (task_id,))
    board.execute(
        "INSERT INTO task_runs (task_id, status, outcome, summary, started_at, ended_at) "
        "VALUES (?, 'done', 'completed', 'ok', 1, 2)",
        (task_id,),
    )
    board.commit()


def test_advance_all_advances_every_active_run(engine: Engine) -> None:
    a = engine.run(str(SPEC), "run-a")
    engine.run(str(SPEC), "run-b")
    _complete(engine.kanban.board_conn, a["nodes"]["plan"]["hermes_task_id"])

    advanced = engine.advance_all(ROOTS)

    assert {r["run_id"] for r in advanced} == {"run-a", "run-b"}
    # run-a's plan was completed, so it moved on; run-b is untouched at plan.
    assert engine.status("run-a")["nodes"]["implement"]["status"] == "scheduled"
    assert engine.status("run-b")["nodes"]["plan"]["status"] == "scheduled"


def test_advance_all_skips_terminal_runs(engine: Engine) -> None:
    engine.run(str(SPEC), "run-active")
    engine.run(str(SPEC), "run-old")
    old = engine.status("run-old")
    old["status"] = "completed"
    engine._save(old)

    advanced = engine.advance_all(ROOTS)

    ids = {r["run_id"] for r in advanced}
    assert "run-active" in ids
    assert "run-old" not in ids

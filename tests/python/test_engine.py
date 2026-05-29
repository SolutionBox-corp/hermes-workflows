"""E4.3 + E4.5 — the Python orchestrator drives a durable run end to end:
run -> (worker completes Kanban task) -> advance -> ... -> finish, including the
fix loop and idempotent ticks. Uses the real Bun core CLI and a temp board.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

kb = pytest.importorskip("hermes_cli.kanban_db")

from hermes_workflows.engine import Engine

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "packages" / "core" / "src" / "cli.ts"
SPEC = ROOT / "examples" / "feature-development.workflow.yaml"


@pytest.fixture()
def engine(tmp_path: Path):
    board = kb.connect(db_path=tmp_path / "kanban.db")
    eng = Engine(
        core_cli=["bun", "run", str(CLI)],
        db_path=str(tmp_path / "runs.db"),
        board_conn=board,
    )
    yield eng
    board.close()


def _complete(board: sqlite3.Connection, task_id: str, outcome: str = "completed") -> None:
    board.execute("UPDATE tasks SET status = 'done' WHERE id = ?", (task_id,))
    board.execute(
        "INSERT INTO task_runs (task_id, status, outcome, summary, started_at, ended_at) "
        "VALUES (?, 'done', ?, 'ok', 1, 2)",
        (task_id, outcome),
    )
    board.commit()


def _node(run: dict, node_id: str) -> dict:
    return run["nodes"][node_id]


def test_run_schedules_the_entry_node(engine: Engine) -> None:
    run = engine.run(str(SPEC), "run-1")
    assert run["status"] == "running"
    assert _node(run, "plan")["status"] == "scheduled"
    assert _node(run, "plan")["hermes_task_id"]


def test_idempotent_tick_creates_no_duplicate(engine: Engine) -> None:
    engine.run(str(SPEC), "run-1")
    task_id = engine.status("run-1")["nodes"]["plan"]["hermes_task_id"]
    again = engine.advance(str(SPEC), "run-1")
    assert _node(again, "plan")["hermes_task_id"] == task_id  # same card, no duplicate


def test_full_happy_path_to_finish(engine: Engine) -> None:
    run = engine.run(str(SPEC), "run-1")

    # plan -> implement -> validate
    for step in ("plan", "implement", "validate"):
        _complete(engine.board_conn, _node(run, step)["hermes_task_id"])
        run = engine.advance(str(SPEC), "run-1")

    # validate succeeded -> human review is waiting
    assert run["status"] == "waiting"
    assert _node(run, "review")["status"] == "waiting_for_review"

    run = engine.decide_review(str(SPEC), "run-1", "review", "approved")
    assert _node(run, "release_notes")["status"] == "scheduled"

    _complete(engine.board_conn, _node(run, "release_notes")["hermes_task_id"])
    run = engine.advance(str(SPEC), "run-1")
    assert run["status"] == "completed"


def test_fix_loop_reruns_validate(engine: Engine) -> None:
    run = engine.run(str(SPEC), "run-1")
    for step in ("plan", "implement"):
        _complete(engine.board_conn, _node(run, step)["hermes_task_id"])
        run = engine.advance(str(SPEC), "run-1")

    # validate fails -> fix is scheduled
    _complete(engine.board_conn, _node(run, "validate")["hermes_task_id"], outcome="crashed")
    run = engine.advance(str(SPEC), "run-1")
    assert _node(run, "fix")["status"] == "scheduled"
    first_validate_task = _node(run, "validate")["hermes_task_id"]

    # fix completes -> validate re-runs on a fresh card
    _complete(engine.board_conn, _node(run, "fix")["hermes_task_id"])
    run = engine.advance(str(SPEC), "run-1")
    assert _node(run, "validate")["status"] == "scheduled"
    assert _node(run, "validate")["hermes_task_id"] != first_validate_task

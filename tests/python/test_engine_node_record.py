"""Engine-side bookkeeping for the node audit record: per-node timestamps, and
carrying a step's stderr and its declared record onto node state.

Both are unit-level on purpose. The timestamps hang off the pre-step status
snapshot, which is shared with the trace writer, and the sharing is exactly the
thing that could regress silently: an earlier design took that snapshot only
when tracing was enabled, which would have made every duration depend on an
unrelated opt-in setting.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

kb = pytest.importorskip("hermes_cli.kanban_db")

from hermes_workflows.engine import Engine
from hermes_workflows.executor import Completion, KanbanExecutor

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "packages" / "core" / "src" / "cli.ts"


def _engine(tmp_path: Path) -> Engine:
    board: sqlite3.Connection = kb.connect(db_path=tmp_path / "kanban.db")
    return Engine(
        core_cli=["bun", "run", str(CLI)],
        db_path=str(tmp_path / "runs.db"),
        kanban=KanbanExecutor(board),
    )


def _snapshot(statuses: dict) -> dict:
    return {"statuses": statuses, "run_status": "running", "notified": set()}


# --- timestamps ----------------------------------------------------------


def test_becoming_active_stamps_a_start(tmp_path) -> None:
    engine = _engine(tmp_path)
    run = {"run_id": "r", "nodes": {"a": {"status": "scheduled"}}}

    engine._stamp_node_times(_snapshot({"a": "pending"}), run, now=1000)

    assert run["nodes"]["a"]["started_at"] == 1000
    assert "finished_at" not in run["nodes"]["a"]


def test_settling_stamps_a_finish(tmp_path) -> None:
    engine = _engine(tmp_path)
    run = {"run_id": "r", "nodes": {"a": {"status": "completed", "started_at": 1000}}}

    engine._stamp_node_times(_snapshot({"a": "running"}), run, now=1300)

    assert run["nodes"]["a"]["finished_at"] == 1300


def test_a_start_is_never_overwritten(tmp_path) -> None:
    """scheduled -> running is a second activation transition, and a retried node
    re-enters scheduled outright. Keeping the first activation makes the pair a
    truthful outer bound rather than a measure of the last attempt only."""
    engine = _engine(tmp_path)
    run = {"run_id": "r", "nodes": {"a": {"status": "running", "started_at": 1000}}}

    engine._stamp_node_times(_snapshot({"a": "scheduled"}), run, now=1200)

    assert run["nodes"]["a"]["started_at"] == 1000


def test_an_unchanged_node_is_not_stamped(tmp_path) -> None:
    engine = _engine(tmp_path)
    run = {"run_id": "r", "nodes": {"a": {"status": "pending"}}}

    engine._stamp_node_times(_snapshot({"a": "pending"}), run, now=1000)

    assert "started_at" not in run["nodes"]["a"]
    assert "finished_at" not in run["nodes"]["a"]


@pytest.mark.parametrize("terminal", ["completed", "failed", "skipped", "cancelled"])
def test_every_terminal_status_stamps_a_finish(tmp_path, terminal) -> None:
    engine = _engine(tmp_path)
    run = {"run_id": "r", "nodes": {"a": {"status": terminal}}}

    engine._stamp_node_times(_snapshot({"a": "running"}), run, now=1300)

    assert run["nodes"]["a"]["finished_at"] == 1300


def test_a_node_absent_from_the_snapshot_still_stamps(tmp_path) -> None:
    """A node added to the run during the step has no `before`; it is still a
    transition into an active state."""
    engine = _engine(tmp_path)
    run = {"run_id": "r", "nodes": {"new": {"status": "scheduled"}}}

    engine._stamp_node_times(_snapshot({}), run, now=1000)

    assert run["nodes"]["new"]["started_at"] == 1000


# --- stderr and record ---------------------------------------------------


def test_a_settled_step_carries_its_stderr_and_record(tmp_path) -> None:
    engine = _engine(tmp_path)
    node: dict = {"status": "completed"}

    engine._apply_step_record(
        node,
        [Completion(settled=True, outcome="success", output="done", stderr="diag",
                    record={"headline": "ok"})],
    )

    assert node["stderr"] == "diag"
    assert node["record"] == {"headline": "ok"}


def test_a_step_with_neither_leaves_the_node_clean(tmp_path) -> None:
    engine = _engine(tmp_path)
    node: dict = {"status": "completed"}

    engine._apply_step_record(node, [Completion(settled=True, outcome="success", output="done")])

    assert "stderr" not in node
    assert "record" not in node


def test_the_last_completion_that_has_one_wins(tmp_path) -> None:
    """A batch node has several completions; the most recent one carrying a
    record is the attempt whose evidence is on disk."""
    engine = _engine(tmp_path)
    node: dict = {"status": "completed"}

    engine._apply_step_record(
        node,
        [
            Completion(settled=True, outcome="success", record={"headline": "first"}),
            Completion(settled=True, outcome="success", record={"headline": "second"}),
        ],
    )

    assert node["record"] == {"headline": "second"}


def test_a_completion_without_a_record_does_not_erase_an_earlier_one(tmp_path) -> None:
    engine = _engine(tmp_path)
    node: dict = {"status": "completed"}

    engine._apply_step_record(
        node,
        [
            Completion(settled=True, outcome="success", record={"headline": "kept"}),
            Completion(settled=True, outcome="success"),
        ],
    )

    assert node["record"] == {"headline": "kept"}

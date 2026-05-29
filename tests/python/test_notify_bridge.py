"""E3.6 — subscribe the originating chat to terminal-state notifications so
human_review and run completion close the loop via the native kanban-notifier."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

kb = pytest.importorskip("hermes_cli.kanban_db")

from hermes_workflows.bridge import notify


@pytest.fixture()
def conn(tmp_path: Path) -> sqlite3.Connection:
    connection = kb.connect(db_path=tmp_path / "kanban.db")
    yield connection
    connection.close()


def test_subscribe_creates_a_row(conn: sqlite3.Connection) -> None:
    task = kb.create_task(conn, title="review", assignee="dev")
    notify.subscribe_completion(
        conn, task_id=task, platform="telegram", chat_id="-100", thread_id="156"
    )
    row = conn.execute(
        "SELECT platform, chat_id, thread_id FROM kanban_notify_subs WHERE task_id = ?",
        (task,),
    ).fetchone()
    assert row["platform"] == "telegram"
    assert row["chat_id"] == "-100"
    assert row["thread_id"] == "156"


def test_subscribe_is_idempotent(conn: sqlite3.Connection) -> None:
    task = kb.create_task(conn, title="review", assignee="dev")
    notify.subscribe_completion(conn, task_id=task, platform="telegram", chat_id="-100", thread_id="156")
    notify.subscribe_completion(conn, task_id=task, platform="telegram", chat_id="-100", thread_id="156")
    rows = conn.execute(
        "SELECT 1 FROM kanban_notify_subs WHERE task_id = ?", (task,)
    ).fetchall()
    assert len(rows) == 1

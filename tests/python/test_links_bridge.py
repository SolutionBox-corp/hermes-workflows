"""E3.3 — express sequential workflow edges as native Kanban task_links."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

kb = pytest.importorskip("hermes_cli.kanban_db")

from hermes_workflows.bridge import links


@pytest.fixture()
def conn(tmp_path: Path) -> sqlite3.Connection:
    connection = kb.connect(db_path=tmp_path / "kanban.db")
    yield connection
    connection.close()


def _task(conn: sqlite3.Connection, title: str) -> str:
    return kb.create_task(conn, title=title, assignee="dev")


def test_link_creates_dependency(conn: sqlite3.Connection) -> None:
    parent = _task(conn, "plan")
    child = _task(conn, "implement")
    links.link_nodes(conn, parent, child)
    rows = conn.execute(
        "SELECT 1 FROM task_links WHERE parent_id = ? AND child_id = ?", (parent, child)
    ).fetchall()
    assert len(rows) == 1


def test_link_is_idempotent(conn: sqlite3.Connection) -> None:
    parent = _task(conn, "plan")
    child = _task(conn, "implement")
    links.link_nodes(conn, parent, child)
    links.link_nodes(conn, parent, child)
    rows = conn.execute(
        "SELECT 1 FROM task_links WHERE parent_id = ? AND child_id = ?", (parent, child)
    ).fetchall()
    assert len(rows) == 1


def test_self_link_raises(conn: sqlite3.Connection) -> None:
    task = _task(conn, "solo")
    with pytest.raises(ValueError):
        links.link_nodes(conn, task, task)

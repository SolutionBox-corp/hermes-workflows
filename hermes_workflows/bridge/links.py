"""Express sequential workflow edges as native Kanban task_links so the
dispatcher and dashboard understand task ordering. Delegates to the native,
cycle-checked, idempotent ``kanban_db.link_tasks``."""

from __future__ import annotations

import sqlite3

from hermes_cli import kanban_db as kb


def link_nodes(conn: sqlite3.Connection, parent_task_id: str, child_task_id: str) -> None:
    """Record that ``child_task_id`` depends on ``parent_task_id``."""
    kb.link_tasks(conn, parent_task_id, child_task_id)

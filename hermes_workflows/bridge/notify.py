"""Subscribe the originating chat (platform + chat + thread) to a task's
terminal-state events. The gateway's native kanban-notifier delivers
``completed`` / ``blocked`` notices, so human_review prompts and run completion
close the loop without a custom notifier."""

from __future__ import annotations

import sqlite3
from typing import Optional

from hermes_cli import kanban_db as kb


def subscribe_completion(
    conn: sqlite3.Connection,
    *,
    task_id: str,
    platform: str,
    chat_id: str,
    thread_id: Optional[str] = None,
    notifier_profile: Optional[str] = None,
) -> None:
    kb.add_notify_sub(
        conn,
        task_id=task_id,
        platform=platform,
        chat_id=chat_id,
        thread_id=thread_id,
        notifier_profile=notifier_profile,
    )

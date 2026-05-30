"""P1.1 — the executor seam: schedule/poll protocol and scope-based selection."""

from __future__ import annotations

import pytest

from hermes_workflows.executor import Completion, select_executor


class _StubExecutor:
    def __init__(self, label: str) -> None:
        self.label = label

    def schedule(self, **_kwargs) -> str:
        return self.label

    def poll(self, _handle: str) -> Completion:
        return Completion(settled=False)


def test_project_scope_selects_kanban() -> None:
    kanban, direct = _StubExecutor("kanban"), _StubExecutor("direct")
    assert select_executor("project", kanban=kanban, direct=direct) is kanban
    assert select_executor("projects", kanban=kanban, direct=direct) is kanban


def test_global_scope_selects_direct() -> None:
    kanban, direct = _StubExecutor("kanban"), _StubExecutor("direct")
    assert select_executor("global", kanban=kanban, direct=direct) is direct


def test_unknown_scope_raises() -> None:
    kanban, direct = _StubExecutor("kanban"), _StubExecutor("direct")
    with pytest.raises(ValueError):
        select_executor("nope", kanban=kanban, direct=direct)


def test_completion_defaults() -> None:
    c = Completion(settled=True, outcome="success", output="ok")
    assert (c.settled, c.outcome, c.output) == (True, "success", "ok")
    assert Completion(settled=False).outcome is None

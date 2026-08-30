"""Dashboard review route: resolving a human_review gate, with the operator's
note.

The note matters beyond bookkeeping. `needs_changes` without one sends a run
back to a step that will read the identical instructions and produce the
identical output; the note is the only thing that makes the loop mean anything.
`tools.review_workflow` has always accepted it — the HTTP route did not pass it
on, so the dashboard could never send one.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
PLUGIN_API = ROOT / "dashboard" / "plugin_api.py"


def _client(monkeypatch, captured: dict, *, raises: Exception | None = None):
    spec = importlib.util.spec_from_file_location("hw_review_routes", PLUGIN_API)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def fake_review(run_id, node_id, decision, **kwargs):
        captured.update(
            run_id=run_id, node_id=node_id, decision=decision, note=kwargs.get("note")
        )
        if raises is not None:
            raise raises
        return {"run_id": run_id, "status": "running", "decision": decision}

    import hermes_workflows.tools as tools
    import hermes_workflows.cli as cli

    monkeypatch.setattr(tools, "review_workflow", fake_review)
    monkeypatch.setattr(cli, "build_engine", lambda: object())

    app = FastAPI()
    app.include_router(module.router)
    return TestClient(app)


def test_note_reaches_the_resolver(monkeypatch):
    captured: dict = {}
    client = _client(monkeypatch, captured)

    response = client.post(
        "/runs/run-1/review",
        json={"node_id": "gate", "decision": "needs_changes", "note": "zúžit rozsah"},
    )

    assert response.status_code == 200
    assert captured["note"] == "zúžit rozsah"
    assert captured["decision"] == "needs_changes"


def test_note_is_optional(monkeypatch):
    """The route predates the note, and every existing caller omits it."""
    captured: dict = {}
    client = _client(monkeypatch, captured)

    response = client.post(
        "/runs/run-1/review", json={"node_id": "gate", "decision": "approved"}
    )

    assert response.status_code == 200
    assert captured["note"] is None


def test_blank_note_is_sent_as_none(monkeypatch):
    """An empty textarea must not be stored as an empty note: downstream a
    present-but-empty review_note reads as "the reviewer said nothing", which is
    not the same as "the reviewer wrote nothing"."""
    captured: dict = {}
    client = _client(monkeypatch, captured)

    client.post(
        "/runs/run-1/review",
        json={"node_id": "gate", "decision": "approved", "note": "   "},
    )

    assert captured["note"] is None


def test_invalid_decision_is_a_400(monkeypatch):
    captured: dict = {}
    client = _client(monkeypatch, captured, raises=ValueError("unknown decision"))

    response = client.post(
        "/runs/run-1/review", json={"node_id": "gate", "decision": "maybe"}
    )

    assert response.status_code == 400
    assert "unknown decision" in response.json()["detail"]

"""T7 — dashboard run routes: start a run, inspect it, cancel and retry, against
a temp Hermes home with a real runtime board. Skipped without fastapi/kanban."""

from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("hermes_cli.kanban_db")
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
PLUGIN_API = ROOT / "dashboard" / "plugin_api.py"
SPEC = ROOT / "examples" / "feature-development.workflow.yaml"


def _load_router():
    spec = importlib.util.spec_from_file_location("hw_dashboard_api_run", PLUGIN_API)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    home = tmp_path / "home"
    (home / "workflows" / "global").mkdir(parents=True)
    shutil.copy(SPEC, home / "workflows" / "global" / "feature-development.workflow.yaml")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_KANBAN_DB", str(tmp_path / "kanban.db"))

    app = FastAPI()
    app.include_router(_load_router().router)
    return TestClient(app)


def _start_run(client: TestClient) -> str:
    resp = client.post("/workflows/feature-development/run")
    assert resp.status_code == 200, resp.text
    return resp.json()["run_id"]


def test_run_then_inspect(client: TestClient) -> None:
    run_id = _start_run(client)
    resp = client.get(f"/runs/{run_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == run_id
    assert "plan" in body["nodes"]


def test_get_unknown_run_is_404(client: TestClient) -> None:
    assert client.get("/runs/ghost").status_code == 404


def test_cancel_run(client: TestClient) -> None:
    run_id = _start_run(client)
    resp = client.post(f"/runs/{run_id}/cancel")
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"


def test_cancel_unknown_run_is_404(client: TestClient) -> None:
    assert client.post("/runs/ghost/cancel").status_code == 404


def test_retry_run_resets_it(client: TestClient) -> None:
    run_id = _start_run(client)
    resp = client.post(f"/runs/{run_id}/retry")
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"

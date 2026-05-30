"""T6 — dashboard workflow routes: get/save/validate/compile-preview a graph
through the real core CLI against a temp Hermes home. No Kanban needed."""

from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
PLUGIN_API = ROOT / "dashboard" / "plugin_api.py"
SPEC = ROOT / "examples" / "feature-development.workflow.yaml"


def _load_router():
    spec = importlib.util.spec_from_file_location("hw_dashboard_api_wf", PLUGIN_API)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    home = tmp_path / "home"
    (home / "workflows" / "global").mkdir(parents=True)
    shutil.copy(SPEC, home / "workflows" / "global" / "feature-development.workflow.yaml")
    monkeypatch.setenv("HERMES_HOME", str(home))

    app = FastAPI()
    app.include_router(_load_router().router)
    return TestClient(app)


def test_get_workflow_returns_the_full_graph(client: TestClient) -> None:
    resp = client.get("/workflows/feature-development")
    assert resp.status_code == 200
    body = resp.json()
    assert body["workflow"]["name"] == "Feature Development"
    assert body["path"].endswith("feature-development.workflow.yaml")


def test_get_unknown_workflow_is_404(client: TestClient) -> None:
    assert client.get("/workflows/ghost").status_code == 404


def test_put_saves_an_edited_ui_and_round_trips(client: TestClient) -> None:
    workflow = client.get("/workflows/feature-development").json()["workflow"]
    ui = {"xyflow": {"viewport": {"x": 5, "y": 6, "zoom": 1.5}}}
    resp = client.put(
        "/workflows/feature-development", json={"workflow": workflow, "ui": ui}
    )
    assert resp.status_code == 200
    again = client.get("/workflows/feature-development").json()
    assert again["ui"] == ui


def test_put_with_mismatched_id_is_400(client: TestClient) -> None:
    workflow = client.get("/workflows/feature-development").json()["workflow"]
    workflow["id"] = "renamed"
    resp = client.put("/workflows/feature-development", json={"workflow": workflow})
    assert resp.status_code == 400


def test_put_invalid_graph_is_400(client: TestClient) -> None:
    workflow = client.get("/workflows/feature-development").json()["workflow"]
    workflow["edges"] = [{"from": "plan", "to": "ghost"}]
    resp = client.put("/workflows/feature-development", json={"workflow": workflow})
    assert resp.status_code == 400


def test_validate_route(client: TestClient) -> None:
    resp = client.post("/workflows/feature-development/validate")
    assert resp.status_code == 200
    assert resp.json()["valid"] is True


def test_compile_preview_route(client: TestClient) -> None:
    resp = client.post("/workflows/feature-development/compile-preview")
    assert resp.status_code == 200
    assert resp.json()["first_node"] == "plan"


# --- lifecycle: create / delete / export -------------------------------------

SEED = {
    "id": "fresh",
    "name": "Fresh",
    "version": 1,
    "scope": {"type": "global"},
    "trigger": {"type": "manual"},
    "nodes": [{"id": "finish", "type": "finish", "outcome": "success"}],
    "edges": [],
}


def test_create_writes_a_new_workflow(client: TestClient) -> None:
    resp = client.post("/workflows", json={"workflow": SEED})
    assert resp.status_code == 200
    body = resp.json()
    assert body["workflow"]["id"] == "fresh"
    assert body["path"].endswith("fresh.workflow.yaml")
    # the created spec is now loadable
    assert client.get("/workflows/fresh").status_code == 200


def test_create_persists_optional_ui(client: TestClient) -> None:
    ui = {"xyflow": {"viewport": {"x": 1, "y": 2, "zoom": 1}}}
    resp = client.post("/workflows", json={"workflow": SEED, "ui": ui})
    assert resp.status_code == 200
    assert client.get("/workflows/fresh").json()["ui"] == ui


def test_create_duplicate_id_is_409(client: TestClient) -> None:
    dup = {**SEED, "id": "feature-development", "name": "Clash"}
    resp = client.post("/workflows", json={"workflow": dup})
    assert resp.status_code == 409


def test_create_invalid_graph_is_400(client: TestClient) -> None:
    bad = {**SEED, "edges": [{"from": "finish", "to": "ghost"}]}
    resp = client.post("/workflows", json={"workflow": bad})
    assert resp.status_code == 400


def test_create_requires_a_workflow_object(client: TestClient) -> None:
    assert client.post("/workflows", json={"ui": {}}).status_code == 400


def test_delete_removes_the_workflow(client: TestClient) -> None:
    resp = client.delete("/workflows/feature-development")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    assert client.get("/workflows/feature-development").status_code == 404


def test_delete_missing_is_404(client: TestClient) -> None:
    assert client.delete("/workflows/ghost").status_code == 404


def test_export_returns_the_yaml_in_a_json_envelope(client: TestClient, tmp_path: Path) -> None:
    resp = client.get("/workflows/feature-development/export")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "feature-development"
    assert body["filename"] == "feature-development.workflow.yaml"
    # The route must stream the on-disk file verbatim — no second serializer.
    on_disk = (
        tmp_path / "home" / "workflows" / "global" / "feature-development.workflow.yaml"
    ).read_text(encoding="utf-8")
    assert body["yaml"] == on_disk


def test_export_missing_is_404(client: TestClient) -> None:
    assert client.get("/workflows/ghost/export").status_code == 404

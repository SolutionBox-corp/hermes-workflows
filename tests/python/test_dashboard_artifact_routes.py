"""Dashboard route serving one stored node artifact.

Kept off ``GET /runs/{id}`` deliberately: the inspector polls the whole run state
every couple of seconds, and a diff has no business riding that. The route is
therefore the lazy half of the contract, and the tests that matter most are the
ones proving a URL segment can never become a path.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_workflows import artifacts

ROOT = Path(__file__).resolve().parents[2]
PLUGIN_API = ROOT / "dashboard" / "plugin_api.py"


def _load_router():
    spec = importlib.util.spec_from_file_location("hw_dashboard_api_artifacts", PLUGIN_API)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    hermes_home = tmp_path / "home"
    (hermes_home / "workflows").mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    return hermes_home


@pytest.fixture()
def artifacts_root(home: Path) -> Path:
    return home / "workflows" / "runs"


@pytest.fixture()
def client(home: Path) -> TestClient:
    app = FastAPI()
    app.include_router(_load_router().router)
    return TestClient(app)


def _store(root: Path, tmp_path: Path, name: str, content: str, *, node: str = "explore") -> None:
    source = tmp_path / f"src-{name}"
    source.write_text(content, encoding="utf-8")
    artifacts.store_artifact(root, "run-1", node, name, source)


def test_reads_a_stored_artifact(client, artifacts_root, tmp_path) -> None:
    _store(artifacts_root, tmp_path, "diff.patch", "+++ a\n")

    response = client.get("/runs/run-1/nodes/explore/artifacts/diff.patch")

    assert response.status_code == 200
    assert response.json() == {
        "run_id": "run-1",
        "node_id": "explore",
        "name": "diff.patch",
        "text": "+++ a\n",
        "truncated": False,
        "bytes": 6,
    }


def test_artifacts_are_scoped_to_their_node(client, artifacts_root, tmp_path) -> None:
    _store(artifacts_root, tmp_path, "result.md", "from tdd", node="tdd")

    assert client.get("/runs/run-1/nodes/tdd/artifacts/result.md").status_code == 200
    assert client.get("/runs/run-1/nodes/explore/artifacts/result.md").status_code == 404


def test_missing_artifact_is_404(client) -> None:
    assert client.get("/runs/run-1/nodes/explore/artifacts/nope.txt").status_code == 404


def test_a_traversing_name_is_404_and_reads_nothing(client, home, tmp_path) -> None:
    secret = home / "secret.txt"
    secret.write_text("SHOULD-NOT-APPEAR", encoding="utf-8")

    response = client.get("/runs/run-1/nodes/explore/artifacts/..%2F..%2F..%2Fsecret.txt")

    assert response.status_code == 404
    assert "SHOULD-NOT-APPEAR" not in response.text


def test_a_traversing_run_id_is_404(client) -> None:
    response = client.get("/runs/..%2F..%2Fetc/nodes/explore/artifacts/passwd")
    assert response.status_code == 404


def test_byte_count_is_utf8_bytes_not_characters(client, artifacts_root, tmp_path) -> None:
    """A Polish or Czech result is the normal case here, not an edge case."""
    _store(artifacts_root, tmp_path, "result.md", "Łódź")

    body = client.get("/runs/run-1/nodes/explore/artifacts/result.md").json()

    assert body["text"] == "Łódź"
    assert body["bytes"] == 7

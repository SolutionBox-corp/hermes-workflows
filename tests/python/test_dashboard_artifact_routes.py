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
        "encoding": "utf-8",
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


PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
    "00000049454e44ae426082"
)


def test_an_image_artifact_is_served_as_base64(client, artifacts_root, tmp_path) -> None:
    """A screenshot is evidence. Serving it through the same JSON-only channel
    keeps one route and one permission check."""
    import base64

    source = tmp_path / "shot.png"
    source.write_bytes(PNG_1x1)
    artifacts.store_artifact(artifacts_root, "run-1", "explore", "shot.png", source)

    body = client.get("/runs/run-1/nodes/explore/artifacts/shot.png").json()

    assert body["encoding"] == "base64"
    assert body["media_type"] == "image/png"
    assert base64.b64decode(body["text"]) == PNG_1x1
    assert body["bytes"] == len(PNG_1x1)


def test_a_text_artifact_still_says_its_encoding(client, artifacts_root, tmp_path) -> None:
    _store(artifacts_root, tmp_path, "result.md", "hello")
    body = client.get("/runs/run-1/nodes/explore/artifacts/result.md").json()
    assert body["encoding"] == "utf-8"
    assert body["text"] == "hello"
    assert "media_type" not in body


def test_a_png_is_not_mangled_through_a_utf8_decode(tmp_path) -> None:
    """The regression this guards: read_artifact would replace every invalid
    byte, so the stored image and the served image were different files."""
    source = tmp_path / "shot.png"
    source.write_bytes(PNG_1x1)
    root = tmp_path / "runs"
    artifacts.store_artifact(root, "r", "n", "shot.png", source)

    data, truncated = artifacts.read_artifact_bytes(root, "r", "n", "shot.png")

    assert data == PNG_1x1
    assert truncated is False


def test_media_type_only_claims_known_binary_suffixes() -> None:
    assert artifacts.media_type("a.png") == "image/png"
    assert artifacts.media_type("a.JPG") == "image/jpeg"
    assert artifacts.media_type("report.md") is None
    assert artifacts.media_type("noextension") is None

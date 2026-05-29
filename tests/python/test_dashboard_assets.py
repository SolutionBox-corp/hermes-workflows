"""E6.2 — the dashboard ships the real-contract manifest plus a minimal,
build-free bundle that registers a read-only Workflows tab."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "dashboard"


def test_manifest_matches_the_hermes_contract() -> None:
    manifest = json.loads((DASHBOARD / "manifest.json").read_text())
    assert manifest["name"] == "workflows"
    assert manifest["entry"] == "dist/index.js"
    assert manifest["api"] == "plugin_api.py"
    assert manifest["tab"]["path"] == "/workflows"


def test_bundle_registers_a_tab_and_reads_the_api() -> None:
    bundle = (DASHBOARD / "dist" / "index.js").read_text()
    assert "__HERMES_PLUGINS__" in bundle
    assert "register" in bundle
    assert "/api/plugins/workflows/workflows" in bundle
    assert "o2b-status" in bundle

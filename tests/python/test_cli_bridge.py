"""E3.1 — the Python↔Bun core transport parses JSON and raises on failure."""

from __future__ import annotations

import sys

import pytest

from hermes_workflows.cli_bridge import invoke, CoreBridgeError


def test_invoke_parses_json_stdout() -> None:
    result = invoke([sys.executable, "-c", "import json; print(json.dumps({'ok': True}))"])
    assert result == {"ok": True}


def test_invoke_returns_none_for_empty_stdout() -> None:
    assert invoke([sys.executable, "-c", ""]) is None


def test_invoke_raises_on_nonzero_exit() -> None:
    with pytest.raises(CoreBridgeError):
        invoke([sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(2)"])

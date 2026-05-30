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


def test_invoke_times_out() -> None:
    with pytest.raises(CoreBridgeError):
        invoke([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.3)


def test_structured_error_exposes_kind_and_clean_detail() -> None:
    script = (
        "import json,sys; "
        "sys.stderr.write(json.dumps({'error': {'name': 'NotFoundError', "
        "'message': \"run 'x' not found\"}})); sys.exit(1)"
    )
    with pytest.raises(CoreBridgeError) as exc_info:
        invoke([sys.executable, "-c", script])
    assert exc_info.value.kind == "NotFoundError"
    assert exc_info.value.detail == "run 'x' not found"


def test_unstructured_error_has_no_kind() -> None:
    with pytest.raises(CoreBridgeError) as exc_info:
        invoke([sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(2)"])
    assert exc_info.value.kind is None
    assert exc_info.value.detail == "boom"

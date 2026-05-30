"""Invoke the Bun core CLI and parse its JSON output.

This is the single seam between the Python plugin and the TypeScript engine.
The concrete core-CLI command wiring (paths, subcommands) lands in E4.3; this
module provides the transport: run an argv, raise on failure, parse JSON.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any, Optional, Sequence


class CoreBridgeError(RuntimeError):
    def __init__(self, returncode: int, message: str, kind: Optional[str] = None) -> None:
        super().__init__(f"core CLI failed (exit {returncode}): {message}")
        self.returncode = returncode
        # ``kind`` is the core error class name (e.g. "NotFoundError",
        # "SpecValidationError") when the core emitted a structured error;
        # ``detail`` is the clean human message without the wrapper.
        self.kind = kind
        self.detail = message


def _parse_error(raw: str) -> tuple[Optional[str], str]:
    """Extract ``(kind, message)`` from the core's structured stderr, falling
    back to ``(None, raw)`` for unstructured output."""
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None, raw
    error = parsed.get("error") if isinstance(parsed, dict) else None
    if isinstance(error, dict):
        return error.get("name"), error.get("message") or raw
    return None, raw


def invoke(
    argv: Sequence[str],
    *,
    cwd: Optional[str] = None,
    input_text: Optional[str] = None,
    timeout: Optional[float] = 120.0,
) -> Any:
    """Run ``argv`` and return parsed JSON stdout (or None if stdout is empty).

    A bounded ``timeout`` guards against a hung core process wedging the host
    (the plugin is loaded in-process by Hermes); a timeout surfaces as a
    ``CoreBridgeError``."""
    try:
        proc = subprocess.run(
            list(argv),
            capture_output=True,
            text=True,
            cwd=cwd,
            input=input_text,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise CoreBridgeError(-1, f"core CLI timed out after {timeout}s") from exc
    if proc.returncode != 0:
        raw = proc.stderr.strip() or proc.stdout.strip()
        kind, message = _parse_error(raw)
        raise CoreBridgeError(proc.returncode, message, kind=kind)
    out = proc.stdout.strip()
    return json.loads(out) if out else None

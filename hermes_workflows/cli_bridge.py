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
    def __init__(self, returncode: int, message: str) -> None:
        super().__init__(f"core CLI failed (exit {returncode}): {message}")
        self.returncode = returncode


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
        message = proc.stderr.strip() or proc.stdout.strip()
        raise CoreBridgeError(proc.returncode, message)
    out = proc.stdout.strip()
    return json.loads(out) if out else None

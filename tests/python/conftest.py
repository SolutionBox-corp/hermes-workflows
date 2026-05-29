"""Test bootstrap: make the project package importable, and (for bridge tests)
locate the Hermes install so ``hermes_cli`` resolves. The Hermes path insertion
is a test-only convenience; at runtime the plugin is loaded in-process by Hermes
and ``hermes_cli`` is already importable.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _ensure_hermes_importable() -> None:
    try:
        import hermes_cli  # noqa: F401

        return
    except ModuleNotFoundError:
        pass
    for candidate in (os.environ.get("HERMES_AGENT_HOME"), "/usr/local/lib/hermes-agent"):
        if candidate and (Path(candidate) / "hermes_cli").is_dir():
            sys.path.insert(0, candidate)
            return


_ensure_hermes_importable()

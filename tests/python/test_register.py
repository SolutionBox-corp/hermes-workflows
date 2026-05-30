"""E4.1 — the plugin entrypoint registers the model tools and stays lazy
(the heavy engine is not imported at registration time)."""

from __future__ import annotations

import subprocess
import sys

from hermes_workflows.plugin import register, TOOLSET


class StubContext:
    def __init__(self) -> None:
        self.tools: dict[str, dict] = {}

    def register_tool(self, name, toolset, schema, handler, **kwargs) -> None:
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler, **kwargs}


def test_registers_the_model_tools() -> None:
    ctx = StubContext()
    register(ctx)
    assert set(ctx.tools) == {
        "workflow_list",
        "workflow_run",
        "workflow_status",
        "workflow_explain",
        "workflow_review",
    }
    for tool in ctx.tools.values():
        assert tool["toolset"] == TOOLSET
        assert tool["schema"]["type"] == "object"
        assert callable(tool["handler"])


def test_register_does_not_import_the_engine() -> None:
    # Run in a clean interpreter so other tests' imports don't pollute the check.
    code = (
        "import sys; import hermes_workflows.plugin as p;"
        "p.register(type('C',(),{'register_tool':lambda *a, **k: None})());"
        "assert 'hermes_workflows.engine' not in sys.modules, 'engine imported eagerly'"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr

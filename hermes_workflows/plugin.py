"""Hermes plugin entrypoint. Stays thin: it registers the four model tools with
lazy handlers so Hermes startup does not import the engine, and does no O2B
detection at load time (so an O2B problem can never break startup)."""

from __future__ import annotations

import json
from typing import Any

PLUGIN_NAME = "hermes-workflows"
TOOLSET = "workflows"

_LIST_SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}
_RUN_SCHEMA = {
    "type": "object",
    "properties": {
        "workflow_id": {"type": "string"},
        "project_id": {"type": "string"},
    },
    "required": ["workflow_id"],
    "additionalProperties": False,
}
_STATUS_SCHEMA = {
    "type": "object",
    "properties": {"run_id": {"type": "string"}},
    "required": ["run_id"],
    "additionalProperties": False,
}
_EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {"workflow_id": {"type": "string"}},
    "required": ["workflow_id"],
    "additionalProperties": False,
}


def register(ctx: Any) -> None:
    log = getattr(ctx, "log", None)
    if log is not None and hasattr(log, "info"):
        try:
            log.info("hermes-workflows plugin loaded")
        except Exception:
            pass

    ctx.register_tool(
        name="workflow_list",
        toolset=TOOLSET,
        schema=_LIST_SCHEMA,
        handler=_handle_list,
        description="List available workflows.",
    )
    ctx.register_tool(
        name="workflow_run",
        toolset=TOOLSET,
        schema=_RUN_SCHEMA,
        handler=_handle_run,
        description="Run a workflow by id.",
    )
    ctx.register_tool(
        name="workflow_status",
        toolset=TOOLSET,
        schema=_STATUS_SCHEMA,
        handler=_handle_status,
        description="Get the status of a workflow run.",
    )
    ctx.register_tool(
        name="workflow_explain",
        toolset=TOOLSET,
        schema=_EXPLAIN_SCHEMA,
        handler=_handle_explain,
        description="Explain what a workflow does without running it.",
    )


def _handle_list(args: Any = None, **_kwargs: Any) -> str:
    from . import config, tools

    return json.dumps(tools.list_workflows(roots=config.spec_roots(), core_cli=config.core_cli()))


def _handle_explain(args: dict, **_kwargs: Any) -> str:
    from . import config, tools

    return json.dumps(
        tools.explain_workflow(args["workflow_id"], roots=config.spec_roots(), core_cli=config.core_cli())
    )


def _handle_run(args: dict, **_kwargs: Any) -> str:
    import uuid

    from . import config, tools

    run_id = f"run_{uuid.uuid4().hex[:12]}"
    return json.dumps(
        tools.run_workflow(
            args["workflow_id"],
            engine=_build_engine(),
            roots=config.spec_roots(),
            core_cli=config.core_cli(),
            run_id=run_id,
            project_id=args.get("project_id"),
        )
    )


def _handle_status(args: dict, **_kwargs: Any) -> str:
    from . import tools

    return json.dumps(tools.workflow_status(args["run_id"], engine=_build_engine()))


def _build_engine() -> Any:
    from hermes_cli import kanban_db as kb

    from . import config
    from .engine import Engine
    from .executor import KanbanExecutor

    board = kb.connect(board=config.runtime_board())
    return Engine(
        core_cli=config.core_cli(),
        db_path=str(config.runs_db_path()),
        kanban=KanbanExecutor(board),
    )

"""Dashboard plugin backend — read-only. Mounted at /api/plugins/workflows/ by
the Hermes dashboard runtime. Lists workflows and active runs and reports O2B
availability. No mutation: editing is human-only via CLI (the visual editor is
a later phase)."""

from __future__ import annotations

import shutil
import subprocess

from fastapi import APIRouter

router = APIRouter()


@router.get("/workflows")
async def list_workflows() -> dict:
    from hermes_workflows import config, tools

    return tools.list_workflows(roots=config.spec_roots(), core_cli=config.core_cli())


@router.get("/runs")
async def list_runs() -> dict:
    from hermes_workflows import cli_bridge, config

    runs = (
        cli_bridge.invoke(
            [*config.core_cli(), "run-list", "--db", str(config.runs_db_path()), "--active"]
        )
        or []
    )
    return {
        "runs": [
            {"run_id": r["run_id"], "workflow_id": r["workflow_id"], "status": r["status"]}
            for r in runs
        ]
    }


@router.get("/o2b-status")
async def o2b_status() -> dict:
    """Best-effort OpenSecondBrain availability for the connection badge.
    Never raises — O2B is optional."""
    if shutil.which("o2b") is None:
        return {"connected": False}
    try:
        result = subprocess.run(
            ["o2b", "brain", "doctor"], capture_output=True, text=True, timeout=10
        )
        return {"connected": result.returncode == 0}
    except Exception:
        return {"connected": False}

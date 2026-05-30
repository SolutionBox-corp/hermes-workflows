"""Dashboard plugin backend. Mounted at /api/plugins/workflows/ by the Hermes
dashboard runtime. Lists workflows and active runs, reports O2B availability,
and exposes the single human-in-the-loop write: resolving a human_review node.
Graph editing remains human-only via CLI (the visual editor is a later phase)."""

from __future__ import annotations

import shutil
import subprocess

from fastapi import APIRouter, Body, HTTPException

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


@router.post("/runs/{run_id}/review")
async def review_run(
    run_id: str, node_id: str = Body(...), decision: str = Body(...)
) -> dict:
    """Resolve a human_review node and advance the run. Same channel-agnostic
    resolution the model tool and CLI use; an invalid decision is a 400."""
    from hermes_workflows import config, tools
    from hermes_workflows.cli import build_engine

    try:
        return tools.review_workflow(
            run_id,
            node_id,
            decision,
            engine=build_engine(),
            roots=config.spec_roots(),
            core_cli=config.core_cli(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/o2b-status")
async def o2b_status() -> dict:
    """Best-effort OpenSecondBrain availability for the connection badge.
    Probes `o2b status` (configuration present), not `o2b brain doctor` (a
    strict vault-content check). Never raises — O2B is optional."""
    if shutil.which("o2b") is None:
        return {"connected": False}
    try:
        result = subprocess.run(
            ["o2b", "status"], capture_output=True, text=True, timeout=10
        )
        return {"connected": result.returncode == 0}
    except Exception:
        return {"connected": False}

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


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str) -> dict:
    """Full graph (workflow + ui + path) for the editor to load."""
    from hermes_workflows import cli_bridge, config

    detail = cli_bridge.invoke(
        [*config.core_cli(), "spec-get", "--roots", ",".join(config.spec_roots()), "--id", workflow_id]
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return detail


@router.put("/workflows/{workflow_id}")
async def save_workflow(workflow_id: str, payload: dict = Body(...)) -> dict:
    """Persist an edited graph. Body is ``{workflow, ui?}``; the body id must
    match the URL. An invalid graph is rejected by the core (400)."""
    import json
    import os
    import tempfile

    from hermes_workflows import cli_bridge, config

    workflow = payload.get("workflow")
    if not isinstance(workflow, dict):
        raise HTTPException(status_code=400, detail="body must contain a 'workflow' object")
    if workflow.get("id") != workflow_id:
        raise HTTPException(status_code=400, detail="workflow id in body does not match the URL")

    spec = dict(workflow)
    if payload.get("ui") is not None:
        spec["ui"] = payload["ui"]

    fd, tmp = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(spec, handle)
        return cli_bridge.invoke(
            [
                *config.core_cli(),
                "spec-save",
                "--roots",
                ",".join(config.spec_roots()),
                "--global-root",
                str(config.global_workflows_dir()),
                "--templates-root",
                str(config.templates_dir()),
                "--spec-file",
                tmp,
            ]
        )
    except cli_bridge.CoreBridgeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        os.unlink(tmp)


def _spec_path_or_404(workflow_id: str) -> str:
    from hermes_workflows import cli_bridge, config

    detail = cli_bridge.invoke(
        [*config.core_cli(), "spec-get", "--roots", ",".join(config.spec_roots()), "--id", workflow_id]
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="workflow not found")
    return detail["path"]


@router.post("/workflows/{workflow_id}/validate")
async def validate_workflow(workflow_id: str) -> dict:
    from hermes_workflows import cli_bridge, config

    return cli_bridge.invoke([*config.core_cli(), "validate", _spec_path_or_404(workflow_id)])


@router.post("/workflows/{workflow_id}/compile-preview")
async def compile_preview(workflow_id: str) -> dict:
    from hermes_workflows import cli_bridge, config

    return cli_bridge.invoke([*config.core_cli(), "compile-preview", _spec_path_or_404(workflow_id)])


@router.post("/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str, payload: dict = Body(default={})) -> dict:
    """Start a run from the dashboard — the same path the CLI ``run`` uses."""
    import uuid

    from hermes_workflows import config, tools
    from hermes_workflows.cli import build_engine, _default_project, _spec_path_for_workflow

    engine = build_engine()
    try:
        spec = _spec_path_for_workflow(engine, workflow_id)
    except SystemExit as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    project_id = _default_project(engine, spec, payload.get("project_id"))
    run_id = f"{workflow_id}-{uuid.uuid4().hex[:8]}"
    return tools.run_workflow(
        workflow_id,
        engine=engine,
        roots=config.spec_roots(),
        core_cli=config.core_cli(),
        run_id=run_id,
        project_id=project_id,
    )


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    """Full run state (per-node detail) for the run inspector."""
    from hermes_workflows import cli_bridge, config

    run = cli_bridge.invoke(
        [*config.core_cli(), "run-load", "--db", str(config.runs_db_path()), "--id", run_id]
    )
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict:
    from hermes_workflows import cli_bridge, config

    try:
        return cli_bridge.invoke(
            [*config.core_cli(), "run-cancel", "--db", str(config.runs_db_path()), "--id", run_id]
        )
    except cli_bridge.CoreBridgeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/retry")
async def retry_run(run_id: str, payload: dict = Body(default={})) -> dict:
    from hermes_workflows import cli_bridge, config

    argv = [*config.core_cli(), "run-retry", "--db", str(config.runs_db_path()), "--id", run_id]
    node = payload.get("node_id")
    if node:
        argv += ["--node", node]
    try:
        return cli_bridge.invoke(argv)
    except cli_bridge.CoreBridgeError as exc:
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

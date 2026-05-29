"""The run orchestrator: the only place that combines the pure TypeScript engine
(via the core CLI) with Kanban I/O (via the bridge).

Each advance tick:
  1. ingest completions for active agent_task cards from native task_runs,
  2. ask the engine for the next scheduling decision (pure),
  3. apply node status updates and create Kanban cards for newly scheduled nodes,
  4. persist the run.

The engine CLI is invoked out-of-process, so the orchestrator stays thin and
the spec is interpreted in exactly one place (TypeScript).
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Optional, Sequence

from . import cli_bridge
from .bridge import kanban


class Engine:
    def __init__(
        self,
        *,
        core_cli: Sequence[str],
        db_path: str,
        board_conn: Any,
    ) -> None:
        self.core_cli = list(core_cli)
        self.db_path = db_path
        self.board_conn = board_conn

    # --- core CLI helpers -------------------------------------------------

    def _core(self, args: Sequence[str]) -> Any:
        return cli_bridge.invoke([*self.core_cli, *args])

    def _advance_decision(self, spec_path: str, run: dict) -> dict:
        with _temp_json(run) as run_file:
            return self._core(["advance", spec_path, "--run-file", run_file])

    def _save(self, run: dict) -> None:
        with _temp_json(run) as run_file:
            self._core(["run-save", "--db", self.db_path, "--run-file", run_file])

    def _load(self, run_id: str) -> Optional[dict]:
        return self._core(["run-load", "--db", self.db_path, "--id", run_id])

    # --- public API -------------------------------------------------------

    def run(self, spec_path: str, run_id: str, project_id: Optional[str] = None) -> dict:
        args = ["run-create", spec_path, "--db", self.db_path, "--id", run_id]
        if project_id:
            args += ["--project", project_id]
        self._core(args)
        return self.advance(spec_path, run_id)

    def status(self, run_id: str) -> dict:
        run = self._load(run_id)
        if run is None:
            raise ValueError(f"unknown run {run_id}")
        return run

    def decide_review(self, spec_path: str, run_id: str, node_id: str, decision: str) -> dict:
        run = self.status(run_id)
        node = run["nodes"][node_id]
        node["review_decision"] = decision
        node["seq"] = _max_seq(run) + 1
        self._save(run)
        return self.advance(spec_path, run_id)

    def advance(self, spec_path: str, run_id: str) -> dict:
        run = self.status(run_id)
        plan = self._core(["compile-preview", spec_path])
        task_params = {task["node"]: task for task in plan["kanban_tasks"]}

        seq = _max_seq(run)
        for node in run["nodes"].values():
            if node.get("status") in ("scheduled", "running") and node.get("hermes_task_id"):
                completion = kanban.read_completion(self.board_conn, node["hermes_task_id"])
                if completion.settled and completion.outcome is not None:
                    seq += 1
                    node["status"] = "completed"
                    node["outcome"] = completion.outcome
                    node["seq"] = seq
                    if completion.output is not None:
                        node["output"] = completion.output

        decision = self._advance_decision(spec_path, run)
        for node_id, status in decision["node_updates"].items():
            run["nodes"][node_id]["status"] = status

        for node_id in decision["schedule"]:
            self._create_card(run, run_id, node_id, task_params.get(node_id))

        run["status"] = decision["run_status"]
        self._save(run)
        return run

    def _create_card(
        self, run: dict, run_id: str, node_id: str, params: Optional[dict]
    ) -> None:
        if params is None:
            return
        node = run["nodes"][node_id]
        task_id = kanban.create_node_task(
            self.board_conn,
            run_id=run_id,
            node_id=node_id,
            workflow_id=run["workflow_id"],
            title=params.get("title") or node_id,
            prompt=params.get("prompt", ""),
            assignee=params.get("assignee") or "",
            model=params.get("model"),
            skills=params.get("skills"),
            max_retries=params.get("max_retries"),
            workspace=params.get("workspace") or "scratch",
            timeout_seconds=params.get("timeout_seconds"),
            iteration=node.get("seq", 0),
        )
        node["hermes_task_id"] = task_id
        node["status"] = "scheduled"


def _max_seq(run: dict) -> int:
    return max((node.get("seq") or 0 for node in run["nodes"].values()), default=0)


class _temp_json:
    """Write a value to a temp JSON file for the duration of a `with` block."""

    def __init__(self, value: Any) -> None:
        self._value = value
        self._path: Optional[str] = None

    def __enter__(self) -> str:
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(self._value, handle)
        handle.close()
        self._path = handle.name
        return self._path

    def __exit__(self, *_exc: object) -> None:
        if self._path:
            Path(self._path).unlink(missing_ok=True)

"""DirectExecutor — the global (unbound) backend. A node with no project board
runs by invoking the profile runner (``<runner_dir>/<profile>``) directly, the
same contract Hermes uses elsewhere: the prompt is passed as an argument and the
worker's final message is emitted to stdout.

There are no Kanban cards here, so the completion is persisted to a small
file-backed store keyed by an idempotent handle (``run:node:iteration``). That
keeps a multi-step global workflow durable across tick processes, just as the
Kanban backend is durable through the board DB.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Optional

from .base import Completion

# Cap captured output so a runaway worker cannot bloat the run store.
_MAX_OUTPUT_CHARS = 100_000


class RunnerNotFound(FileNotFoundError):
    """The profile runner for a global node does not exist or is not executable."""


def _handle(run_id: str, node_id: str, iteration: int) -> str:
    return f"{run_id}:{node_id}:{iteration}"


class DirectExecutor:
    def __init__(
        self,
        *,
        runner_dir: Path,
        store_dir: Path,
        timeout_seconds: float = 1800.0,
    ) -> None:
        self.runner_dir = Path(runner_dir)
        self.store_dir = Path(store_dir)
        self.timeout_seconds = timeout_seconds

    def schedule(
        self,
        *,
        run_id: str,
        node_id: str,
        workflow_id: str,
        params: dict,
        iteration: int = 0,
    ) -> str:
        handle = _handle(run_id, node_id, iteration)
        profile = params.get("assignee") or params.get("profile") or ""
        runner = self.runner_dir / profile
        if not profile or not runner.is_file():
            raise RunnerNotFound(f"no profile runner at {runner}")
        completion = self._invoke(runner, params.get("prompt", ""))
        self._persist(handle, completion)
        return handle

    def poll(self, handle: str) -> Completion:
        path = self._path(handle)
        if not path.is_file():
            return Completion(settled=False)
        data = json.loads(path.read_text())
        return Completion(
            settled=bool(data.get("settled")),
            outcome=data.get("outcome"),
            output=data.get("output"),
        )

    # --- internals --------------------------------------------------------

    def _invoke(self, runner: Path, prompt: str) -> Completion:
        try:
            proc = subprocess.run(
                [str(runner), prompt],
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            return Completion(
                settled=True,
                outcome="failure",
                output=f"runner timed out after {self.timeout_seconds:g}s",
            )
        if proc.returncode == 0:
            return Completion(settled=True, outcome="success", output=_clip(proc.stdout))
        detail = proc.stderr.strip() or proc.stdout.strip()
        return Completion(settled=True, outcome="failure", output=_clip(detail))

    def _path(self, handle: str) -> Path:
        safe = handle.replace("/", "_").replace(":", "_")
        return self.store_dir / f"{safe}.json"

    def _persist(self, handle: str, completion: Completion) -> None:
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self._path(handle).write_text(
            json.dumps(
                {
                    "settled": completion.settled,
                    "outcome": completion.outcome,
                    "output": completion.output,
                }
            )
        )


def _clip(text: Optional[str]) -> str:
    cleaned = (text or "").strip()
    if len(cleaned) <= _MAX_OUTPUT_CHARS:
        return cleaned
    return cleaned[:_MAX_OUTPUT_CHARS] + "\n…[truncated]"

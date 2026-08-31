"""ScriptExecutor — runs a ``script`` node's deterministic command locally, with
no LLM. It is the peer of DirectExecutor on the same node-execution seam: a
subprocess with a timeout, capped + redacted captured output, and an idempotent
file-backed completion. Hermes has no no-agent Kanban task mode, so a script
node runs here regardless of workflow scope.

Security (TZ §25.2) is enforced, not cosmetic:
  - the command runs in its ``workdir`` when one is set (set one to contain it;
    with none, it runs in the orchestrator's working directory — see docs);
  - the environment is an allowlist (the settings-level ``env_allowlist``
    intersected with the node's requested ``env``), never the full process env;
  - a timeout always applies;
  - captured stdout/stderr are clipped and redacted before they are persisted.

The completion handle is prefixed ``script:`` so a composite executor can route
``poll`` to the right backend by handle shape.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Callable, Optional, Sequence

from .. import artifacts
from ..redact import redact_secrets
from .base import Completion
from .envelope import split_envelope
from .store import CompletionStore, clip_output

_HANDLE_PREFIX = "script:"


def _handle(run_id: str, node_id: str, iteration: int) -> str:
    return f"{_HANDLE_PREFIX}{run_id}:{node_id}:{iteration}"


class ScriptExecutor:
    def __init__(
        self,
        *,
        store_dir: Path,
        env_allowlist: Sequence[str] = (),
        timeout_seconds: float = 1800.0,
        enabled: Optional[Callable[[], bool]] = None,
        artifacts_root: Optional[Path] = None,
    ) -> None:
        self.store = CompletionStore(Path(store_dir))
        # Where the evidence a step declares is copied to. Defaults beside the
        # completion store rather than importing config here, so the executor
        # stays constructible in a test with nothing but a tmp directory.
        self.artifacts_root = (
            Path(artifacts_root) if artifacts_root is not None else Path(store_dir).parent / "runs"
        )
        # The settings-level ceiling: a node may only see vars named here.
        self.env_allowlist = set(env_allowlist)
        self.timeout_seconds = timeout_seconds
        # Execution-time gate: consulted at schedule, so disabling scripts blocks
        # every path that reaches the executor (run, review-driven advance, the
        # tick cron, retry) — not just the run entrypoint.
        self._enabled = enabled if enabled is not None else (lambda: True)

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
        # Idempotent execution: a settled completion for this (run, node,
        # iteration) means the command already ran. Never re-run it — a tick may
        # retry after a crash, and a script command is not assumed idempotent.
        # A loop re-entry uses a higher iteration, so it gets a fresh handle.
        existing = self.poll(handle)
        if existing.settled:
            return handle
        # ... and neither is a command that is still RUNNING. The completion is
        # only written when the command returns, so for the whole duration of a
        # long step nothing said "already in flight" and the next advance ran it
        # again: `hermes-workflows run` blocks in the command while the cron tick
        # advances the same run. Measured on a real 3-minute step - two run
        # directories 57 seconds apart, two invocations of the model, twice the
        # money.
        #
        # Bounded so a crash cannot wedge the node forever: if the marker is
        # older than this node's own timeout, the process that wrote it cannot
        # still be running, and the step is allowed to start again.
        if existing.started and not self._stale(handle, params):
            return handle
        if not self._enabled():
            self.store.write(
                handle,
                Completion(
                    settled=True,
                    outcome="failure",
                    output="script execution is disabled (execution.scripts_enabled is false)",
                ),
            )
            return handle
        self._mark_started(handle)
        completion = self._invoke(params, run_id=run_id, node_id=node_id)
        self.store.write(handle, completion)
        return handle

    def poll(self, handle: str) -> Completion:
        return self.store.read(handle)

    def _mark_started(self, handle: str) -> None:
        """Claim the handle before running, so a concurrent advance sees it."""
        self.store.write(handle, Completion(settled=False, started=True))

    def _stale(self, handle: str, params: dict) -> bool:
        """Whether a started-but-unsettled claim is too old to still be running.

        The process that wrote the marker is bounded by the node's own timeout;
        past that it is gone and the claim is a leftover, not a running step.
        Without this a crash mid-command would wedge the node forever.
        """
        timeout = params.get("timeout_seconds")
        limit = float(timeout) if timeout is not None else self.timeout_seconds
        try:
            age = time.time() - self.store.path_for(handle).stat().st_mtime
        except OSError:
            return False
        # A generous margin over the timeout: the command is killed at the
        # timeout, and the writing process still needs a moment to record that.
        return age > limit + 60

    # --- internals --------------------------------------------------------

    def _invoke(self, params: dict, *, run_id: str = "", node_id: str = "") -> Completion:
        command = params.get("command") or ""
        workdir = params.get("workdir") or None
        timeout = params.get("timeout_seconds")
        timeout = float(timeout) if timeout is not None else self.timeout_seconds
        env = self._build_env(params.get("env"))
        try:
            # shell=True is deliberate: the command is operator-authored (the
            # threat model is "an operator runs their own script", TZ §25.2), and
            # real steps need shell features (pipes, `&&`, redirection). The gate
            # + env allowlist + workdir + timeout are the mitigations, not a
            # restricted argv.
            proc = subprocess.run(
                command,
                shell=True,
                cwd=workdir,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return Completion(
                settled=True,
                outcome="failure",
                output=f"script timed out after {timeout:g}s",
            )
        # stderr is carried on both outcomes. `output` keeps its existing
        # meaning untouched — stdout on success, stderr-preferred detail on
        # failure — because it is a consumed value: a `wait` node reads
        # `{{nodes.<id>.output}}`. The new field is added beside it, never
        # instead of it.
        stderr = _clean(proc.stderr)
        # Split the envelope off BEFORE anything is clipped: the clip truncates
        # the tail, which is exactly where the envelope lives. A step that
        # printed a lot and then declared its record would otherwise lose the
        # record it had just written, silently.
        stdout, record = self._record(proc.stdout or "", run_id, node_id)
        if proc.returncode == 0:
            return Completion(
                settled=True,
                outcome="success",
                output=_clean(stdout),
                stderr=stderr,
                record=record,
            )
        detail = proc.stderr.strip() or stdout.strip()
        return Completion(
            settled=True, outcome="failure", output=_clean(detail), stderr=stderr, record=record
        )

    def _record(self, stdout: str, run_id: str, node_id: str) -> tuple[str, Optional[dict]]:
        """Split a step's ``hermes_node`` envelope off its stdout and bring the
        artifacts it declared into the store.

        Each declared entry names a file by an operator-side path. That path is
        replaced in the record by the size actually kept, because the path means
        nothing to a reader of the run and would leak the host's layout into the
        UI. A path that cannot be read becomes a warning on the record and never
        a failed node: the step did its work either way, and failing it would
        turn a bookkeeping problem into a stopped pipeline.
        """
        body, record = split_envelope(stdout)
        if record is None:
            return body, None
        declared = record.get("artifacts")
        if not isinstance(declared, list):
            return body, record
        kept: list[dict] = []
        warnings = [str(w) for w in (record.get("warnings") or [])]
        for entry in declared:
            if not isinstance(entry, dict):
                continue
            name, source = entry.get("name"), entry.get("path")
            if not name or not source:
                continue
            try:
                written = artifacts.store_artifact(
                    self.artifacts_root, run_id, node_id, str(name), Path(str(source))
                )
            except (OSError, ValueError) as exc:
                warnings.append(f"artifact {name!r} not stored: {exc}")
                continue
            stored = {
                "name": name,
                "label": entry.get("label") or name,
                "kind": entry.get("kind") or "text",
                "bytes": written,
                "truncated": written >= artifacts.MAX_ARTIFACT_BYTES,
            }
            # Carried through: it marks the one artifact a reviewer is meant to
            # read, and a gate opens it for them. Dropping it here would leave
            # the document the decision rests on hidden behind a click again.
            if entry.get("primary"):
                stored["primary"] = True
            kept.append(stored)
        record["artifacts"] = kept
        if warnings:
            record["warnings"] = warnings
        return body, record

    def _build_env(self, requested: Optional[Sequence[str]]) -> dict:
        """The command sees only vars whose names are both requested by the node
        and permitted by the settings allowlist — defense in depth.

        ``HOME`` is always provided (the orchestrator's own HOME): HOME-credential
        CLIs (claude, codex, gh, rclone, …) resolve ``~/.config``, ``~/.claude``,
        etc. from it, so without it such a command fails (e.g. "Not logged in").
        HOME is the login user's home directory, not a secret-bearing variable, so
        passing it through does not widen the allowlist's secret exposure. See
        docs/execution.md for the full HOME contract and the agent bash-tool
        caveat (a separate, host-owned environment)."""
        names = self.env_allowlist if requested is None else self.env_allowlist & set(requested)
        env = {name: os.environ[name] for name in names if name in os.environ}
        if "HOME" in os.environ:
            env.setdefault("HOME", os.environ["HOME"])
        return env

def _clean(text: Optional[str]) -> str:
    return clip_output(redact_secrets(text))

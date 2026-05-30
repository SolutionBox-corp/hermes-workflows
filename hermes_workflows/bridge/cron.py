"""Cron bridge: compile a workflow's cron trigger into a native Hermes Cron job,
and manage the transient advance tick. We never write our own cron engine — the
gateway runs the jobs. Trigger and tick jobs are deterministic no-agent script
jobs (the script invokes the workflow run / advance).

The tick is a single, named singleton: created when active runs exist, removed
when none remain, so tick jobs never accumulate.
"""

from __future__ import annotations

import shlex
from pathlib import Path
from typing import Optional

from cron import jobs as cj

from .. import config

TICK_NAME = "hermes-workflows-tick"
DEFAULT_TICK_SCHEDULE = "every 2m"


def write_shim(name: str, *command_args: str, command: Optional[Path] = None) -> Path:
    """Write an executable shim under ``HERMES_HOME/scripts`` that execs the
    ``hermes-workflows`` entrypoint with ``command_args``. Hermes cron only runs
    scripts that live in that directory and invokes them with no arguments, so a
    per-purpose shim is how a trigger/tick carries its subcommand."""
    binary = command or config.command_path()
    scripts = config.scripts_dir()
    scripts.mkdir(parents=True, exist_ok=True)
    args = " ".join(shlex.quote(str(arg)) for arg in command_args)
    path = scripts / f"{name}.sh"
    path.write_text(f"#!/usr/bin/env bash\nexec {shlex.quote(str(binary))} {args}\n")
    path.chmod(0o755)
    return path


def register_workflow_trigger(
    *,
    workflow_id: str,
    schedule: str,
    deliver: Optional[str] = None,
    command: Optional[Path] = None,
) -> str:
    """Compile a workflow's cron trigger into a native Cron job that runs
    ``hermes-workflows run <id>`` on schedule."""
    shim = write_shim(
        f"hermes-workflows-trigger-{workflow_id}", "run", workflow_id, command=command
    )
    return register_trigger(
        workflow_id=workflow_id, schedule=schedule, script=str(shim), deliver=deliver
    )


def ensure_workflow_tick(
    *, schedule: str = DEFAULT_TICK_SCHEDULE, command: Optional[Path] = None
) -> str:
    """Ensure the singleton tick job exists, running ``hermes-workflows
    advance-all`` on schedule."""
    shim = write_shim("hermes-workflows-tick", "advance-all", command=command)
    return ensure_tick(script=str(shim), schedule=schedule)


def sync_workflow_tick(*, active: bool, command: Optional[Path] = None) -> Optional[str]:
    """Tick lifecycle keyed on whether any runs remain active, using the
    advance-all shim as the job script."""
    if active:
        return ensure_workflow_tick(command=command)
    teardown_tick()
    return None


def register_trigger(
    *,
    workflow_id: str,
    schedule: str,
    script: str,
    deliver: Optional[str] = None,
) -> str:
    """Create a cron job that runs `script` on `schedule` to start the workflow.
    Returns the Hermes cron job id (persist the mapping in runs.db)."""
    job = cj.create_job(
        prompt=None,
        schedule=schedule,
        name=f"workflow:{workflow_id}",
        script=script,
        no_agent=True,
        deliver=deliver,
    )
    return job["id"]


def find_by_name(name: str) -> Optional[dict]:
    for job in cj.list_jobs(include_disabled=True):
        if job.get("name") == name:
            return job
    return None


def ensure_tick(*, script: str, schedule: str = DEFAULT_TICK_SCHEDULE) -> str:
    existing = find_by_name(TICK_NAME)
    if existing is not None:
        return existing["id"]
    job = cj.create_job(
        prompt=None,
        schedule=schedule,
        name=TICK_NAME,
        script=script,
        no_agent=True,
    )
    return job["id"]


def teardown_tick() -> bool:
    existing = find_by_name(TICK_NAME)
    if existing is None:
        return False
    return cj.remove_job(existing["id"])


def sync_tick(*, active: bool, script: str) -> Optional[str]:
    """Ensure the tick exists while runs are active and is gone when none are."""
    if active:
        return ensure_tick(script=script)
    teardown_tick()
    return None


def pause(job_id: str) -> bool:
    return cj.pause_job(job_id) is not None


def resume(job_id: str) -> bool:
    return cj.resume_job(job_id) is not None


def remove(job_id: str) -> bool:
    return cj.remove_job(job_id)

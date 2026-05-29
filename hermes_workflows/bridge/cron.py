"""Cron bridge: compile a workflow's cron trigger into a native Hermes Cron job,
and manage the transient advance tick. We never write our own cron engine — the
gateway runs the jobs. Trigger and tick jobs are deterministic no-agent script
jobs (the script invokes the workflow run / advance).

The tick is a single, named singleton: created when active runs exist, removed
when none remain, so tick jobs never accumulate.
"""

from __future__ import annotations

from typing import Optional

from cron import jobs as cj

TICK_NAME = "hermes-workflows-tick"
DEFAULT_TICK_SCHEDULE = "every 2m"


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

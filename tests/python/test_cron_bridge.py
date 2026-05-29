"""E3.4 — cron bridge: register a workflow trigger, manage the transient tick,
and pause/resume/remove schedules. The schedule string is passed through to
Hermes cron; here we use an interval so the test runs without croniter."""

from __future__ import annotations

from pathlib import Path

import pytest

cj = pytest.importorskip("cron.jobs")

from hermes_workflows.bridge import cron as cron_bridge


@pytest.fixture()
def cron_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cron_dir = tmp_path / "cron"
    cron_dir.mkdir()
    monkeypatch.setattr(cj, "CRON_DIR", cron_dir)
    monkeypatch.setattr(cj, "JOBS_FILE", cron_dir / "jobs.json")
    monkeypatch.setattr(cj, "OUTPUT_DIR", cron_dir / "output")
    script = tmp_path / "runner.sh"
    script.write_text("#!/bin/bash\necho ok\n")
    return script


def test_register_trigger(cron_env: Path) -> None:
    job_id = cron_bridge.register_trigger(
        workflow_id="blog-daily-signals", schedule="every 2m", script=str(cron_env)
    )
    job = cj.get_job(job_id)
    assert job is not None
    assert job["name"] == "workflow:blog-daily-signals"
    assert job["script"] == str(cron_env)


def test_sync_tick_creates_and_removes(cron_env: Path) -> None:
    first = cron_bridge.sync_tick(active=True, script=str(cron_env))
    assert first is not None
    # idempotent: the singleton tick is reused, not duplicated
    again = cron_bridge.sync_tick(active=True, script=str(cron_env))
    assert again == first
    assert cron_bridge.find_by_name(cron_bridge.TICK_NAME) is not None

    # no active runs -> tick is torn down
    assert cron_bridge.sync_tick(active=False, script=str(cron_env)) is None
    assert cron_bridge.find_by_name(cron_bridge.TICK_NAME) is None


def test_pause_resume_remove(cron_env: Path) -> None:
    job_id = cron_bridge.register_trigger(
        workflow_id="wf", schedule="every 1h", script=str(cron_env)
    )
    cron_bridge.pause(job_id)
    assert cj.get_job(job_id)["enabled"] is False
    cron_bridge.resume(job_id)
    assert cj.get_job(job_id)["enabled"] is True
    assert cron_bridge.remove(job_id) is True
    assert cj.get_job(job_id) is None

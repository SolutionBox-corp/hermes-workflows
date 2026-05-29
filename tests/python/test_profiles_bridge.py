"""E3.5 — profile resolution for task assignment."""

from __future__ import annotations

from pathlib import Path

import pytest

from hermes_workflows.bridge import profiles


def test_prefers_node_profile() -> None:
    assert profiles.resolve_profile("coder", "default") == "coder"


def test_falls_back_to_default() -> None:
    assert profiles.resolve_profile(None, "default") == "default"


def test_raises_when_no_profile_available() -> None:
    with pytest.raises(ValueError):
        profiles.resolve_profile(None, None)


def test_rejects_unknown_profile_against_roster() -> None:
    with pytest.raises(ValueError):
        profiles.resolve_profile("ghost", None, known={"coder"})


def test_accepts_known_profile() -> None:
    assert profiles.resolve_profile("coder", None, known={"coder"}) == "coder"


def test_load_roster_returns_agent_names(tmp_path: Path) -> None:
    roster = tmp_path / "agents.yaml"
    roster.write_text(
        "version: 1\nagents:\n  coder:\n    role: build\n  writer:\n    role: draft\n"
    )
    assert profiles.load_roster(roster) == {"coder", "writer"}

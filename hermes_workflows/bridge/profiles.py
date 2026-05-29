"""Resolve the profile a node's Kanban task is assigned to: prefer the node's
own profile, fall back to the workflow default, and (optionally) validate
against the known agent roster."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

import yaml


def resolve_profile(
    node_profile: Optional[str],
    default_profile: Optional[str],
    *,
    known: Optional[Iterable[str]] = None,
) -> str:
    profile = node_profile or default_profile
    if not profile:
        raise ValueError("no profile: the node has none and defaults.profile is unset")
    if known is not None and profile not in set(known):
        raise ValueError(f"unknown profile '{profile}'")
    return profile


def load_roster(path: str | Path) -> set[str]:
    """Return the set of profile names declared in an agent-roster YAML file."""
    data = yaml.safe_load(Path(path).read_text()) or {}
    agents = data.get("agents") or {}
    return set(agents.keys())

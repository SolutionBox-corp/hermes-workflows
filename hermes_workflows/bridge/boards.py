"""Board resolution: a project-scoped workflow runs its durable cards on the
bound project's Kanban board (board slug == project slug, matching the platform
project name convention); a global workflow has no board. Boards are auto-ensured
(idempotent, ``mkdir -p`` semantics) so a first run never parks for a missing
board.
"""

from __future__ import annotations

from typing import Optional, Sequence

from hermes_cli import kanban_db as kb

_PROJECT_SCOPES = frozenset({"project", "projects"})


def board_slug_for(
    scope_type: str,
    projects: Sequence[str],
    *,
    project_id: Optional[str] = None,
) -> Optional[str]:
    """The board slug for a scope: the run's bound project (``project_id`` wins),
    else the scope's first declared project. ``None`` for global or unbound."""
    if scope_type not in _PROJECT_SCOPES:
        return None
    slug = project_id or (projects[0] if projects else None)
    return slug or None


def ensure_board(slug: str) -> str:
    """Create the board if absent (idempotent); return the slug."""
    kb.create_board(slug)
    return slug


def resolve_board(scope: dict, *, project_id: Optional[str] = None) -> Optional[str]:
    """Resolve and auto-ensure the board for a workflow ``scope`` mapping
    (``{type, projects?}``). Returns the board slug for project scope, ``None``
    for global scope or a project scope with no bound project."""
    slug = board_slug_for(
        scope.get("type", ""), scope.get("projects") or [], project_id=project_id
    )
    if slug is None:
        return None
    return ensure_board(slug)

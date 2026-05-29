"""Hermes Workflows — thin Python bridge.

This package is intentionally minimal: it only touches Hermes primitives
(Kanban, Cron, Profiles) and exposes the dashboard router. All workflow logic
lives in the TypeScript core (see ``packages/core``). Keep imports cheap so
Hermes startup stays fast — do not import the heavy core here.
"""

from __future__ import annotations

__version__ = "0.1.0"

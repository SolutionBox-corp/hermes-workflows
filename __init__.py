"""Hermes plugin entrypoint.

Hermes loads this directory's ``__init__.py`` and calls ``register(ctx)``. The
real implementation lives in ``hermes_workflows/plugin.py``; we add this
directory to ``sys.path`` so the ``hermes_workflows`` package resolves as a
top-level import regardless of how Hermes namespaces the plugin module.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hermes_workflows.plugin import register  # noqa: E402,F401

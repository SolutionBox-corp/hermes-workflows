"""Node-execution backends behind a common seam."""

from .base import Completion, NodeExecutor, select_executor

__all__ = ["Completion", "NodeExecutor", "select_executor"]

"""The ``hermes-workflows`` command — a thin entrypoint over the orchestrator.

Subcommands:
  run <workflow_id> [--project P]   start a run and advance it once
  advance-all                        advance every active run (the tick body)
  status <run_id>                    print a run's current state
  review <run_id> <node_id> <dec>    resolve a human_review node

Each prints a JSON document to stdout. The installed wrapper (``bin/hermes-
workflows``) execs this module; cron jobs invoke the same command.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from typing import Any, Optional, Sequence

from . import config
from .engine import Engine


def build_engine() -> Engine:
    """Wire the orchestrator to the live Hermes runtime: a Kanban backend on the
    runtime board and a Direct backend over the profile runners."""
    from hermes_cli import kanban_db as kb

    from .executor import DirectExecutor, KanbanExecutor

    board = kb.connect(board=config.runtime_board())
    return Engine(
        core_cli=config.core_cli(),
        db_path=str(config.runs_db_path()),
        kanban=KanbanExecutor(board),
        direct=DirectExecutor(
            runner_dir=config.runner_dir(), store_dir=config.direct_store_dir()
        ),
    )


def _spec_path_for_workflow(engine: Engine, workflow_id: str) -> str:
    specs = engine._core(["list-specs", "--roots", ",".join(config.spec_roots())])
    for spec in specs:
        if spec["id"] == workflow_id:
            return spec["path"]
    raise SystemExit(f"unknown workflow '{workflow_id}'")


def _spec_path_for_run(engine: Engine, run_id: str) -> str:
    run = engine.status(run_id)
    return _spec_path_for_workflow(engine, run["workflow_id"])


def _dispatch(args: argparse.Namespace, engine: Engine) -> Any:
    if args.command == "run":
        spec = _spec_path_for_workflow(engine, args.workflow_id)
        run_id = f"{args.workflow_id}-{uuid.uuid4().hex[:8]}"
        return engine.run(spec, run_id, project_id=args.project)
    if args.command == "advance-all":
        return engine.advance_all(config.spec_roots())
    if args.command == "status":
        return engine.status(args.run_id)
    if args.command == "review":
        spec = _spec_path_for_run(engine, args.run_id)
        return engine.decide_review(spec, args.run_id, args.node_id, args.decision)
    raise SystemExit(f"unknown command '{args.command}'")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hermes-workflows")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="start a run and advance it once")
    p_run.add_argument("workflow_id")
    p_run.add_argument("--project", default=None)

    sub.add_parser("advance-all", help="advance every active run")

    p_status = sub.add_parser("status", help="print a run's state")
    p_status.add_argument("run_id")

    p_review = sub.add_parser("review", help="resolve a human_review node")
    p_review.add_argument("run_id")
    p_review.add_argument("node_id")
    p_review.add_argument("decision")

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parser().parse_args(argv)
    result = _dispatch(args, build_engine())
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())

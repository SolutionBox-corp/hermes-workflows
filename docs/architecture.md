# Architecture

Hermes Workflows compiles a workflow graph onto native Hermes primitives. It is
a thin orchestration layer, not a separate engine.

```text
@xyflow editor (later)        model tools (workflow_list/run/status/explain)
        |                                   |
   workflow specs (YAML/JSON)               |
        |                                   v
   TypeScript core (Bun)  <----- cli_bridge -----  Python orchestrator
   schema · validation · compiler · advance · run-state persistence
        |                                   |
        |                          Kanban · Cron · Profiles bridges
        v                                   v
   runs.db (SQLite)                 native Hermes primitives
                                    + optional OpenSecondBrain memory
```

## Topology

- **TypeScript core (`packages/core`)** owns everything that interprets a spec:
  schema and loader, validation, the compiler (graph to Hermes plan), the pure
  `advance` decision, and run-state persistence (`runs.db`). It is exposed as a
  JSON-in/JSON-out CLI (`cli.ts`).
- **Python orchestrator (`hermes_workflows`)** is the only place that touches
  Hermes. It drives the core CLI via `cli_bridge` for pure decisions and
  persistence, and performs Kanban/Cron/Profiles I/O through the bridges. The
  spec is therefore interpreted in exactly one place (TypeScript).
- **Plugin shell (`__init__.py`, `plugin.yaml`)** registers four model tools
  with lazy handlers; the engine is not imported at startup, and no O2B
  detection runs at load.
- **Dashboard (`dashboard/`)** is a read-only Workflows tab (manifest +
  `plugin_api.py` + a build-free bundle).

## Execution model

A run advances durably. Each tick:

1. ingest completions for active `agent_task` cards from native `task_runs`,
2. ask the core for the next scheduling decision (`advance`, pure),
3. create Kanban cards for newly scheduled nodes,
4. persist the run to `runs.db`.

Advancement is driven by a transient Cron tick — a single named job created
while runs are active and removed when none remain, so tick jobs never
accumulate. `advance` is idempotent: a repeated tick never duplicates work
(native `idempotency_key`), and loop edges (fix to validate) re-run a node on a
fresh card keyed by iteration.

## Native Hermes mapping

| Workflow concept | Native primitive |
| --- | --- |
| `agent_task` node | Kanban task assigned to a profile, stamped with `workflow_template_id` / `current_step_key` |
| node outcome | `task_runs.outcome` (`completed` to success, else failure; worker may override via metadata) |
| sequential edge | `task_links` parent/child |
| human_review / completion notice | `kanban_notify_subs` + the gateway kanban-notifier |
| cron trigger | a Hermes Cron job running the workflow |
| retries / workspace / model / skills | native `max_retries` / `workspace_kind` / `model_override` / `skills` columns |

If a future Hermes version routes on these columns itself, the plugin already
speaks the same vocabulary and can defer to it.

## Storage

- `runs.db` (SQLite, WAL): `workflow_runs`, `workflow_node_runs` (one row per
  node, current state), `workflow_schedules`. Source of truth for run state.
- Specs: `~/.hermes/workflows/{global,templates}` and
  `<project>/.hermes/workflows`.
- Artifacts: `~/.hermes/workflows/runs/<run_id>/...`.
- OpenSecondBrain is never runtime storage — only optional long-term memory.

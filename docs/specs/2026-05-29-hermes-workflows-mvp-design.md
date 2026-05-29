# Hermes Workflows — MVP Design

Status: draft for review
Audience: implementers of the `hermes-workflows` Hermes plugin
Source vision: `Projects/HermesWorkflows/Docs/hermes-workflows-tz` (Obsidian) — treated as
loose vision, not a binding contract. This document supersedes it where they differ.

## 1. Purpose and guiding principle

`hermes-workflows` is a Hermes Agent plugin that lets a user describe, run, and observe
workflows expressed as a directed graph, compiled onto **native Hermes primitives** rather
than a bespoke workflow engine.

```
Workflow graph -> Hermes-native execution primitives
```

The plugin is a thin orchestration layer over Hermes Kanban, Cron, and Profiles. It does
**not** replace any of them and does not ship a heavyweight engine. OpenSecondBrain (O2B) is
an optional long-term memory layer, never runtime storage.

### Design constraints

- SOLID, KISS, DRY. Small, single-purpose units with explicit interfaces.
- Mirror OpenSecondBrain tooling 1:1 (Bun runtime, oxlint + oxfmt, strict TypeScript,
  thin Python shim). See §3.
- Be as native as the current Hermes schema allows (see §5). Prefer native columns and
  mechanisms over parallel bookkeeping.
- Fast plugin startup. The thin Python entrypoint must not import the heavy core, and any
  O2B auto-detection failure must never break Hermes startup.

## 2. Scope

### In scope (MVP)

A workflow can be authored as a portable YAML/JSON spec, started via CLI or a model-visible
tool, executed durably through Kanban + a transient Cron tick, with run state persisted in a
local SQLite database, optionally writing a retrospective to O2B, and observed through a
minimal read-only dashboard tab.

Epics (see §14):

- **E1 Core** — schema, validation, compiler (graph -> plan), conditions, run-state model.
- **E2 Persistence** — `runs.db` (SQLite), spec loader/storage, filesystem artifacts.
- **E3 Hermes bridges** — kanban, cron (transient tick), profiles, feature detection.
- **E4 Plugin shell** — `plugin.yaml`, thin `__init__.py`, CLI, four model tools.
- **E5 O2B memory** — provider interface, Noop + CLI providers, fail-open.
- **E6 Minimal dashboard** — read-only "Workflows" tab (list only, no editor, no styling).

### Deferred (post-MVP, separate specs)

- **E7 Visual editor** — full `@xyflow/react` editor: node palette, inspector, validation
  panel, compile preview, run inspector.
- `script` node and integration nodes (`http_request`, `o2b_write`, `delay`, `parallel`,
  `subworkflow`, ...).
- Lightweight synchronous execution mode for short script-only workflows.
- O2B MCP provider.
- `kanban_event` / `webhook` / `file_change` triggers.
- Expression-based or LLM-based conditions.

### Explicitly NOT building

A full n8n clone, a node marketplace, dozens of integrations, a complex expression language,
collaborative editing, a custom cron engine, a custom Kanban board, O2B as runtime storage,
or a hard dependency on O2B.

## 3. Repository layout and tooling

A Bun-workspace monorepo. Tooling mirrors OpenSecondBrain exactly: Bun runtime, `oxlint`
(+ `unicorn`, `typescript` plugins), `oxfmt` (`printWidth: 100`), strict TypeScript with
`tsc --noEmit`, tests via `bun test`. The Python side is a thin shim with no runtime
dependencies, present only so Hermes can load the plugin in-process.

```
hermes-workflows/
  package.json                # Bun workspaces: packages/*, apps/*
  pyproject.toml              # thin shim; packages = ["hermes_workflows"]
  plugin.yaml                 # Hermes plugin manifest
  __init__.py                 # thin register(ctx)
  tsconfig.json oxlint.json .oxfmtrc.json
  hermes_workflows/           # thin Python bridge to Hermes
    __init__.py
    config.py
    cli_bridge.py             # invokes the Bun core CLI
    bridge/
      kanban.py
      cron.py
      profiles.py
      o2b.py
  packages/core/              # TypeScript engine (Bun)
    package.json
    src/
      schema/      { workflow.ts, run.ts, nodes.ts }
      validation/  validateWorkflow.ts
      compiler/    compileToHermesPlan.ts
      runtime/     { conditions.ts, state.ts, advance.ts }
      memory/      { MemoryProvider.ts, NoopMemoryProvider.ts, O2BCLIProvider.ts }
      cli.ts
  apps/dashboard/             # E6 minimal read-only tab (built to dist/)
  dashboard/                  # Hermes dashboard plugin contract (manifest + api + dist)
    manifest.json
    plugin_api.py
    dist/                     # built bundle from apps/dashboard
  examples/
    feature-development.workflow.yaml
    blog-daily-signals.workflow.yaml
  docs/
    architecture.md
    workflow-schema.md
    dashboard.md
    o2b-integration.md
    specs/
  tests/
```

Validation gate (mirrors O2B `validate`): `bun run typecheck && bun run lint && bun run test`.

## 4. Top-level architecture

```
Hermes Agent
  -> hermes-workflows plugin (thin Python)
       register(ctx): commands, four model tools, dashboard router
       bridge/: kanban, cron, profiles, o2b
  -> TypeScript core (Bun)
       schema -> validation -> compiler -> runtime(state, conditions, advance) -> memory
       exposed via cli.ts; Python calls it through cli_bridge.py
  -> Hermes primitives
       Kanban (durable execution), Cron (triggers + transient tick), Profiles (workers)
  -> runs.db (SQLite, graph/run source of truth) + filesystem artifacts
  -> optional O2B memory provider (fail-open)
```

The TypeScript core owns all graph/spec logic and run-state transitions. Python owns only the
parts that touch Hermes primitives (SQLite Kanban, Cron CLI, profile resolution) and the
dashboard APIRouter.

## 5. Native Hermes affordances we build on

The current Kanban schema (`hermes_cli/kanban_db.py`) already contains forward-compat hooks
the Hermes authors laid down. We lean on them instead of duplicating bookkeeping.

| Native mechanism | How the plugin uses it |
|---|---|
| `tasks.workflow_template_id`, `tasks.current_step_key` | Stamp every agent_task with `workflow_template_id = workflow id` and `current_step_key = node id`. The kernel writes/preserves these in v1 but does not route on them; we use them as the join key between Kanban and our run state. |
| `task_runs(step_key, outcome, summary, metadata, error)` | Attempt history already tags the workflow step. `outcome` maps to `node_status` (`completed` -> success, others -> failure). `summary` is the node output. We do not implement our own retry loop. |
| `tasks.idempotency_key` (dedup on create) | When `advance` schedules a node's task it sets `idempotency_key = "<run_id>:<node_id>"`. A duplicated tick re-uses the existing task instead of creating a second one — solves the at-least-once tick problem natively. |
| `task_links(parent_id, child_id)` | Native task DAG. Sequential workflow edges between agent_task nodes are also expressed as native parent/child links so Kanban/UI understand ordering. |
| `task_events` + gateway `kanban-notifier` | Native per-task event stream and a gateway watcher that pushes `completed`/`blocked` to the originating chat. Used for human_review prompts and run-completion notices via `kanban_notify_subs`; we do not build our own notifier. |
| `tasks.max_retries`, `consecutive_failures`, circuit breaker | Node `max_retries` maps to the native column; the dispatcher enforces retries/circuit-breaking. |
| `tasks.workspace_kind`, `workspace_path`, `branch_name` | Node `workspace.type` (`scratch` / `worktree`) maps to native workspace handling. |
| `tasks.model_override`, `tasks.skills` | Node `model` and `skills` map directly to native per-task columns. |
| `tasks.result`, `tasks.current_run_id`, `tasks.session_id` | Output capture, cheap in-flight check, and originating-session propagation. |
| Cron one-shot schedules (`"once in <dur>"`) + `origin` | The transient tick is a self-rescheduling one-shot (see §8); `origin` routes notifications to the right Telegram topic. |
| WAL + long busy timeout pattern | Mirrored in our own `runs.db` since the tick and dashboard read concurrently. |

**Migration path.** If a future Hermes version turns these columns into a real dispatcher-level
workflow router, the plugin already speaks the same vocabulary and can delegate to it rather
than conflict.

**Defensive fallback.** Column presence is verified via `PRAGMA table_info(tasks)`. If a column
is missing (older DB), the plugin degrades gracefully and keeps full state in `runs.db`.

## 6. Workflow spec model

Portable YAML/JSON. Authored fields:

```
id, name, version
scope: { type: global | project | projects, projects: [] }
trigger: { ... }                 # see §7.1
defaults: { profile, model, max_retries, memory: { provider, fail_open } }
nodes: [ ... ]                   # see §7
edges: [ { from, to, condition? } ]   # see §7.4
ui: { xyflow: { nodes: [...positions...], viewport } }   # layout only
```

**Hard requirement:** a spec is valid and executable without the `ui:` section. Layout state is
strictly separated from execution semantics.

Storage locations:

```
~/.hermes/workflows/global/*.workflow.yaml
~/.hermes/workflows/templates/*.workflow.yaml
<project>/.hermes/workflows/*.workflow.yaml
```

## 7. Node types (MVP)

Five node types. The agent_task ("text prompt") node is the primary one.

### 7.1 trigger

Starts the workflow. Exactly one per workflow.

- `manual` — started via CLI / `workflow_run` tool / dashboard.
- `cron` — `{ schedule, timezone }`, compiled to a Hermes Cron job that invokes
  `hermes-workflows run <id>`.

### 7.2 agent_task (primary)

```yaml
type: agent_task
title: ...
profile: <profile>        # -> task assignee
model: <model?>           # -> tasks.model_override
skills: [ ... ]           # -> tasks.skills
workdir: <path?>
workspace: { type: scratch | worktree }   # -> tasks.workspace_kind
prompt: |                 # the core "text prompt"
  ...
input_mapping: { ... }    # optional; templated refs to prior node outputs
max_retries: <n?>         # -> tasks.max_retries
timeout_seconds: <n?>     # -> tasks.max_runtime_seconds
```

Executed as a Hermes Kanban task assigned to `profile`, stamped with
`workflow_template_id`/`current_step_key` and an idempotency key. Output is read from
`tasks.result` / `task_runs.summary`; status from `task_runs.outcome`.

### 7.3 human_review

Pauses the run until a human decides.

```yaml
type: human_review
title: ...
options: [ approved, rejected, needs_changes ]
```

While waiting, the run status is `waiting`; the originating chat is notified via the native
kanban-notifier subscription. The decision is supplied via CLI / tool / dashboard and selects
the matching outgoing edge.

### 7.4 condition

Selects an outgoing edge. **Structured conditions only** — no expression or LLM routing.

```yaml
condition:
  type: node_status     # { node, equals: success | failure }
# or
  type: review_status   # { equals: approved | rejected | needs_changes }
```

Validation requires that a branching point either covers every possible value or declares an
explicit `fallback` edge.

### 7.5 finish

Terminal node. `{ outcome: success | failure }`. Closes the workflow run.

## 8. Execution model (durable, transient tick)

```
workflow_run created (status = running)
  -> engine schedules the first node
  -> agent_task: kanban bridge creates a task for the profile
       (stamped workflow_template_id/current_step_key, idempotency_key = run:node)
  -> ensure_tick(): if active runs exist, schedule the transient tick (see below)
  -> [tick] advance():
       read completed steps via task_runs.outcome for our workflow_template_id
       map outcome -> node_status
       evaluate outgoing edges (conditions)
       schedule next node(s); update runs.db
  -> human_review: run -> waiting; native notification to originating chat
  -> finish: run -> completed | failed
  -> when no active runs remain: tick is not rescheduled (self-terminates)
```

### Transient tick

There is no permanent per-run cron job and no long-running daemon. A single advance step is
driven by a **self-rescheduling one-shot Hermes Cron job** (`"once in N minutes"`): each
`advance` run reschedules itself only while at least one run is active, and simply stops
rescheduling once all runs are terminal. This satisfies the requirement that tick jobs never
accumulate. (A single recurring job created on first active run and removed on drain is an
acceptable equivalent; the one-shot chain is preferred for cleanliness.)

### Idempotency and crash safety

`advance` is safe to run more than once: node-task creation is deduplicated by
`idempotency_key`, and edge evaluation is a pure function of persisted state. Run state lives
in `runs.db`; Kanban holds durable execution state. Neither requires a process to stay alive.

## 9. Storage and run state

SQLite at `~/.hermes/workflows/runs.db` (WAL, long busy timeout), tables per the vision:
`workflow_runs`, `workflow_node_runs`, `workflow_schedules`. `workflow_node_runs.hermes_task_id`
links a node run to its Kanban task; the native `workflow_template_id`/`current_step_key`
columns make the reverse lookup cheap and robust.

Artifacts on the filesystem:

```
~/.hermes/workflows/runs/<run_id>/
  input.json output.json
  nodes/<node_id>/{ input.json, output.json, logs.txt, artifacts/ }
```

Run statuses: `created, running, waiting, completed, failed, cancelled`.
Node statuses: `pending, scheduled, running, waiting_for_review, completed, failed, skipped, cancelled`.

O2B is never used as runtime storage.

## 10. Hermes bridges (thin Python)

- **kanban.py** — create a task for a profile; stamp workflow columns + idempotency key; map
  node fields to native columns; read completion `outcome`/`summary`/`result`; feature-detect
  columns via `PRAGMA`.
- **cron.py** — register `cron` triggers as Hermes Cron jobs; manage the transient tick
  (schedule/reschedule/stop); persist `workflow_schedule_id -> hermes_cron_id`; pause / resume /
  delete a schedule without deleting the workflow definition.
- **profiles.py** — resolve a profile name for task assignment.
- **o2b.py** — auto-detect O2B and expose it to the core memory provider (see §11).

Bridges are invoked from the TS core via `cli_bridge`; the core stays on Bun and only Python
touches Hermes primitives.

## 11. OpenSecondBrain integration (optional, fail-open)

```ts
interface WorkflowMemoryProvider {
  isAvailable(): Promise<boolean>
  readContext(req: WorkflowContextRequest): Promise<WorkflowContext>
  writeEvent(event: WorkflowMemoryEvent): Promise<void>
  writeRetrospective(retro: WorkflowRetrospective): Promise<void>
}
```

MVP implementations: `NoopMemoryProvider` (default) and `O2BCLIProvider`
(auto-detected via the `o2b` CLI / config / `brain doctor`). The MCP provider is post-MVP.

Modes: `disabled`, `auto`, `explicitly configured`. When O2B is absent: reads return empty
context, writes are skipped, the workflow proceeds, and the dashboard shows "O2B: not connected".

What we write (only useful events, never every micro-step): `run_completed`, `node_failed`, and
the post-run `retrospective` (the main value). All writes pass through a secret redactor and are
`fail_open: true` — O2B unavailability never fails a workflow or Hermes startup.

## 12. Model-visible tools

A deliberately narrow set; the model never gets full graph CRUD (editing is human-only via
CLI / dashboard).

- `workflow_list` — available workflows.
- `workflow_run` — start a workflow (`workflow_id`, `project_id?`, `input?`).
- `workflow_status` — run state (`run_id`, `status`, `current_node`).
- `workflow_explain` — describe what a workflow does without running it.

## 13. Plugin shell and dashboard

`plugin.yaml`: `kind: standalone`, `provides_tools` = the four tools above. `__init__.py`
exposes a thin `register(ctx)` that does not import the heavy core at startup.

The minimal dashboard (E6) follows the **real** Hermes dashboard-plugin contract observed in
`plugins/example-dashboard` and `plugins/kanban/dashboard` (not the vision's guessed format):

```json
// dashboard/manifest.json
{
  "name": "workflows",
  "label": "Workflows",
  "description": "Visual workflow orchestration over Hermes primitives.",
  "icon": "Workflow",
  "version": "0.1.0",
  "tab": { "path": "/workflows", "position": "after:skills" },
  "slots": [],
  "entry": "dist/index.js",
  "api": "plugin_api.py"
}
```

`dashboard/plugin_api.py` exports a thin FastAPI `APIRouter` (read-only in MVP: list workflows
and runs). `apps/dashboard` builds to `dashboard/dist/index.js` and renders only a list — no
editor, no custom styling.

## 14. Security

- **No `script` node in MVP**, which removes the main attack surface (arbitrary shell). When it
  lands post-MVP it requires: `workdir`-only execution, timeout, env allowlist (never the full
  env), command preview before save, and explicit per-workflow enablement.
- A secret redactor runs before any write to logs, artifacts, O2B, or Kanban comments
  (API keys, tokens, passwords, private keys, secret-bearing connection strings).
- O2B writes are fail-open and redacted.

## 15. Testing

- `bun test` for the core: schema, validation, compiler, and conditions are pure functions and
  are unit-tested directly.
- Bridge tests run against a temporary SQLite database.
- End-to-end: `manual run -> mock Kanban completion -> advance -> finish`, including a
  duplicate-tick idempotency test and a `node_status failure -> fix -> re-validate` loop.

## 16. Build phasing

Core-first, headless. Build and test the engine (E1 -> E2 -> E3 -> E4 -> E5) before any UI; the
dashboard (E6) is added last, on top of the finished HTTP API. The visual editor (E7) is a
separate later phase with its own spec. A dedicated Kanban board (`hermes-workflows`) tracks the
work; cards are filled after this spec is approved.

## 17. Acceptance criteria (MVP)

- Hermes loads the plugin; it starts without O2B and without a built dashboard; an O2B
  auto-detect error does not break startup.
- A workflow can be authored as a spec, validated, started manually and on a cron schedule.
- `agent_task` creates a Hermes Kanban task assigned to the right profile, stamped with
  `workflow_template_id`/`current_step_key` when available, degrading gracefully otherwise.
- A cron trigger creates a Hermes Cron binding that can be paused / resumed / deleted; run
  history records the trigger source.
- The transient tick advances active runs and self-terminates when none remain; duplicate ticks
  never create duplicate tasks.
- `human_review` pauses the run and notifies the originating chat; a decision resumes the run on
  the matching edge.
- If O2B is available, a retrospective can be written; a write failure does not fail the run.
- The dashboard shows a read-only "Workflows" list.

# Hermes Workflows MVP — Implementation Plan

> **For Hermes:** implement task-by-task off the `hermes-workflows` Kanban board. Each card is
> an independently reviewable unit; run TDD inside each card. Cards carry their dependencies as
> native `task_links` (parents must be done first).

**Goal:** Ship a headless, durable workflow engine for Hermes that compiles a graph spec onto
native Kanban/Cron/Profiles primitives, with a minimal read-only dashboard and optional O2B
memory.

**Architecture:** TypeScript core on Bun (schema, validation, compiler, runtime, memory) +
thin Python bridge to Hermes (kanban, cron, profiles, o2b) + minimal dashboard plugin. Run
state in `~/.hermes/workflows/runs.db`; durable execution via Kanban; advancement via a
self-rescheduling one-shot Cron tick.

**Tech stack:** Bun, TypeScript (strict), `bun:sqlite`, oxlint, oxfmt, FastAPI APIRouter
(dashboard), Python 3.11 shim. Tooling mirrors OpenSecondBrain.

**Build order:** E1 → E2 → E3 → E4 → E5 → E6, then finalization. Reference spec:
`docs/specs/2026-05-29-hermes-workflows-mvp-design.md`.

---

## E1 — Core (TypeScript engine)

### E1.1 Scaffold the Bun monorepo and tooling
**Objective:** Create the workspace skeleton with the OSB toolchain so every later card has a
green `validate` gate.
**Files:** `package.json` (workspaces `packages/*`, `apps/*`; scripts: `typecheck`, `lint`,
`lint:fix`, `fmt`, `test`, `validate`), `tsconfig.json`, `oxlint.json`, `.oxfmtrc.json`
(printWidth 100), `packages/core/package.json`, `packages/core/src/index.ts` (placeholder),
`tests/smoke.test.ts`, `.gitignore`.
**Approach:** Copy tool configs from OpenSecondBrain (`/srv/projects/open-second-brain`) and
adapt names. `validate = bun run typecheck && bun run lint && bun run test`.
**Acceptance:** `bun install` succeeds; `bun run validate` passes on the smoke test.
**Deps:** none.

### E1.2 Workflow schema types + JSON Schema
**Objective:** Define the typed model for specs and the canonical JSON Schema (single source of
truth for validation and the future editor).
**Files:** `packages/core/src/schema/nodes.ts`, `schema/workflow.ts`, `schema/run.ts`,
`schema/workflow.schema.json`, `tests/schema/workflow.schema.test.ts`.
**Approach:** Model the 5 node types (`trigger`, `agent_task`, `condition`, `human_review`,
`finish`), `edges[{from,to,condition?,fallback?}]`, `scope`, `trigger` (`manual`|`cron`),
`defaults`, and a separated `ui` block. Conditions: `node_status{node,equals}` and
`review_status{equals}` only. Keep types and JSON Schema in lockstep (test asserts a sample
spec validates and a malformed one fails).
**Acceptance:** Types compile; schema validates the two `examples/*.workflow.yaml`; negative
cases rejected.
**Deps:** E1.1.

### E1.3 Spec loader (YAML/JSON → typed Workflow)
**Objective:** Parse a spec file into a typed `Workflow`, stripping `ui` from execution data.
**Files:** `packages/core/src/schema/load.ts`, `tests/schema/load.test.ts`.
**Approach:** Accept YAML or JSON; validate against the JSON Schema; return `{workflow, ui}`
separately. A spec without `ui` must load and be fully executable.
**Acceptance:** Loads both examples; round-trips; spec without `ui` loads.
**Deps:** E1.2.

### E1.4 Workflow validation rules
**Objective:** Structural validator producing errors/warnings.
**Files:** `packages/core/src/validation/validateWorkflow.ts`, `tests/validation/*.test.ts`.
**Approach:** Rules: exactly one trigger; at least one finish; all nodes reachable from
trigger; no unreachable nodes; every branching point covers all condition values or has a
`fallback` edge; condition `node` refs exist; valid cron expression + timezone; agent_task has
`profile` (or `defaults.profile`). Warnings: cycle without explicit loop policy, O2B enabled
but unavailable, Kanban workflow columns unavailable.
**Acceptance:** Each rule has a passing and failing test; the fix-loop example
(validate→fix→validate) is accepted.
**Deps:** E1.3.

### E1.5 Condition evaluation
**Objective:** Pure function evaluating a condition against run state.
**Files:** `packages/core/src/runtime/conditions.ts`, `tests/runtime/conditions.test.ts`.
**Approach:** `evaluate(condition, runState): boolean`. `node_status` reads a node's mapped
status; `review_status` reads a human_review decision. No expression parsing.
**Acceptance:** Truth-table tests for both condition types incl. missing-node guard.
**Deps:** E1.2.

### E1.6 Run-state model and transitions
**Objective:** Pure model of run + node-run state and legal transitions.
**Files:** `packages/core/src/runtime/state.ts`, `tests/runtime/state.test.ts`.
**Approach:** Run statuses `created|running|waiting|completed|failed|cancelled`; node statuses
`pending|scheduled|running|waiting_for_review|completed|failed|skipped|cancelled`. Transition
helpers reject illegal moves.
**Acceptance:** Legal transitions pass; illegal transitions throw; serialization round-trips.
**Deps:** E1.2.

### E1.7 Compiler: graph → Hermes plan (compile preview)
**Objective:** Produce the deterministic plan/preview from a workflow.
**Files:** `packages/core/src/compiler/compileToHermesPlan.ts`, `tests/compiler/*.test.ts`.
**Approach:** Output `{trigger, first_node, kanban_tasks[], cron_jobs[], profiles[], skills[],
memory, run_records}` matching spec §20.6. No side effects — pure transform.
**Acceptance:** Snapshot test for both examples; manual and cron triggers covered.
**Deps:** E1.4.

### E1.8 Advance decision function
**Objective:** Pure "what next" engine: given run state + newly completed node outcomes, decide
nodes to schedule / wait / finish.
**Files:** `packages/core/src/runtime/advance.ts`, `tests/runtime/advance.test.ts`.
**Approach:** `advance(workflow, runState, completed[]): Decision`. Maps Kanban `outcome` →
node_status, evaluates outgoing edges via E1.5, returns next scheduling actions. Idempotent:
re-running with the same inputs yields the same decision.
**Acceptance:** Linear flow, condition branch (success/failure), fix-loop, human_review gate,
and finish all covered; double-call yields identical decision.
**Deps:** E1.5, E1.6.

---

## E2 — Persistence

### E2.1 runs.db schema and access layer
**Objective:** SQLite store with WAL and a long busy timeout.
**Files:** `packages/core/src/runtime/db/schema.sql`, `db/connection.ts`, `tests/db/connection.test.ts`.
**Approach:** Tables `workflow_runs`, `workflow_node_runs`, `workflow_schedules` per spec
§9/§10.2 (using `bun:sqlite`). Apply `PRAGMA journal_mode=WAL` and `busy_timeout`. Idempotent
init.
**Acceptance:** Init on a temp file creates tables; WAL active; re-init is a no-op.
**Deps:** E1.1.

### E2.2 Run repository
**Objective:** CRUD for runs, node-runs, schedules.
**Files:** `packages/core/src/runtime/db/runRepository.ts`, `tests/db/runRepository.test.ts`.
**Approach:** Create run, upsert node runs, set statuses, link `hermes_task_id`, query active
runs, record schedules. Thin, typed, no business logic.
**Acceptance:** Create→update→query lifecycle tested on temp DB; "active runs" query correct.
**Deps:** E2.1, E1.6.

### E2.3 Spec storage
**Objective:** Discover/load/save specs across the storage locations.
**Files:** `packages/core/src/runtime/specStore.ts`, `tests/runtime/specStore.test.ts`.
**Approach:** Scan `~/.hermes/workflows/{global,templates}` and `<project>/.hermes/workflows`;
list, load (via E1.3), save (preserving `ui`).
**Acceptance:** Lists/loads from a temp HOME; save→load round-trip preserves `ui`.
**Deps:** E1.3.

### E2.4 Filesystem artifacts
**Objective:** Persist per-node input/output/logs.
**Files:** `packages/core/src/runtime/artifacts.ts`, `tests/runtime/artifacts.test.ts`.
**Approach:** Layout `~/.hermes/workflows/runs/<run_id>/nodes/<node_id>/{input,output,logs}`.
Write/read helpers; create dirs lazily.
**Acceptance:** Write then read returns identical content; paths match spec §9.
**Deps:** E2.1.

---

## E3 — Hermes bridges (thin Python)

### E3.1 Python shim scaffold
**Objective:** Loadable Python package + core CLI bridge contract.
**Files:** `pyproject.toml`, `hermes_workflows/__init__.py`, `config.py`, `cli_bridge.py`,
`tests/python/test_cli_bridge.py`.
**Approach:** Mirror OSB's thin-shim `pyproject.toml`. `cli_bridge.run(args)` shells out to the
Bun core CLI and returns parsed JSON. No heavy imports at module load.
**Acceptance:** `import hermes_workflows` is cheap; `cli_bridge` invokes a stub core CLI and
parses JSON.
**Deps:** E1.1.

### E3.2 Kanban bridge — create + read native columns
**Objective:** Create agent_task tasks mapped to native columns; read completion.
**Files:** `hermes_workflows/bridge/kanban.py`, `tests/python/test_kanban_bridge.py`.
**Approach:** Use `hermes_cli.kanban_db`. Create with `assignee=profile`,
`workflow_template_id=workflow_id`, `current_step_key=node_id`, `idempotency_key="<run>:<node>"`,
mapping `model→model_override`, `skills`, `max_retries`, `workspace`, `max_runtime_seconds`.
`PRAGMA table_info` feature-detect for the workflow columns; degrade gracefully. Read
completion from `task_runs.outcome`/`summary` and `tasks.result`.
**Acceptance:** Against a temp Kanban DB: create stamps columns + idempotency dedups a second
create; reading a completed run returns outcome+summary; missing-column path works.
**Deps:** E3.1.

### E3.3 Kanban bridge — sequential edges as task_links
**Objective:** Express sequential dependencies as native parent/child links.
**Files:** `hermes_workflows/bridge/kanban.py` (extend), `tests/python/test_task_links.py`.
**Approach:** When scheduling a node whose predecessor is a Kanban-backed node, add a
`task_links(parent_id, child_id)` row.
**Acceptance:** Links created and queryable on temp DB.
**Deps:** E3.2.

### E3.4 Cron bridge — triggers + transient one-shot tick
**Objective:** Register cron triggers and manage the self-rescheduling tick.
**Files:** `hermes_workflows/bridge/cron.py`, `tests/python/test_cron_bridge.py`.
**Approach:** Use `hermes cron` to (a) create a cron-trigger job invoking
`hermes-workflows run <id>`, persisting `workflow_schedule_id→hermes_cron_id`; (b) manage a
single one-shot tick job (`"once in N min"`) invoking `hermes-workflows advance`, rescheduled
by `advance` only while active runs exist and never otherwise. Pause/resume/delete a schedule
without deleting the workflow. Pass `origin` so notifications route to the right chat.
**Acceptance:** Create/pause/resume/delete tested against a temp cron jobs file; tick is created
when active runs exist and not rescheduled when none remain.
**Deps:** E3.1, E2.2.

### E3.5 Profiles bridge
**Objective:** Resolve a profile name for assignment.
**Files:** `hermes_workflows/bridge/profiles.py`, `tests/python/test_profiles_bridge.py`.
**Approach:** Read the agent roster; validate a profile exists; fall back to `defaults.profile`.
**Acceptance:** Known profile resolves; unknown raises a clear error.
**Deps:** E3.1.

### E3.6 Human-review + completion notifications
**Objective:** Notify the originating chat on review-needed and run completion.
**Files:** `hermes_workflows/bridge/kanban.py` (extend), `tests/python/test_notify.py`.
**Approach:** Register a `kanban_notify_subs` subscription (platform+chat+thread) when a
human_review node is reached and on run completion; rely on the gateway kanban-notifier.
**Acceptance:** Subscription row created with correct origin on a temp DB.
**Deps:** E3.2.

---

## E4 — Plugin shell, CLI, model tools

### E4.1 Plugin manifest + thin entrypoint
**Objective:** Hermes can load the plugin with fast startup.
**Files:** `plugin.yaml`, `__init__.py`, `tests/python/test_register.py`.
**Approach:** `plugin.yaml` (`kind: standalone`, `provides_tools` = four tools). `register(ctx)`
logs load and registers commands/tools with lazy imports; no core import at startup; O2B
detection failure is caught and ignored.
**Acceptance:** `register` runs without importing the core; simulated O2B failure does not raise.
**Deps:** E1.1.

### E4.2 Core CLI
**Objective:** `hermes-workflows` CLI surface used by bridges and cron.
**Files:** `packages/core/src/cli.ts`, `tests/cli/*.test.ts`.
**Approach:** Subcommands `list`, `validate`, `compile-preview`, `run`, `status`, `explain`,
`advance`. JSON output. `advance` loads active runs, calls E1.8, applies scheduling via bridges,
manages the tick.
**Acceptance:** Each subcommand has a test; `validate`/`compile-preview`/`explain` work offline.
**Deps:** E1.7, E1.8, E2.2.

### E4.3 cli_bridge wiring
**Objective:** Connect Python bridges to the Bun CLI both ways.
**Files:** `hermes_workflows/cli_bridge.py` (finalize), `tests/python/test_cli_bridge_e2e.py`.
**Acceptance:** Python `run`/`status`/`advance` round-trip through the real CLI on a temp HOME.
**Deps:** E4.2, E3.2, E3.4.

### E4.4 Model-visible tools
**Objective:** Register `workflow_list`, `workflow_run`, `workflow_status`, `workflow_explain`.
**Files:** `hermes_workflows/tools.py`, `tests/python/test_tools.py`.
**Approach:** Each tool delegates to `cli_bridge`. No graph CRUD exposed.
**Acceptance:** Tool schemas valid; each delegates and returns the documented shape.
**Deps:** E4.3.

### E4.5 End-to-end durable run
**Objective:** Prove the full loop headless.
**Files:** `tests/e2e/durable_run.test.ts` (+ Python harness as needed).
**Approach:** Manual run → mock Kanban completion → `advance` → finish. Include duplicate-tick
idempotency and a `node_status failure → fix → re-validate` loop.
**Acceptance:** All three e2e scenarios pass on a temp HOME.
**Deps:** E4.3.

---

## E5 — OpenSecondBrain memory (optional, fail-open)

### E5.1 Memory provider interface + Noop
**Objective:** Define the provider seam; default to no-op.
**Files:** `packages/core/src/memory/MemoryProvider.ts`, `memory/NoopMemoryProvider.ts`,
`tests/memory/noop.test.ts`.
**Acceptance:** Noop returns empty context; writes are skipped silently.
**Deps:** E1.1.

### E5.2 O2B CLI provider + auto-detection
**Objective:** Detect and use O2B via its CLI.
**Files:** `packages/core/src/memory/O2BCLIProvider.ts`, `tests/memory/o2bCli.test.ts`.
**Approach:** `isAvailable` via `o2b`/config/`brain doctor`; `writeRetrospective`/`writeEvent`
via CLI. Mock the CLI in tests.
**Acceptance:** Available/unavailable paths tested with a mocked CLI.
**Deps:** E5.1.

### E5.3 Redaction + fail-open wiring
**Objective:** Redact secrets and never fail the run on memory errors.
**Files:** `packages/core/src/memory/redact.ts`, wire into advance/finish, `tests/memory/redact.test.ts`.
**Approach:** Redact API keys/tokens/passwords/private keys before any write. Write
`run_completed`, `node_failed`, `retrospective` only. `fail_open: true` swallows provider errors.
**Acceptance:** Secrets redacted; a throwing provider does not fail the run.
**Deps:** E5.2, E4.5.

---

## E6 — Minimal read-only dashboard

### E6.1 Dashboard manifest + read-only API router
**Objective:** Register a Workflows tab backend.
**Files:** `dashboard/manifest.json`, `dashboard/plugin_api.py`, `tests/python/test_dashboard_api.py`.
**Approach:** Manifest per the real contract (`name/label/description/icon/version/tab/slots/
entry/api`). `plugin_api.py` exposes read-only `GET /workflows` and `GET /runs` via `cli_bridge`.
Mirror `plugins/example-dashboard` and `plugins/kanban/dashboard`.
**Acceptance:** Router returns workflow and run lists; manifest matches the contract.
**Deps:** E4.3.

### E6.2 Minimal list UI
**Objective:** Render the workflows list (no editor, no styling).
**Files:** `apps/dashboard/{package.json,vite.config.ts,src/App.tsx,src/api/client.ts}`, build
output `dashboard/dist/index.js`.
**Approach:** Fetch `/workflows`, render a table (id, name, scope, trigger, last run/status).
Build to `dashboard/dist`.
**Acceptance:** Built bundle loads in the Hermes dashboard and lists workflows.
**Deps:** E6.1.

### E6.3 O2B connection badge
**Objective:** Show O2B integration state.
**Files:** `apps/dashboard/src/App.tsx` (extend), `dashboard/plugin_api.py` (add status route).
**Acceptance:** Shows "connected"/"not connected" from the provider check.
**Deps:** E6.2, E5.2.

---

## Finalization

### F1 Examples, docs, README
**Objective:** Ship the two example workflows and the doc set.
**Files:** `examples/feature-development.workflow.yaml`, `examples/blog-daily-signals.workflow.yaml`,
`docs/architecture.md`, `docs/workflow-schema.md`, `docs/dashboard.md`, `docs/o2b-integration.md`,
`README.md`.
**Approach:** Examples must validate. Docs read as a new product (no migration framing).
`blog` example's `publish` creates a "Ready to publish" Kanban task rather than publishing.
**Acceptance:** Examples pass validation; `bun run validate` green repo-wide.
**Deps:** all epics.

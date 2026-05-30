You are brainstorming architectural variants for the following task. Do not write code. Do not write a final design. Only produce variants and a recommendation.

# Task

Build the **backend foundation for a visual workflow editor** in the `hermes-workflows` project. This epic ships NO UI. It delivers everything the upcoming `@xyflow/react` editor will need server-side, fully test-driven, so the next epic (the editor frontend) can load, edit, validate, preview-compile, save, and run workflows over an HTTP API.

The workflow execution engine already exists and is merged. What is missing is the **authoring / write path**: the editor must be able to read a single workflow's full graph, persist an edited graph back to a portable spec on disk (including visual layout), create new workflows, delete them, validate, compile-preview, run, and inspect runs.

Concretely, deliver:
1. A typed `ui.xyflow` layout block in the workflow schema (node positions + viewport) that round-trips through load AND save, and is ignored by execution/validation. A spec without `ui` must still load and execute.
2. A core write path: serialize an (edited) workflow graph back to a portable spec on disk, validate-before-write (reject invalid graphs), create-new, and delete. Routing the file to the correct storage root by scope (global vs project).
3. The missing dashboard HTTP routes (FastAPI APIRouter): `GET /workflows/{id}` (full graph incl. ui), `PUT /workflows/{id}` (save), `POST /workflows/{id}/validate`, `POST /workflows/{id}/compile-preview`, `POST /workflows/{id}/run`, `GET /runs/{id}` (run inspector detail), `POST /runs/{id}/cancel`, `POST /runs/{id}/retry`.

# Project context

hermes-workflows — a Hermes Agent plugin: a simplified visual workflow layer that compiles a workflow graph onto native Hermes primitives (Kanban, Cron, Profiles), NOT a separate engine.

Runtime / language split (firm architectural rule):
- **TypeScript core** (Bun, `packages/core`) owns ALL spec logic: schema, parse/load, validation, compiler (`compileToHermesPlan`), `advance`, run-state persistence (SQLite via `bun:sqlite`). Exposed as a JSON-emitting CLI.
- **Python orchestrator** (`hermes_workflows/`) is thin and is the ONLY layer that touches Hermes (Kanban/Cron/Profile bridges, dashboard FastAPI router). It drives the core via a Python->Bun subprocess bridge (`cli_bridge`).

Recent commits:
de2422d Merge Phase 2 — autonomous execution (two backends)
4b6c260 docs(execution): mark notifications deferred
c6168e7 fix(engine): isolate a failing run so the tick never wedges
0caffbb feat(e2e): wire per-project + global backends, gateway-driven dispatch
f696744 feat(review): channel-agnostic human_review resolution
c28a27a feat(boards): per-project board resolve + auto-ensure
66919b7 feat(cli): hermes-workflows entrypoint + cron command wiring
91f7308 feat(engine): advance_all + self-terminating dispatch tick
0130b8c feat(engine): scope-selected executor routing
4c56a5d feat(executor): KanbanExecutor + DirectExecutor backends

Relevant existing files:
- packages/core/src/schema/load.ts — `parseWorkflow(source)` already splits `ui` from execution data: `const { ui, ...rest } = raw`, returns `LoadResult { workflow, ui?: unknown }`. `ui` is currently untyped (`unknown`) and is NOT re-emitted anywhere.
- packages/core/src/schema/workflow.ts — typed `Workflow` (id, name, version, scope, trigger, defaults, nodes, edges). No `ui` field on the typed Workflow.
- packages/core/src/runtime/specStore.ts — `SpecStore { list(); load(id); save(id, source) }`. `save` writes the raw `source` string to `roots[0]` only (the primary root); no validation, no scope-based root selection, no serialize-from-graph, no delete.
- packages/core/src/cli/commands.ts — has `cmdValidate`, `cmdCompilePreview`, `cmdExplain`, `cmdListSpecs`, `cmdRunCreate/Load/Save/List`. No save/create/delete spec command.
- dashboard/plugin_api.py — FastAPI APIRouter with only: `GET /workflows`, `GET /runs`, `POST /runs/{id}/review`, `GET /o2b-status`. All other TZ routes are missing.
- The dashboard frontend is currently a hand-written, build-free read-only `dist/index.js` placeholder. The real `@xyflow/react` editor is the NEXT epic and is out of scope here.

Conventions / constraints:
- TypeScript core owns spec logic; Python stays thin. Do NOT move serialization/validation into Python.
- Specs are portable YAML (or JSON). Storage roots: `~/.hermes/workflows/{global,templates}` and `<project>/.hermes/workflows`.
- Bun provides `Bun.YAML.parse`. There is no built-in `Bun.YAML.stringify` — YAML emission, if chosen, needs a strategy (a dependency, JSON-as-YAML-subset, or canonical emitter). No heavy new deps without strong justification.
- A spec must remain valid and executable WITHOUT its `ui` block; `ui` is layout-only.
- Validation must reject an invalid graph BEFORE it is written to disk (no corrupt specs persisted).
- TDD throughout (red->green), zero-warning lint/typecheck, pytest + bun test both green.
- The xyflow editor (next epic) models a graph as JSON nodes/edges + a viewport; whatever round-trip format is chosen must serve that consumer cleanly.
- This is autonomous-friendly: the model already has `workflow_run`/`workflow_status` tools; the editor is human-facing via the dashboard.

# Required output format

Produce exactly 3 distinct architectural variants. For each variant:

### Variant N: <short name>
- **Approach**: 2-3 sentences describing the variant.
- **Trade-offs**: bullet list of pros and cons.
- **Complexity**: small | medium | large
- **Risk**: low | medium | high

The variants should differ primarily on the central fork: **how an edited graph round-trips from the editor to a portable spec on disk** (e.g. structured-graph-in/canonical-emit, raw-source-passthrough, or a hybrid layout-patch-merge), and how the write/validate boundary and scope-based file routing are placed across the TS core vs the Python orchestrator.

After the three variants, add exactly one recommendation:

### Recommended: Variant N
**Rationale**: 2-3 sentences explaining why this variant over the others, considering the project context and constraints above.

Output nothing outside of these sections.

# Editor Backend Foundation — Design

Status: draft (brainstorm complete, Variant 1 chosen)
Author: orchestrator (via feature-release-playbook)
Audience: implementation
Builds on: Phase 2 autonomy (`docs/specs/2026-05-29-phase2-autonomy-design.md`)

## Problem statement

The execution engine is complete, but the dashboard is read-only and there is no
authoring/write path. The upcoming `@xyflow/react` editor needs a server-side
contract to read one workflow's full graph, persist an edited graph (with visual
layout) back to a portable spec, create/delete workflows, validate,
compile-preview, run, and inspect runs. This epic delivers that backend with no
UI.

## Scope

- Typed `ui.xyflow` layout (node positions + viewport) on the schema, round-trips
  through load and save, ignored by execution and validation.
- A zero-dependency spec serializer in the TS core (YAML structure, scalars via
  `JSON.stringify`).
- Core write path: validate-before-write save, create, delete, get-by-id (full
  graph incl. `ui`); scope-based storage-root routing.
- Core run mutations needed by the editor: cancel a run, retry a run (reset the
  failed node, or the whole run).
- Dashboard HTTP routes: `GET /workflows/{id}`, `PUT /workflows/{id}`,
  `POST /workflows/{id}/validate`, `POST /workflows/{id}/compile-preview`,
  `POST /workflows/{id}/run`, `GET /runs/{id}`, `POST /runs/{id}/cancel`,
  `POST /runs/{id}/retry`.

## Out of scope

- The `@xyflow/react` editor frontend and any build pipeline (next epic).
- Schedules-page and settings-page backends (later epic).
- New node/trigger/condition types; richer compile preview.
- Block-scalar YAML prettification (quoted scalars are sufficient here).

## Chosen approach (Variant 1 — Canonical Graph Save)

The editor exchanges a structured graph (typed workflow + `ui`) as JSON over
HTTP. The Python dashboard router stays thin and delegates every spec operation
to the TS core CLI through the existing `cli_bridge`. The TS core owns
serialization, validation-before-write, and scope-based file routing.

### Serialization (the key decision)

Bun has `Bun.YAML.parse` but no stringify. Rather than add a `yaml` runtime
dependency (the project is deliberately dependency-free) or hand-roll a fragile
YAML escaper, the serializer emits YAML *structure* (indented maps, `- ` list
items) and every *scalar* via `JSON.stringify`. JSON double-quoted strings are
valid YAML double-quoted scalars, so the round-trip property
`parseWorkflow(serialize(w, ui))` deep-equals `{ workflow: w, ui }` holds by
construction, with safe escaping of multiline prompts and special characters.

### Storage-root routing

`save` writes to the root that matches the workflow scope:
- `global` -> the global root (`~/.hermes/workflows/global`).
- `project` / `projects` -> the project workflows root when a single bound
  project resolves; otherwise the templates root.
The canonical on-disk path is `<root>/<id>.workflow.yaml`. If a spec with the
same id already exists at a different path, save replaces it (delete-then-write)
so there is exactly one spec per id.

### Validation-before-write

`save` and `create` run `validateWorkflow` first; if it returns errors, the call
throws and nothing is written. The dashboard maps that to HTTP 400 with the
validation errors in the body, so the editor can surface them.

### Run cancel / retry

- `cancel`: load the run, set status `cancelled`, persist. No-op-safe on an
  already-terminal run.
- `retry`: load the run; "whole run" resets node states and status back to the
  entry node; "failed node" resets only the failed node to `pending` and the run
  to `running`. Idempotency keys advance so a retried node gets a fresh handle.

## Design decisions

- The typed `Workflow` stays execution-only; `ui` travels alongside it in
  `LoadResult` and the editor DTO, never inside the executable workflow object.
- The editor DTO returned by `GET /workflows/{id}` is `{ workflow, ui, path }` so
  the editor can render the graph and know where it lives.
- `PUT /workflows/{id}` accepts the same `{ workflow, ui }` shape; the path-id and
  body-id must agree (else 400) to prevent accidental id renames via the editor.
- All new core CLI subcommands emit JSON; the Python side never parses YAML.

## File changes

New:
- `packages/core/src/schema/ui.ts` — typed `UiLayout` / xyflow positions + viewport.
- `packages/core/src/serialize/serializeWorkflow.ts` — the zero-dep emitter.
- TS tests: `serialize.test.ts`, `specWrite.test.ts`, `runMutations.test.ts`.
- Python tests: `test_dashboard_workflow_routes.py`, `test_dashboard_run_routes.py`.

Modified:
- `packages/core/src/schema/load.ts` — parse `ui` into the typed shape.
- `packages/core/src/runtime/specStore.ts` — `saveWorkflow`, `create`, `delete`,
  `getById`, scope-based root routing.
- `packages/core/src/cli/commands.ts` + `cli.ts` — `spec-get`, `spec-save`,
  `spec-create`, `spec-delete`, `run-cancel`, `run-retry`.
- `packages/core/src/runtime/db/runRepository.ts` / `state.ts` — cancel/retry
  helpers if not already expressible.
- `dashboard/plugin_api.py` — the eight new routes.
- `hermes_workflows/cli_bridge.py` / `tools.py` as needed for thin delegation.
- `docs/workflow-schema.md`, `docs/dashboard.md`, `README.md`, `CHANGELOG.md`.

## Risks and open questions

- Run cancel/retry touch run-state semantics; tests must pin the exact reset
  behavior (whole-run vs failed-node) to avoid corrupting an active run.
- `GET /runs/{id}` returns the full run state including per-node detail; confirm
  the existing run-state model already carries node task ids and status (it does,
  from Phase 2) so the inspector has what it needs.
- Replace-on-save (delete old path) must not fire mid-run; save is an authoring
  action and the editor is not expected to edit a running workflow's spec — note
  it, do not over-engineer a lock here.

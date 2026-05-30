# Workflow Authoring Lifecycle — Design

Status: draft (brainstorm complete, Variant 1 chosen) — implementation NOT started
Author: orchestrator (via feature-release-playbook)
Audience: implementation
Builds on: the visual editor + run inspector (`docs/specs/2026-05-30-xyflow-editor-design.md`)

## Problem statement

The dashboard can list, open, edit, and run workflows, but it cannot **create**
one. With no spec on disk the Templates list is empty and the editor is
unreachable, so the dashboard is unusable from a clean state. The core already
supports create/delete/serialize; only the dashboard backend routes and the
Templates-page actions are missing.

## Scope

The Templates-page authoring lifecycle (TZ §20.2), limited to what is buildable
without new run/schedule data:

- **Create** a new workflow from a modal (id, name, scope, trigger), seeded with
  a minimal valid graph, then opened in the editor.
- **Duplicate** an existing workflow under a new id.
- **Delete** a workflow (with confirmation).
- **Export YAML** — download a workflow's on-disk spec.
- Backend routes backing the above: `POST /workflows`, `DELETE /workflows/{id}`,
  `GET /workflows/{id}/export`.

## Out of scope (later epics — roadmap)

These remain from the TZ and are sequenced after this epic. Triggers are
dependency-based, not date-based:

- **Script node** (TZ §13.3): a new `script` node type across core
  (schema/validation/compiler/runtime) and the editor. Independent; unblocks the
  feature-development example workflow.
- **Runs page** (TZ §20.7): a list of runs (the inspector already exists; this
  adds the list view and navigation). Depends only on the existing `GET /runs`.
- **Schedules page** (TZ §20.9): cron schedule management (pause/resume/delete,
  next-run). Blocked on a schedule-CRUD backend that does not exist yet.
- **Settings page** (TZ §20.10): storage/execution/kanban/o2b settings. Blocked
  on a settings backend.
- **Enable/Disable** template flag, **Last run / Last status / Next run** columns
  (depend on Runs/Schedules data), richer node-inspector fields, auto-layout,
  duplicate-node-in-canvas.

## Chosen approach (Variant 1 — create-then-edit + dedicated routes)

A new workflow is created on disk *before* the editor opens, through a dedicated
create route, so the editor's existing load-by-id + `PUT` save path is reused
unchanged. All spec operations stay in the TS core behind thin Python shells.

- **Backend** (`dashboard/plugin_api.py`, thin shells over the core CLI):
  - `POST /workflows` — body `{ workflow, ui? }`; shells `spec-create`
    (refuse-overwrite). Returns the created `{ workflow, ui?, path }`. An
    existing id is `409`; an invalid graph / bad id is `400`.
  - `DELETE /workflows/{id}` — shells `spec-delete`. `404` if absent; returns
    `{ deleted: true }`.
  - `GET /workflows/{id}/export` — resolves the spec path and returns the file as
    `text/yaml` (the stored file is the canonical YAML written by
    `serializeWorkflow`; the route streams it, adding no second serializer).
    `404` if absent.
- **Create UX** — Templates "New workflow" opens a modal collecting id (slug),
  name, scope (`global` | `project` + project ids), and trigger (`manual` |
  `cron` + schedule). On submit the client builds a **minimal valid** spec and
  POSTs it, then routes to the editor with the new id.
- **Minimal valid seed** — `{ id, name, version: 1, scope, trigger, nodes: [{ id:
  "finish", type: "finish", outcome: "success" }], edges: [] }`. Valid because no
  `agent_task` means no profile requirement and the lone `finish` node is its own
  reachable entry. (Confirm against `validateWorkflow` in the first task.)
- **Duplicate** — client-side: GET the source spec, prompt for a new id, mutate
  `id`/`name`, POST create. No new core verb.
- **Export** — client calls the export route and triggers a browser download
  named `<id>.workflow.yaml`.
- **Delete** — confirm dialog → DELETE → refresh the list.

## Design decisions

- **Create ≠ overwrite.** Create uses the core's refuse-overwrite `createWorkflow`
  (via `spec-create`); a clashing id returns `409` and surfaces as a form error,
  never silently clobbering an existing workflow. (This is why `PUT`-as-create
  was rejected.)
- **No client-side YAML.** Export streams the on-disk file; duplicate re-POSTs a
  parsed spec object. The browser never serializes a spec, so there is no second
  emitter to drift from `serializeWorkflow`.
- **Reuse the editor.** Because the spec exists before the editor opens, there is
  no "draft / never-saved" editor state; the editor is unchanged.
- **Client mirrors the id charset** for early form validation, but the core stays
  the authority (it re-validates and owns the 400/409).
- **English in the repo.** UI strings, code, docs in English; operator chat in
  Russian.

## Component / route map (target)

```
dashboard/plugin_api.py
  + POST   /workflows                 -> spec-create (409 on clash, 400 invalid)
  + DELETE /workflows/{id}            -> spec-delete (404 if absent)
  + GET    /workflows/{id}/export     -> text/yaml of the on-disk spec (404)

apps/dashboard/src/
  api/client.ts        + createWorkflow, deleteWorkflow, exportWorkflow
  api/types.ts         + CreateWorkflowBody (reuses Workflow/UiLayout)
  templates/
    NewWorkflowModal.tsx   form (id, name, scope, trigger) -> seeded spec
    seed.ts                buildSeedWorkflow(form): minimal valid Workflow
  pages/TemplatesPage.tsx  + New / Duplicate / Delete / Export actions
  App.tsx                  create -> open editor; list refresh after mutations
```

## File changes (high level)

New: `NewWorkflowModal.tsx`, `seed.ts`, their tests, and pytest for the three
routes. Modified: `plugin_api.py` (+3 routes), `api/client.ts` + `api/types.ts`,
`TemplatesPage.tsx`, `App.tsx`, the committed `dashboard/dist` bundle, and
README / `docs/dashboard.md` / CHANGELOG. The TS core and the editor internals
are untouched (core already has create/delete/serialize).

## Risks and open questions

- **Seed validity** — the single-`finish` seed must pass `validateWorkflow`;
  verify in the first task and adjust the seed if a rule requires otherwise.
- **409 surfacing** — the create modal must render the core's duplicate-id error
  rather than failing opaquely.
- **Export content type** — the host `fetchJSON` parses JSON; the export route
  returns text/yaml, so the client uses a raw fetch (or a text helper), not
  `fetchJSON`, for the download. Resolve the helper in the API-client task.
- **Orphan specs** — an abandoned create leaves a seeded spec on disk; acceptable
  (the user can Delete it). Not worth a cleanup mechanism this epic.

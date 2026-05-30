# Brainstorm audit trail — workflow lifecycle (Epic 5)

Phase 0 of the feature-release-playbook for dashboard workflow authoring
lifecycle (create / duplicate / delete / export YAML).

## Consultant

CLI consultants did not run this round: `claude -p` OOM-killed in prior epics
and `codex exec` could not be launched through the shell (harness instability).
An in-process subagent produced the variants instead (equivalent independent
pass). Full output in `cli-output/consultant.md`; summary and decision below.

- **Variant 1** — Create-then-edit; dedicated `POST /workflows` (`spec-create`,
  refuse-overwrite) + `DELETE /workflows/{id}`; backend `GET .../export`
  (text/yaml); client-side Duplicate (GET → mutate → POST). Medium / low-risk.
- **Variant 2** — Draft-then-save; reuse `PUT` as create-or-overwrite; only add
  DELETE; client-side export + duplicate. Small / high-risk.
- **Variant 3** — Hybrid eager-create in an inline editor panel; dedicated
  POST/DELETE/export/duplicate routes (new core `spec-duplicate` verb). Large /
  medium-risk.

Consultant recommendation: **Variant 1**.

## Orchestrator decision: Variant 1 (create-then-edit + dedicated routes)

Agree with the consultant.

- **Variant 2 rejected**: reusing `PUT` as create cannot distinguish "new" from
  "overwrite", so a clashing id could silently destroy an existing workflow with
  no 409 — it discards core's `createWorkflow` refuse-overwrite guard. It also
  pushes a YAML serializer and a clone into the browser, duplicating
  `serializeWorkflow` and risking drift from the core's canonical output. The
  project's whole point is that the TS core owns spec logic; Variant 2 erodes
  that.
- **Variant 3 rejected**: correct but the largest surface, and it needs a new
  core `spec-duplicate` verb plus a bespoke "create populates the live editor
  session in place" path — scope creep and the hardest path to test, for a
  smoothness gain that does not justify the risk this epic.

### Shape of the chosen approach

- **Backend** (thin Python shells over the existing core CLI):
  - `POST /workflows` → `spec-create` (refuse-overwrite). 409 on existing id,
    400 on invalid graph/id, returns the created `{workflow, ui?, path}`.
  - `DELETE /workflows/{id}` → `spec-delete`. 404 if absent, `{deleted: true}`.
  - `GET /workflows/{id}/export` → returns the on-disk spec as `text/yaml`
    (the stored file is already the canonical YAML; the route resolves the path
    and streams the file). 404 if absent.
- **Create UX** — Templates "New workflow" opens a modal (id slug, name, scope,
  trigger kind). On submit the client POSTs a **seeded minimal-valid** spec (a
  single `finish` node, no edges — valid because there is no agent_task to
  require a profile and the finish node is its own reachable entry), then opens
  the returned spec in the editor via the existing load-by-id path.
- **Duplicate** — client-side: GET the source spec, prompt for a new id, mutate
  `id`/`name`, POST create. No new core verb.
- **Export YAML** — client calls the export route and triggers a browser
  download (`<id>.workflow.yaml`).
- **Delete** — confirm, DELETE, refresh the list.
- API access stays through the injected typed client (tests mock it); the modal
  is a standalone component mockable in isolation.

### Key risks to validate during implementation

- The seeded single-`finish` spec must pass `validateWorkflow` (confirm against
  the actual rules before relying on it as the create seed).
- Duplicate-id create must surface the core's 409 as a form error, not a crash.
- Client-side id slug validation should mirror the core charset so the form
  rejects bad ids before the round-trip (the core remains the authority).
- The export route assumes specs are stored as YAML on disk (true: `spec-save`
  writes via `serializeWorkflow`); the route streams the file rather than
  re-serializing, so there is no second serializer to drift.

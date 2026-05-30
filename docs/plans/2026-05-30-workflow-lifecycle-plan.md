# Workflow Authoring Lifecycle — Implementation Plan

NOT started — planning only; awaits operator go-ahead to implement.

TDD throughout. Backend tasks use pytest (`importorskip("fastapi")`, as the
existing route tests do). Frontend tasks use Vitest + jsdom + React Testing
Library with the API client injected. After each task the frontend `validate`
(typecheck + lint + vitest + build) and the root `bun run validate` must stay
green. Each task is one atomic conventional commit on `feat/workflow-lifecycle`.

## Task 1: Backend lifecycle routes
- Add to `dashboard/plugin_api.py`: `POST /workflows` (shell `spec-create`,
  refuse-overwrite), `DELETE /workflows/{id}` (shell `spec-delete`), and
  `GET /workflows/{id}/export` (resolve path, return the file as `text/yaml`).
- Error mapping: create → `409` on existing id (core `SpecExistsError`/clash
  kind), `400` on invalid graph / id mismatch; delete/export → `404` if absent.
- **Acceptance**: pytest covers create-success (returns the spec, file written),
  create-duplicate → 409, create-invalid → 400, delete-success → `{deleted:true}`,
  delete-missing → 404, export returns the YAML body with a yaml content type,
  export-missing → 404. (Confirm the core CLI error kind for an existing id and
  map it; if the core lacks a distinct kind, add the mapping in the bridge.)
- **Depends on**: none.

## Task 2: API client + types for lifecycle
- `api/client.ts`: add `createWorkflow(body)`, `deleteWorkflow(id)`,
  `exportWorkflow(id): Promise<string>` (raw text, not `fetchJSON`, since the
  body is YAML). `api/types.ts`: `CreateWorkflowBody = { workflow; ui? }`.
- **Acceptance**: client methods build the right URLs/verbs/bodies and parse
  responses, tested against a mocked fetch layer (no network); export returns the
  raw text body.
- **Depends on**: Task 1 (route shapes).

## Task 3: Seed + New-workflow modal
- `templates/seed.ts`: `buildSeedWorkflow({id,name,scope,trigger})` → a minimal
  valid `Workflow` (single `finish` node). Unit-test it passes the core
  `validateWorkflow` (import the pure validator) for manual and cron triggers and
  global/project scopes.
- `templates/NewWorkflowModal.tsx`: form (id slug, name, scope, trigger kind +
  conditional projects/schedule), client-side slug validation, submit → build
  seed → `createWorkflow` → `onCreated(id)`; render the 409 duplicate-id error.
- **Acceptance**: seed validates (red→green via the real validator); the modal
  calls `createWorkflow` with the seeded body and invokes `onCreated` with the id;
  a duplicate-id rejection shows an inline error and does not call `onCreated`.
- **Depends on**: Task 2.

## Task 4: Templates row actions — duplicate, delete, export
- `pages/TemplatesPage.tsx`: per-row Duplicate (prompt new id → GET source →
  mutate id/name → `createWorkflow` → refresh/open), Delete (confirm →
  `deleteWorkflow` → refresh), Export (`exportWorkflow` → browser download
  `<id>.workflow.yaml`).
- **Acceptance**: Duplicate posts a created spec under the new id; Delete calls
  `deleteWorkflow` only after confirmation and refreshes; Export triggers a
  download with the fetched YAML (assert the download wiring against a mocked
  client + stubbed anchor/`URL.createObjectURL`).
- **Depends on**: Task 2.

## Task 5: Wire New into the shell + integration
- `TemplatesPage`: a "New workflow" button opening `NewWorkflowModal`.
- `App.tsx`: `onCreated(id)` routes to the editor (reuses the existing
  `onOpen`/editor path); list refreshes after create/duplicate/delete.
- **Acceptance**: clicking New → filling the modal → submit navigates to the
  editor for the new id (against mocked clients); after delete/duplicate the
  list reflects the change.
- **Depends on**: Tasks 3, 4.

## Task 6: Build wiring, docs, CHANGELOG
- Rebuild and commit `dashboard/dist`; update README (Templates can now
  create/duplicate/delete/export) and `docs/dashboard.md`; add a CHANGELOG entry
  under the **existing 0.1.0** header (do not bump the version).
- **Acceptance**: `bun run validate` green (incl. the committed-bundle guard);
  the frontend `validate` green.
- **Depends on**: Tasks 1–5.

## Verification (phase 4 QA)
- Backend: pytest green (route success + error codes).
- Frontend: typecheck, lint, vitest, vite build green.
- Root `bun run validate` green; committed `dashboard/dist` matches a fresh build.
- Smoke (in tests): New → create → editor → save; duplicate; delete; export.

## Notes
- Operator gate: implementation begins only on explicit go-ahead.
- Version stays 0.1.0 until the operator bumps it.
- No auto-merge will be armed; merge happens only on explicit operator instruction.

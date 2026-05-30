# Changelog

All notable changes to Hermes Workflows are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 - 2026-05-30

Editor backend foundation: everything the visual `@xyflow/react` editor needs
server-side, with no UI yet.

### Added

- Typed, lenient `ui.xyflow` layout (node positions + viewport) on the workflow
  schema. A spec without `ui` still loads and runs; malformed layout is dropped.
- Zero-dependency workflow serializer. `parseWorkflow(serializeWorkflow(w, ui))`
  round-trips losslessly (YAML structure, scalars via `JSON.stringify`), so the
  project keeps no runtime dependencies.
- Spec write path in the core `SpecStore`: `getById`, `saveWorkflow` (validates
  before writing, so no invalid spec is persisted), `createWorkflow`,
  `deleteSpec`, and scope-based root routing (`chooseWriteRoot`).
- Core CLI subcommands `spec-get`, `spec-save`, `spec-create`, `spec-delete`.
- Run mutations `cancelRun` and `retryRun` (whole-run or one failed node), exposed
  as the `run-cancel` and `run-retry` CLI subcommands.
- Dashboard HTTP routes for the editor: `GET`/`PUT /workflows/{id}`,
  `POST /workflows/{id}/validate`, `.../compile-preview`, `.../run`,
  `GET /runs/{id}`, `POST /runs/{id}/cancel`, `POST /runs/{id}/retry`. Invalid
  graphs and id mismatches return `400`; missing workflows/runs return `404`;
  unexpected core failures return `500` (the core CLI emits a structured error
  kind the bridge maps to a status).

### Security

- Workflow ids are validated against a slug charset, so an id can never escape
  the storage root via path traversal when written as `<root>/<id>.workflow.yaml`.
- Map keys (including user-controlled `agent_task.input_mapping` keys) are
  JSON-quoted on serialization, closing a YAML-injection / round-trip break.

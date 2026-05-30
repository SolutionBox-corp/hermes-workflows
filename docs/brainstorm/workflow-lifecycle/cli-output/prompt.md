You are a frontend+backend architecture consultant brainstorming ARCHITECTURAL VARIANTS for one epic. Do NOT write code, do NOT write a final design. Output exactly 3 variants and one recommendation.

# Task (Epic 5: Workflow authoring lifecycle in the Hermes Workflows dashboard)

The dashboard already has (merged): a typed API client over the host `fetchJSON`; a Templates page that LISTS workflows with Open + Run; an `@xyflow/react` flow editor (palette, per-type node inspector, validation panel, compile preview, lossless `ui.xyflow` round-trip, Save via `PUT /workflows/{id}`); and a live run inspector. The TypeScript core (`packages/core`) already supports creating, deleting, and serializing specs (`SpecStore.createWorkflow` which refuses to overwrite an existing id, `SpecStore.deleteSpec`, `serializeWorkflow`), exposed as CLI subcommands `spec-create` and `spec-delete`. The Python dashboard backend currently exposes GET/PUT `/workflows/{id}`, validate, compile-preview, run, GET `/runs`, GET `/runs/{id}`, cancel, retry, review, o2b-status. There is NO create route, NO delete route, NO export route.

The gap: a user cannot CREATE a new workflow from the dashboard, and with zero specs on disk the editor is unreachable. Per TZ §20.2 the Templates page should offer Create, Duplicate, Edit, Run, Enable/Disable, Export YAML, Delete. This epic delivers Create, Duplicate, Delete, Export YAML (Edit/Run already exist; Enable/Disable + last/next-run deferred).

# Constraints
- Pure TS core owns all spec logic (JSON CLI); the Python layer is a thin shell over the core CLI. No spec logic in Python.
- Frontend built with Vite to one bundle; spec/run types shared from `@hermes-workflows/core` via type-only imports.
- TDD; oxlint zero warnings; API client injected for tests.
- Ids become filenames and are slug-validated (path-traversal guard in core).
- Operator chats in Russian; all repo artifacts stay English.
- Out of scope: script node, Runs page, Schedules page, Settings page, Enable/Disable flag, richer node-inspector fields, auto-layout.

# Required output format
Exactly 3 variants, each with Approach (2-3 sentences), Trade-offs (pros/cons), Complexity (small|medium|large), Risk (low|medium|high). Differ primarily on the central forks: (a) create UX create-then-edit vs draft-then-save vs hybrid; (b) backend dedicated POST create + DELETE vs reuse PUT-as-create; (c) export YAML client-side vs backend route; (d) duplicate client-side vs backend route. Then exactly one "Recommended: Variant N" with a 2-3 sentence rationale.

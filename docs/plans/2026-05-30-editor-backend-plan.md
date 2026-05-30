# Editor Backend Foundation — Implementation Plan

TDD throughout (red -> green -> refactor). Each task is one atomic conventional
commit on `feat/editor-backend`. `bun run validate` (typecheck + lint + bun test
+ pytest) stays at zero warnings after every task.

## Task 1: Typed `ui.xyflow` layout + lenient parse
- Files: `packages/core/src/schema/ui.ts` (new), `packages/core/src/schema/load.ts`,
  `tests/core/load.test.ts` (or new `ui.test.ts`).
- Behavior: typed `UiLayout { xyflow?: { nodes: {id,x,y}[]; viewport?: {x,y,zoom} } }`.
  `parseWorkflow` returns it on `LoadResult.ui` when present, `undefined` when
  absent; unknown keys ignored; a spec without `ui` still loads and is executable.
- Acceptance: parse spec-with-ui -> typed ui; parse spec-without-ui -> ui
  undefined, workflow unchanged; malformed ui tolerated (dropped, not throwing).

## Task 2: Zero-dependency serializer + round-trip
- Files: `packages/core/src/serialize/serializeWorkflow.ts` (new),
  `tests/core/serialize.test.ts` (new).
- Behavior: `serializeWorkflow(workflow, ui?) -> string` emitting YAML structure
  with scalars via `JSON.stringify`.
- Acceptance (round-trip property): for both `examples/*.workflow.yaml`,
  `parseWorkflow(serializeWorkflow(w, ui))` deep-equals `{workflow: w, ui}`;
  multiline prompt survives; no-ui input emits no `ui:` block; output re-parses.

## Task 3: SpecStore write path (save/create/delete/getById) + scope routing
- Files: `packages/core/src/runtime/specStore.ts`, `tests/core/specWrite.test.ts` (new).
- Behavior: `getById(id) -> {workflow, ui, path} | null`; `saveWorkflow(workflow,
  ui?)` validates first (throws on errors, writes nothing), serializes, routes to
  the scope-correct root, writes `<root>/<id>.workflow.yaml`, replacing any
  existing same-id file; `create` (reject duplicate id); `delete(id)`.
- Acceptance: save invalid graph -> throws, no file; save valid -> file present
  and round-trips; global scope -> global root, project scope -> project root;
  delete removes; getById returns full graph incl ui.

## Task 4: Core CLI subcommands
- Files: `packages/core/src/cli/commands.ts`, `packages/core/src/cli.ts`,
  `tests/core/cli.test.ts`.
- Behavior: `spec-get <id>`, `spec-save` (reads DTO json from stdin/arg),
  `spec-create`, `spec-delete <id>` — all JSON in/out, delegating to SpecStore.
- Acceptance: each command round-trips through argv dispatch and prints JSON;
  invalid save exits non-zero with validation errors on stdout/stderr as JSON.

## Task 5: Run cancel + retry in core
- Files: `packages/core/src/runtime/state.ts` (or a new `runMutations.ts`),
  `packages/core/src/cli/commands.ts` + `cli.ts`, `tests/core/runMutations.test.ts` (new).
- Behavior: `cancelRun(run)` -> status cancelled (no-op on terminal);
  `retryRun(run, {node?})` -> whole-run reset to entry, or reset one failed node
  to pending + run running; iteration/idempotency advances. CLI: `run-cancel`,
  `run-retry`.
- Acceptance: cancel sets cancelled and is idempotent; retry-whole resets graph;
  retry-node resets only that node; terminal-state guards covered.

## Task 6: Dashboard workflow routes
- Files: `dashboard/plugin_api.py`, `tests/python/test_dashboard_workflow_routes.py` (new).
- Behavior: `GET /workflows/{id}` (404 if missing), `PUT /workflows/{id}` (400 on
  validation error or id mismatch), `POST /workflows/{id}/validate`,
  `POST /workflows/{id}/compile-preview`, `POST /workflows/{id}/run`.
- Acceptance (pytest, temp HERMES_HOME): get returns {workflow,ui,path}; put saves
  and round-trips via core; put invalid -> 400 with errors; validate/compile
  return core output; run creates a run row.

## Task 7: Dashboard run routes
- Files: `dashboard/plugin_api.py`, `tests/python/test_dashboard_run_routes.py` (new).
- Behavior: `GET /runs/{id}` (full run state, 404 if missing),
  `POST /runs/{id}/cancel`, `POST /runs/{id}/retry` (optional `node_id` body).
- Acceptance: get returns per-node detail; cancel sets cancelled; retry resets per
  task 5; missing run -> 404.

## Task 8: Docs + CHANGELOG
- Files: `docs/workflow-schema.md` (typed ui block), `docs/dashboard.md` (the new
  routes + editor DTO), `README.md` (authoring API one paragraph), `CHANGELOG.md`
  (one new version entry, no Unreleased placeholder).
- Acceptance: docs describe the new contract; `diff CLAUDE.md AGENTS.md` rule
  untouched; CHANGELOG has a single new version covering this PR.

## Verification (phase 4 QA)
- `bun run validate` green (typecheck, oxlint 0 warnings, bun test, pytest).
- Smoke: round-trip an example through `spec-get` -> edit ui -> `spec-save` ->
  re-`spec-get`; hit each dashboard route against a temp home.

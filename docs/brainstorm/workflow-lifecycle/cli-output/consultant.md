# Brainstorm consultant output — workflow lifecycle

Consultant: an in-process subagent (general-purpose) acting as the frontend +
backend architecture consultant. The CLI consultants the playbook prefers could
not run this round: `claude -p` was OOM-killed (exit 137) in prior epics and
`codex exec` could not be launched through the shell this session. The subagent
is an equivalent independent pass; the orchestrator still decides.

Three variants below, verbatim.

---

### Variant 1: Create-then-edit + dedicated routes + backend export
- **Approach**: Templates "New" opens a small modal form (id slug / display name / scope / trigger kind). On submit it POSTs to a new `POST /workflows` route that shells `spec-create` (refuse-overwrite), writing a seeded minimal-valid spec (single `finish` node) to disk, then navigates the editor to that id. Delete is `DELETE /workflows/{id}` (shells `spec-delete`); Export is a backend `GET /workflows/{id}/export` returning `text/yaml`; Duplicate is client-side (GET source → mutate id/name in the typed client → POST create).
- **Trade-offs**:
  - Pro: Create semantics live exactly where the constraint wants them — core `spec-create` with refuse-overwrite — and the 409 surfaces naturally as a form error before the editor ever opens.
  - Pro: A spec always exists on disk before the editor loads, so the editor's existing "load by id → PUT save" path is unchanged; no new "unsaved/never-saved" state to handle.
  - Pro: Backend export route reuses core `serializeWorkflow` / the on-disk YAML as the single authority; the browser just triggers a download, no client-side YAML emitter to keep in sync.
  - Con: Two round-trips for the common "create then immediately edit" flow (POST, then editor GET).
  - Con: Most surface area: new POST route, new DELETE route, new export route, modal form, navigation wiring — the broadest test matrix.
  - Con: The seeded `finish`-only graph is briefly persisted even if the user abandons editing (orphan specs possible).
- **Complexity**: medium
- **Risk**: low

### Variant 2: Draft-then-save + reuse PUT (overwrite-or-create) + client export
- **Approach**: "New" opens the editor directly on an in-memory blank-but-valid draft (single `finish` node, id pre-filled from a slugified name field); nothing hits disk until the first Save, which uses the existing `PUT /workflows/{id}` made create-capable (write-if-absent-or-overwrite). Only `DELETE /workflows/{id}` is added on the backend; Export and Duplicate are both fully client-side (the loaded/fetched spec is serialized in-browser and offered as a download / re-POSTed via PUT under a new id).
- **Trade-offs**:
  - Pro: Smallest backend change — one DELETE route; no create or export route.
  - Pro: Zero orphan specs — abandoning a draft writes nothing.
  - Pro: Single round-trip create (the first Save).
  - Con: Directly violates the refuse-overwrite create semantics: PUT-as-create cannot distinguish "new" from "silently clobber an existing id", so a duplicate id can destroy an existing workflow without a 409.
  - Con: Pushes spec logic toward the client — a browser-side YAML serializer for Export and a browser-side clone for Duplicate — duplicating core's `serializeWorkflow` and risking drift from the core's canonical output.
  - Con: New "draft / never-persisted" editor state to model and test (save-creates vs save-updates branching), and the editor must own id allocation.
- **Complexity**: small
- **Risk**: high

### Variant 3: Hybrid — eager create on form-commit, dedicated POST/DELETE, backend export, backend duplicate
- **Approach**: "New" opens an inline panel inside the editor shell; the user fills id/name/scope/trigger and the spec is created on disk via `POST /workflows` (core `spec-create`, refuse-overwrite) the moment the form is committed, immediately handing the same in-editor session the persisted spec without a separate navigation/reload. Delete uses `DELETE /workflows/{id}`; Export uses a backend `text/yaml` route; Duplicate is a dedicated backend route (core reads source, re-runs `spec-create` under the new id server-side).
- **Trade-offs**:
  - Pro: Correct refuse-overwrite create and a one-session feel (no editor reload), combining Variant 1's correctness with Variant 2's smoothness.
  - Pro: Every spec mutation (create, duplicate, export) is a thin shell over core — strongest adherence to "no spec logic in Python," including Duplicate which becomes a pure core operation.
  - Pro: Backend duplicate is atomic and reuses the same refuse-overwrite guard.
  - Con: Largest backend footprint (POST + DELETE + export + duplicate) and a bespoke "create populates the live editor session in place" path that is the trickiest to test.
  - Con: A new core/CLI duplicate verb may be needed (no `spec-duplicate` exists today), expanding the epic beyond the stated core surface.
  - Con: Inline panel coupled to editor internals is harder to mock than a standalone modal hitting an injected client.
- **Complexity**: large
- **Risk**: medium

### Recommended: Variant 1
**Rationale**: It is the only variant that honors the refuse-overwrite create semantics through core `spec-create` while keeping every YAML/spec operation in the TS core behind thin Python shells (POST/DELETE/export), avoiding a client-side serializer that would drift from `serializeWorkflow`. Create-then-edit reuses the editor's existing load-by-id + PUT path with no new draft state, and a modal form posting through the injected typed client is the cleanest thing to mock under TDD; Duplicate stays a simple client GET+mutate+POST without needing a new core verb, keeping the epic scoped to Create/Duplicate/Delete/Export.

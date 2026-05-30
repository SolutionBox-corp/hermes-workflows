# Brainstorm audit trail — editor backend foundation

Phase 0 of the feature-release-playbook for Epic 3 (editor backend foundation).

## Consultants

- Primary (Claude Code, `claude -p`): failed — the nested process was SIGKILLed
  (exit 137, OOM) and produced no output (`cli-output/claude.md` is empty). Per
  the playbook this is a primary-consultant failure, so the run fell back to Codex.
- Fallback (Codex, `codex exec`): succeeded (exit 0). Full output in
  `cli-output/codex.md`. Three variants below, verbatim.

## Variants (from Codex, verbatim)

### Variant 1: Canonical Graph Save
- Approach: dashboard API accepts/returns a structured editor graph (typed
  workflow fields plus `ui.xyflow` positions and viewport); Python routes stay
  thin and call new TS core CLI commands for load/save/create/delete/validate/
  compile-preview/run; TS owns validation-before-write, scope-based root routing,
  and canonical emission.
- Trade-offs: + cleanest contract for the editor; + all spec logic stays in TS;
  + easy red/green tests. - canonical emission may rewrite hand-authored specs;
  - requires one explicit editor DTO and serializer now.
- Complexity: medium. Risk: low.

### Variant 2: Source-Preserving Patch Merge
- Approach: editor sends structured changes; TS reloads existing source and
  merges the edited graph back into the original document, validating before write.
- Trade-offs: + preserves YAML formatting/comments/order; + small layout-only
  diffs. - YAML round-trip merge is hard without a stringify strategy; - many
  edge cases (missing files, renamed ids, stale source); - high test burden.
- Complexity: large. Risk: medium.

### Variant 3: Raw Spec Passthrough
- Approach: save route accepts a full spec document from the client, TS parses/
  validates/compile-checks, then writes raw source if valid.
- Trade-offs: + smallest backend; + no emitter needed. - pushes spec construction
  into the frontend; - weak fit for an xyflow JSON-graph editor; - schema
  ownership drifts out of TS; - weaker pre-save validation.
- Complexity: small. Risk: high.

### Codex recommendation: Variant 1
Best matches the firm boundary (TS owns spec logic, Python thin). Loss of source
formatting is acceptable for a foundation; avoids a fragile YAML merge.

## Orchestrator decision: Variant 1, zero-dependency serializer

Agree with Codex on Variant 1 — only it keeps spec logic in TS and gives the
editor a clean structured contract.

Override on the serialization sub-choice: the project is deliberately zero
runtime dependencies (Bun built-ins + `bun:sqlite` + `Bun.YAML.parse`; all
package deps are dev tooling). So: emit YAML structure (indented maps, list
dashes) but emit every scalar via `JSON.stringify`. A JSON double-quoted string
is a valid YAML double-quoted scalar, so multiline prompts and special chars are
escaped safely and `parseWorkflow(serialize(w))` deep-equals `{workflow, ui}` by
construction. No `yaml` dep; output stays `.workflow.yaml`. Cosmetic tradeoff:
prompts emit as quoted scalars with escaped newlines rather than block scalars —
acceptable for the foundation.

Variant 2 rejected (fragile merge, large, no payoff pre-editor). Variant 3
rejected (spec construction leaks into the frontend, breaks TS ownership).

## Harness note
Phase 0 ran after a mid-session reboot with the Write tool and shell redirection
failing intermittently; files were written via a python stdin-to-file shim.

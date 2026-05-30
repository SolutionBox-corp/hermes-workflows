### Variant 1: Canonical Graph Save
- **Approach**: The dashboard API accepts and returns a structured editor graph: typed workflow fields plus `ui.xyflow` positions and viewport. Python routes stay thin and call new TS core CLI commands for load/save/create/delete/validate/compile-preview/run, while TS owns validation-before-write, scope-based root routing, and canonical JSON or YAML-subset emission.
- **Trade-offs**:
  - Pros: cleanest contract for the future `@xyflow/react` editor.
  - Pros: keeps all schema, serialization, validation, compiler, and storage policy in TypeScript core.
  - Pros: easiest to test with red/green TS unit tests plus thin Python route tests.
  - Cons: canonical emission may rewrite existing hand-authored specs and drop comments/order.
  - Cons: requires defining one explicit editor DTO and serializer now.
- **Complexity**: medium
- **Risk**: low

### Variant 2: Source-Preserving Patch Merge
- **Approach**: The editor sends structured graph changes and `ui.xyflow`, but TS reloads the existing source and merges the edited graph back into the original YAML/JSON document. Python remains thin, while TS validates the resulting workflow before writing and chooses the global/project root by scope.
- **Trade-offs**:
  - Pros: preserves user-authored YAML formatting, comments, ordering, and unrelated metadata.
  - Pros: smaller diffs for layout-only edits.
  - Pros: friendlier if workflows remain partly hand-edited outside the dashboard.
  - Cons: YAML round-trip merge is materially harder, especially without a current stringify strategy.
  - Cons: more edge cases around missing files, renamed ids, deleted fields, and stale source.
  - Cons: higher test burden because merge behavior becomes part of the product contract.
- **Complexity**: large
- **Risk**: medium

### Variant 3: Raw Spec Passthrough
- **Approach**: The dashboard save route accepts a complete portable spec document from the client, forwards it to TS for parse/validate/compile checks, then writes the raw source if valid. Scope routing can be split, with Python selecting the storage root from request metadata or TS exposing a minimal validated raw-save command.
- **Trade-offs**:
  - Pros: smallest backend surface area and avoids building a canonical emitter immediately.
  - Pros: preserves whatever serialization format the client sends.
  - Pros: useful as an escape hatch for advanced spec editing.
  - Cons: pushes too much spec construction responsibility toward the future frontend.
  - Cons: weaker fit for an xyflow-native editor that naturally edits nodes, edges, and viewport JSON.
  - Cons: easier for Python/frontend boundaries to drift from TS schema ownership.
  - Cons: harder to provide precise graph-level validation errors before save.
- **Complexity**: small
- **Risk**: high

### Recommended: Variant 1
**Rationale**: Variant 1 best matches the project’s firm boundary: TypeScript core owns spec logic, while Python remains a thin HTTP and Hermes bridge. The loss of source formatting is acceptable for a visual editor foundation, and canonical JSON or YAML-subset emission avoids taking on a fragile YAML merge problem before the frontend exists.

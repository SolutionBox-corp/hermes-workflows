# Hermes Workflows

Visual workflow orchestration for [Hermes Agent](https://github.com/NousResearch/hermes-agent).
Describe a workflow as a graph, then run it on top of Hermes' own primitives.

```
Workflow graph -> Hermes-native execution (Kanban, Cron, Profiles)
```

Hermes Workflows is a thin orchestration layer, not a separate engine. Workflows compile to
native Hermes Kanban tasks, Cron jobs, and Profile assignments. It does not replace any of them.
OpenSecondBrain is an optional long-term memory layer.

## Status

MVP in development. The engine is headless-first; a minimal read-only dashboard tab lists
workflows. The visual `@xyflow/react` editor is a later phase.

## Node types (MVP)

- `trigger` — `manual` or `cron`
- `agent_task` — run a text prompt as a Hermes Kanban task assigned to a profile
- `condition` — branch on a structured condition (node status or review decision)
- `human_review` — pause for a human decision
- `finish` — terminate the run

## Layout

- `packages/core` — TypeScript engine (schema, validation, compiler, runtime, memory) on Bun
- `hermes_workflows/` — thin Python bridge to Hermes (kanban, cron, profiles, o2b)
- `dashboard/` — Hermes dashboard plugin (read-only in MVP)
- `docs/specs`, `docs/plans` — design and implementation plan

## Development

```bash
bun install
bun run validate   # typecheck + lint + test
```

## License

MIT

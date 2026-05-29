# Workflow schema

A workflow is a portable YAML (or JSON) spec. It is valid and executable without
the optional `ui` layout block — layout is strictly separated from execution.

## Top level

```yaml
id: feature-development        # stable identifier
name: Feature Development
version: 1                     # integer
scope:
  type: project                # global | project | projects
  projects: [open-second-brain] # optional
trigger:
  type: manual                 # manual | cron
defaults:
  profile: fullstack-engineer  # fallback assignee
  max_retries: 1
  memory: { provider: auto, fail_open: true }
nodes: [ ... ]
edges: [ ... ]
ui: { xyflow: { ... } }        # optional, ignored by execution
```

## Triggers

- `manual` — started via the `workflow_run` tool, the CLI, or the dashboard.
- `cron` — `{ type: cron, schedule: "0 9 * * *", timezone: "Europe/Belgrade" }`;
  compiled to a native Hermes Cron job.

## Node types (MVP)

- **agent_task** — the primary node, a text prompt run as a Kanban task:
  ```yaml
  - id: implement
    type: agent_task
    title: Implement feature
    profile: fullstack-engineer   # -> assignee (or defaults.profile)
    model: some-model             # -> model_override
    skills: [coding]              # -> skills
    workspace: { type: worktree } # scratch | worktree
    prompt: |
      Implement the feature according to the plan.
    max_retries: 1
    timeout_seconds: 3600
  ```
- **condition** — a routing-only node; its outgoing edges carry the conditions.
- **human_review** — pauses the run; `options: [approved, rejected, needs_changes]`.
- **finish** — terminal; `outcome: success | failure`.

The entry node is the one with no incoming edge (exactly one is required).

## Edges and conditions

```yaml
edges:
  - from: validate
    to: review
    condition: { type: node_status, node: validate, equals: success }
  - from: validate
    to: fix
    condition: { type: node_status, node: validate, equals: failure }
  - from: review
    to: publish
    condition: { type: review_status, equals: approved }
  - from: fix
    to: validate            # a loop edge re-runs validate
```

Conditions are structured only (no expression or LLM routing):

- `node_status` — branch on a node's success/failure. A branch on `node_status`
  must cover both outcomes or declare a `fallback: true` edge.
- `review_status` — branch on a human_review decision. Partial handling is
  allowed; an unhandled decision stops the run.

A node's success/failure comes from the backing Kanban task's outcome; a worker
may override it by writing `{ "node_outcome": "success" | "failure" }` into its
completion metadata (useful for a QA gate that "completes" but reports failure).

See `examples/` for two complete specs.

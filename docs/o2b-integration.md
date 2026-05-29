# OpenSecondBrain integration

OpenSecondBrain is an optional long-term memory layer. It is never runtime
storage, and it is never a hard dependency: a workflow runs the same whether or
not O2B is present.

## Provider seam

The engine depends only on `WorkflowMemoryProvider`:

```ts
interface WorkflowMemoryProvider {
  isAvailable(): Promise<boolean>
  readContext(req): Promise<WorkflowContext>
  writeEvent(event): Promise<void>
  writeRetrospective(retro): Promise<void>
}
```

Implementations:

- `NoopMemoryProvider` (default) — reports unavailable, returns empty context,
  skips writes.
- `O2BCLIProvider` — uses the `o2b` CLI: availability via `o2b brain doctor`,
  writes via `o2b brain note`. The CLI runner is injectable for testing.

## Fail-open and redaction

`FailOpenMemoryProvider` wraps any provider and is what the engine uses:

- every write payload is passed through `redactSecrets` first (API keys, tokens,
  private keys, and `key: value` secrets are masked),
- all provider errors are swallowed, so a memory problem never fails a run,
- reads degrade to empty context and availability degrades to false.

## What is written

Only useful, low-volume events — never every micro-step:

- `run_completed`
- `node_failed`
- a post-run `workflow_retrospective` (the main value)

## Detection modes

`disabled` · `auto` (detect via the `o2b` CLI) · explicitly configured. When O2B
is absent the dashboard badge reads "not connected" and the run proceeds
normally. The MCP-based provider is a later addition.

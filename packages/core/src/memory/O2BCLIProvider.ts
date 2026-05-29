/**
 * OpenSecondBrain memory provider over the `o2b` CLI. Availability is probed
 * with `o2b status` (configuration present), not `o2b brain doctor` — the
 * latter is a strict vault-content health check that fails on pre-existing
 * content issues and so is a poor "is O2B connected" signal. Writes go through
 * `o2b brain note`. The CLI runner is injected so the provider is testable
 * without a real installation.
 *
 * Reading context is a no-op in the MVP (returns empty); pulling O2B context
 * into prompts is post-MVP.
 */

import type {
  WorkflowMemoryProvider,
  WorkflowContext,
  WorkflowContextRequest,
  WorkflowMemoryEvent,
  WorkflowRetrospective,
} from "./MemoryProvider.ts";

export type CliRunner = (argv: string[]) => Promise<{ exitCode: number; stdout: string }>;

export const defaultRunner: CliRunner = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
};

export class O2BCLIProvider implements WorkflowMemoryProvider {
  constructor(
    private readonly run: CliRunner = defaultRunner,
    private readonly bin = "o2b",
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.run([this.bin, "status"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async readContext(_request: WorkflowContextRequest): Promise<WorkflowContext> {
    return { entries: {} };
  }

  async writeEvent(event: WorkflowMemoryEvent): Promise<void> {
    await this.run([
      this.bin,
      "brain",
      "note",
      "--kind",
      event.kind,
      "--title",
      event.title,
      "--body",
      event.body,
    ]);
  }

  async writeRetrospective(retrospective: WorkflowRetrospective): Promise<void> {
    await this.run([
      this.bin,
      "brain",
      "note",
      "--kind",
      "workflow_retrospective",
      "--title",
      retrospective.title,
      "--body",
      retrospective.markdown,
    ]);
  }
}

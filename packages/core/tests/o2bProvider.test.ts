import { describe, expect, test } from "bun:test";

import { O2BCLIProvider } from "../src/index.ts";
import type { CliRunner } from "../src/index.ts";

function recordingRunner(exitCode = 0): { run: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CliRunner = async (argv) => {
    calls.push(argv);
    return { exitCode, stdout: "" };
  };
  return { run, calls };
}

const throwingRunner: CliRunner = async () => {
  throw new Error("o2b not found");
};

describe("O2BCLIProvider", () => {
  test("isAvailable probes `o2b status` and reflects its exit code", async () => {
    const ok = recordingRunner(0);
    expect(await new O2BCLIProvider(ok.run).isAvailable()).toBe(true);
    expect(ok.calls[0]).toEqual(["o2b", "status"]);
    expect(await new O2BCLIProvider(recordingRunner(1).run).isAvailable()).toBe(false);
  });

  test("isAvailable is false when the runner throws", async () => {
    expect(await new O2BCLIProvider(throwingRunner).isAvailable()).toBe(false);
  });

  test("writeRetrospective shells out to o2b brain note", async () => {
    const { run, calls } = recordingRunner();
    await new O2BCLIProvider(run).writeRetrospective({ title: "Run x", markdown: "# done" });
    expect(calls[0]).toEqual([
      "o2b",
      "brain",
      "note",
      "--kind",
      "workflow_retrospective",
      "--title",
      "Run x",
      "--body",
      "# done",
    ]);
  });

  test("writeEvent passes the event kind through", async () => {
    const { run, calls } = recordingRunner();
    await new O2BCLIProvider(run).writeEvent({ kind: "node_failed", title: "t", body: "b" });
    expect(calls[0]).toContain("node_failed");
  });
});

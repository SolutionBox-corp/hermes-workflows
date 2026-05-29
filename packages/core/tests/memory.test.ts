import { describe, expect, test } from "bun:test";

import { NoopMemoryProvider } from "../src/index.ts";

describe("NoopMemoryProvider", () => {
  const provider = new NoopMemoryProvider();

  test("reports itself as unavailable", async () => {
    expect(await provider.isAvailable()).toBe(false);
  });

  test("returns empty context", async () => {
    const context = await provider.readContext({ workflow_id: "w" });
    expect(context).toEqual({ entries: {} });
  });

  test("silently skips writes", async () => {
    await provider.writeEvent({ kind: "run_completed", title: "t", body: "b" });
    await provider.writeRetrospective({ title: "t", markdown: "# m" });
    expect(true).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactStore } from "../src/index.ts";

let dir: string;
let store: ArtifactStore;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hw-art-"));
  store = new ArtifactStore(join(dir, "runs"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ArtifactStore", () => {
  test("writes and reads a node artifact", async () => {
    await store.writeNodeFile("run-1", "implement", "output.json", '{"draft":"hi"}');
    expect(await store.readNodeFile("run-1", "implement", "output.json")).toBe('{"draft":"hi"}');
  });

  test("writes and reads a run-level file", async () => {
    await store.writeRunFile("run-1", "input.json", '{"feature":"x"}');
    expect(await store.readRunFile("run-1", "input.json")).toBe('{"feature":"x"}');
  });

  test("returns null for a missing artifact", async () => {
    expect(await store.readNodeFile("run-1", "ghost", "output.json")).toBeNull();
  });

  test("nests node directories under the run", () => {
    expect(store.nodeDir("run-1", "implement")).toBe(
      join(dir, "runs", "run-1", "nodes", "implement"),
    );
  });
});

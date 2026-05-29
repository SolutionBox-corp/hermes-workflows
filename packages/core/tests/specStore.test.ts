import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SpecStore } from "../src/index.ts";

const examplesDir = join(import.meta.dir, "../../../examples");

let root: string;
let store: SpecStore;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hw-specs-"));
  await cp(examplesDir, root, { recursive: true });
  store = new SpecStore([root]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SpecStore", () => {
  test("lists specs found under the root", async () => {
    const ids = (await store.list()).map((s) => s.id).toSorted();
    expect(ids).toEqual(["blog-daily-signals", "feature-development"]);
  });

  test("loads a spec by id", async () => {
    const result = await store.load("feature-development");
    expect(result?.workflow.name).toBe("Feature Development");
  });

  test("returns null for an unknown id", async () => {
    expect(await store.load("nope")).toBeNull();
  });

  test("missing roots yield an empty listing", async () => {
    const empty = new SpecStore([join(root, "does-not-exist")]);
    expect(await empty.list()).toEqual([]);
  });

  test("saves a spec and reads it back", async () => {
    const source = [
      "id: saved-flow",
      "name: Saved Flow",
      "version: 1",
      "scope:",
      "  type: global",
      "trigger:",
      "  type: manual",
      "nodes:",
      "  - id: done",
      "    type: finish",
      "edges: []",
    ].join("\n");
    const path = await store.save("saved-flow", source);
    expect(path.endsWith("saved-flow.workflow.yaml")).toBe(true);
    expect((await store.load("saved-flow"))?.workflow.name).toBe("Saved Flow");
  });
});

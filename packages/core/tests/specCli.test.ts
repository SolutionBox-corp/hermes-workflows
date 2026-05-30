import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdSpecGet, cmdSpecSave, cmdSpecCreate, cmdSpecDelete } from "../src/cli/commands.ts";
import { SpecValidationError, SpecExistsError } from "../src/index.ts";

const SPEC = {
  id: "editor-made",
  name: "Editor Made",
  version: 1,
  scope: { type: "global" },
  trigger: { type: "manual" },
  nodes: [
    { id: "plan", type: "agent_task", prompt: "do", profile: "p" },
    { id: "done", type: "finish" },
  ],
  edges: [{ from: "plan", to: "done" }],
  ui: { xyflow: { viewport: { x: 0, y: 0, zoom: 1 } } },
};

let globalRoot: string;
let templatesRoot: string;
let roots: string[];
let writeRoots: { global: string; templates: string };

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), "hw-speccli-"));
  globalRoot = join(base, "global");
  templatesRoot = join(base, "templates");
  roots = [globalRoot, templatesRoot];
  writeRoots = { global: globalRoot, templates: templatesRoot };
});

afterEach(async () => {
  await rm(join(globalRoot, ".."), { recursive: true, force: true });
});

describe("cli commands — spec write", () => {
  test("spec-save then spec-get round-trips the graph and ui", async () => {
    const saved = await cmdSpecSave(roots, SPEC, writeRoots);
    expect(saved.path.endsWith("editor-made.workflow.yaml")).toBe(true);

    const got = await cmdSpecGet(roots, "editor-made");
    expect(got?.workflow.name).toBe("Editor Made");
    expect(got?.ui).toEqual({ xyflow: { viewport: { x: 0, y: 0, zoom: 1 } } });
  });

  test("spec-save refuses an invalid graph", async () => {
    const bad = { ...SPEC, edges: [{ from: "done", to: "ghost" }] };
    await expect(cmdSpecSave(roots, bad, writeRoots)).rejects.toBeInstanceOf(SpecValidationError);
  });

  test("spec-get returns null for an unknown id", async () => {
    expect(await cmdSpecGet(roots, "nope")).toBeNull();
  });

  test("spec-create refuses a duplicate id", async () => {
    await cmdSpecCreate(roots, SPEC, writeRoots);
    await expect(cmdSpecCreate(roots, SPEC, writeRoots)).rejects.toBeInstanceOf(SpecExistsError);
  });

  test("spec-delete removes the spec", async () => {
    await cmdSpecSave(roots, SPEC, writeRoots);
    expect(await cmdSpecDelete(roots, "editor-made")).toEqual({ deleted: true });
    expect(await cmdSpecGet(roots, "editor-made")).toBeNull();
    expect(await cmdSpecDelete(roots, "editor-made")).toEqual({ deleted: false });
  });
});

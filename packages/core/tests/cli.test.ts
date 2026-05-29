import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cmdValidate,
  cmdCompilePreview,
  cmdExplain,
  cmdRunCreate,
  cmdRunLoad,
  cmdRunList,
  cmdAdvance,
} from "../src/cli/commands.ts";

const example = join(import.meta.dir, "../../../examples/feature-development.workflow.yaml");

describe("cli commands — pure (offline)", () => {
  test("validate returns a passing result for a valid spec", async () => {
    const result = await cmdValidate(example);
    expect(result.valid).toBe(true);
  });

  test("compile-preview returns the Hermes plan", async () => {
    const plan = await cmdCompilePreview(example);
    expect(plan.first_node).toBe("plan");
    expect(plan.kanban_tasks.length).toBe(5);
  });

  test("explain summarises the workflow", async () => {
    const summary = await cmdExplain(example);
    expect(summary.id).toBe("feature-development");
    expect(summary.trigger).toBe("manual");
    expect(summary.nodes).toHaveLength(7);
  });
});

describe("cli commands — run lifecycle on runs.db", () => {
  let dir: string;
  let db: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "hw-cli-"));
    db = join(dir, "runs.db");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("run-create persists a fresh run", async () => {
    const run = await cmdRunCreate(db, example, "run-1", "proj");
    expect(run.status).toBe("created");
    expect(run.project_id).toBe("proj");
    expect(cmdRunLoad(db, "run-1")?.run_id).toBe("run-1");
  });

  test("advance decides the entry node for a fresh run", async () => {
    const run = cmdRunLoad(db, "run-1");
    const decision = await cmdAdvance(example, run!);
    expect(decision.schedule).toEqual(["plan"]);
    expect(decision.run_status).toBe("running");
  });

  test("run-list --active includes only non-terminal runs", async () => {
    await cmdRunCreate(db, example, "run-2");
    const active = cmdRunList(db, true).map((r) => r.run_id);
    expect(active).toContain("run-1");
    expect(active).toContain("run-2");
  });
});

import { describe, expect, test } from "bun:test";

import { parseWorkflow, fromObject, WorkflowParseError } from "../src/index.ts";
import { loadExample } from "./_fixtures.ts";

describe("parseWorkflow", () => {
  test("loads the feature-development example", async () => {
    const { workflow, ui } = await loadExample("feature-development.workflow.yaml");
    expect(workflow.id).toBe("feature-development");
    expect(workflow.trigger.type).toBe("manual");
    expect(workflow.nodes).toHaveLength(7);
    expect(ui).toBeUndefined();
  });

  test("loads the blog-daily-signals example with a cron trigger", async () => {
    const { workflow } = await loadExample("blog-daily-signals.workflow.yaml");
    expect(workflow.trigger).toEqual({
      type: "cron",
      schedule: "0 9 * * *",
      timezone: "Europe/Belgrade",
    });
  });

  test("separates the ui block from execution data", () => {
    const { workflow, ui } = fromObject({
      id: "x",
      name: "X",
      version: 1,
      scope: { type: "global" },
      trigger: { type: "manual" },
      nodes: [{ id: "done", type: "finish" }],
      edges: [],
      ui: { xyflow: { viewport: { x: 0, y: 0, zoom: 1 } } },
    });
    expect(ui).toEqual({ xyflow: { viewport: { x: 0, y: 0, zoom: 1 } } });
    expect("ui" in workflow).toBe(false);
  });

  test("a spec without ui still loads and is executable", () => {
    const { workflow, ui } = fromObject({
      id: "x",
      name: "X",
      version: 1,
      scope: { type: "global" },
      trigger: { type: "manual" },
      nodes: [{ id: "done", type: "finish" }],
      edges: [],
    });
    expect(ui).toBeUndefined();
    expect(workflow.nodes[0]?.type).toBe("finish");
  });

  test("rejects an agent_task without a prompt", () => {
    expect(() =>
      fromObject({
        id: "x",
        name: "X",
        version: 1,
        scope: { type: "global" },
        trigger: { type: "manual" },
        nodes: [{ id: "a", type: "agent_task" }],
        edges: [],
      }),
    ).toThrow(WorkflowParseError);
  });

  test("rejects an unknown node type", () => {
    expect(() =>
      fromObject({
        id: "x",
        name: "X",
        version: 1,
        scope: { type: "global" },
        trigger: { type: "manual" },
        nodes: [{ id: "a", type: "delay" }],
        edges: [],
      }),
    ).toThrow(WorkflowParseError);
  });

  test("rejects a non-mapping document", () => {
    expect(() => parseWorkflow("- just\n- a list")).toThrow(WorkflowParseError);
  });
});

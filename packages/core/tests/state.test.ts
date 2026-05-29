import { describe, expect, test } from "bun:test";

import {
  createRunState,
  transitionRun,
  transitionNode,
  canTransitionRun,
  IllegalTransitionError,
  fromObject,
} from "../src/index.ts";

const workflow = fromObject({
  id: "t",
  name: "T",
  version: 3,
  scope: { type: "global" },
  trigger: { type: "manual" },
  defaults: { profile: "p" },
  nodes: [
    { id: "a", type: "agent_task", prompt: "x" },
    { id: "done", type: "finish" },
  ],
  edges: [{ from: "a", to: "done" }],
}).workflow;

describe("createRunState", () => {
  test("initialises every node pending and the run as created", () => {
    const run = createRunState(workflow, "run-1", "proj");
    expect(run.status).toBe("created");
    expect(run.workflow_version).toBe(3);
    expect(run.project_id).toBe("proj");
    expect(run.nodes["a"]?.status).toBe("pending");
    expect(run.nodes["done"]?.status).toBe("pending");
  });
});

describe("transitions", () => {
  test("allows a legal run transition", () => {
    expect(canTransitionRun("created", "running")).toBe(true);
    const run = transitionRun(createRunState(workflow, "r"), "running");
    expect(run.status).toBe("running");
  });

  test("rejects an illegal run transition", () => {
    const run = transitionRun(createRunState(workflow, "r"), "running");
    const completed = transitionRun(run, "completed");
    expect(() => transitionRun(completed, "running")).toThrow(IllegalTransitionError);
  });

  test("allows a legal node transition and is immutable", () => {
    const run = createRunState(workflow, "r");
    const next = transitionNode(run, "a", "scheduled");
    expect(next.nodes["a"]?.status).toBe("scheduled");
    expect(run.nodes["a"]?.status).toBe("pending"); // input untouched
  });

  test("rejects an illegal node transition", () => {
    const run = createRunState(workflow, "r");
    expect(() => transitionNode(run, "a", "completed")).toThrow(IllegalTransitionError);
  });
});

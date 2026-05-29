import { describe, expect, test } from "bun:test";

import { compileToHermesPlan } from "../src/index.ts";
import { loadExample } from "./_fixtures.ts";

describe("compileToHermesPlan", () => {
  test("feature-development compiles to Kanban tasks with no cron", async () => {
    const { workflow } = await loadExample("feature-development.workflow.yaml");
    const plan = compileToHermesPlan(workflow);

    expect(plan.first_node).toBe("plan");
    expect(plan.cron_jobs).toHaveLength(0);
    expect(plan.kanban_tasks.map((t) => t.node)).toEqual([
      "plan",
      "implement",
      "validate",
      "fix",
      "release_notes",
    ]);
    expect(plan.kanban_tasks[0]).toEqual({
      node: "plan",
      assignee: "product-tech-lead",
      workflow_template_id: "feature-development",
      current_step_key: "plan",
    });
    expect(plan.profiles).toContain("qa-engineer");
    expect(plan.memory).toEqual({ provider: "auto", fail_open: true });
  });

  test("blog-daily-signals compiles a cron job", async () => {
    const { workflow } = await loadExample("blog-daily-signals.workflow.yaml");
    const plan = compileToHermesPlan(workflow);

    expect(plan.cron_jobs).toEqual([
      {
        schedule: "0 9 * * *",
        timezone: "Europe/Belgrade",
        command: "hermes-workflows run blog-daily-signals",
      },
    ]);
    expect(plan.first_node).toBe("fetch");
  });
});

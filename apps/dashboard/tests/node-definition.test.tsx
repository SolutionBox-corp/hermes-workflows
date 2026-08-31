/** What the step *is*, drawn from the spec.
 *
 * The record covers what a step did. Nothing covered what it was asked to do,
 * so a `prompt` node - whose entire content is its text - rendered as a status
 * line and nothing else, and a script node never showed the command it ran.
 * That half needs no cooperation from the step: it is in the workflow already.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodeDefinition } from "../src/run/NodeDefinition";
import type { WorkflowNode } from "../src/api/types";

function show(node: unknown) {
  return render(<NodeDefinition node={node as WorkflowNode} />);
}

describe("NodeDefinition", () => {
  it("shows a prompt node's text, which is its entire content", () => {
    show({ id: "start", type: "prompt", prompt: "Úkol STAGED v repozitáři Helper-2." });
    expect(screen.getByText(/Úkol STAGED v repozitáři Helper-2/)).toBeTruthy();
  });

  it("shows the command a script node ran, with its workdir and timeout", () => {
    show({
      id: "probe",
      type: "script",
      command: "/home/x/.hermes/scripts/probe-record.sh",
      workdir: "/home/x",
      timeout_seconds: 120,
    });
    expect(screen.getByText("/home/x/.hermes/scripts/probe-record.sh")).toBeTruthy();
    expect(screen.getByText("/home/x")).toBeTruthy();
    expect(screen.getByText("120s")).toBeTruthy();
  });

  it("shows an agent_task's prompt, profile, model and declared skills", () => {
    show({
      id: "impl",
      type: "agent_task",
      prompt: "Implement the design test-first.",
      profile: "eng",
      model: "claude-opus-5",
      skills: ["serena-patterns", "test-driven-development"],
    });
    expect(screen.getByText(/Implement the design test-first/)).toBeTruthy();
    expect(screen.getByText("eng")).toBeTruthy();
    expect(screen.getByText("claude-opus-5")).toBeTruthy();
    expect(screen.getByText("serena-patterns, test-driven-development")).toBeTruthy();
  });

  it("shows the choices a gate offers", () => {
    show({ id: "g", type: "human_review", options: ["approved", "rejected"] });
    expect(screen.getByText("approved, rejected")).toBeTruthy();
  });

  it("shows what a wait node is waiting for", () => {
    show({ id: "merged", type: "wait", wait_for: { github_pr_merged: "{{nodes.pr.output}}" } });
    expect(screen.getByText(/github_pr_merged/)).toBeTruthy();
    expect(screen.getByText(/nodes.pr.output/)).toBeTruthy();
  });

  it("shows a finish node's outcome", () => {
    show({ id: "done", type: "finish", outcome: "success" });
    expect(screen.getByText("success")).toBeTruthy();
  });

  it("renders nothing at all for a node with no definable content", () => {
    const { container } = show({ id: "c", type: "condition" });
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the spec entry is missing", () => {
    const { container } = render(<NodeDefinition node={undefined} />);
    expect(container.textContent).toBe("");
  });
});

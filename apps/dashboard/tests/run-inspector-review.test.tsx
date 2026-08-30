/** Resolving a human_review gate from the run inspector.
 *
 * Before this the dashboard could not answer a gate at all: the endpoint and
 * the CLI had it, the built bundle never called `/review`, so a paused run was
 * a dead end you had to leave the browser to clear.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunInspector } from "../src/run/RunInspector";
import type { WorkflowsApi } from "../src/api/client";
import type { RunState } from "../src/api/types";

function runWith(status: string): RunState {
  return {
    run_id: "r1",
    workflow_id: "wf",
    workflow_version: 1,
    status: status === "waiting_for_review" ? "waiting" : "running",
    nodes: { gate: { node_id: "gate", node_type: "human_review", status } },
  } as unknown as RunState;
}

function apiFor(status: string) {
  const reviewRun = vi.fn().mockResolvedValue({
    run_id: "r1",
    status: "running",
    decision: "needs_changes",
  });
  const api = {
    getRun: vi.fn().mockResolvedValue(runWith(status)),
    getWorkflow: vi.fn().mockResolvedValue({
      workflow: { id: "wf", nodes: [{ id: "gate", type: "human_review" }], edges: [] },
    }),
    retryRun: vi.fn().mockResolvedValue(runWith(status)),
    cancelRun: vi.fn().mockResolvedValue(runWith(status)),
    reviewRun,
  } as unknown as WorkflowsApi;
  return { api, reviewRun };
}

// Same approach as run-inspector.test.tsx: ReactFlow leaves unmeasured nodes in
// a hidden subtree under jsdom, so the open button is found by aria-label and
// clicked with fireEvent. userEvent would also drive d3-zoom's mousedown, which
// throws in jsdom ("Cannot read properties of null (reading 'document')").
async function openGate(): Promise<void> {
  const btn = await waitFor(() => {
    const el = document.querySelector('[aria-label="Open node gate"]');
    if (el === null) throw new Error("open button not rendered yet");
    return el as HTMLElement;
  });
  fireEvent.click(btn);
}

describe("run inspector — review gate", () => {
  it("sends the decision and the note", async () => {
    const { api, reviewRun } = apiFor("waiting_for_review");
    render(<RunInspector runId="r1" client={api} pollMs={0} />);
    await openGate();

    await userEvent.type(await screen.findByLabelText("Review note"), "zúžit rozsah");
    await userEvent.click(screen.getByRole("button", { name: "Needs changes" }));

    await waitFor(() =>
      expect(reviewRun).toHaveBeenCalledWith("r1", "gate", "needs_changes", "zúžit rozsah"),
    );
  });

  it("offers no review buttons on a node that is not waiting", async () => {
    const { api } = apiFor("completed");
    render(<RunInspector runId="r1" client={api} pollMs={0} />);
    await openGate();

    expect(await screen.findByRole("button", { name: "Retry node" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByLabelText("Review note")).toBeNull();
  });
});

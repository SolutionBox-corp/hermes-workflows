/** The node audit record in the run inspector.
 *
 * Before this the modal showed a bare node id, a status, and one `<pre>` of
 * whatever the command printed — so a step that wrote a 17 kB design document
 * and cost $1.49 was indistinguishable from one that did nothing, and a gate
 * showed nothing at all about the step it was judging.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NodeRecordDetail } from "../src/run/NodeRecordDetail";
import { RunInspector } from "../src/run/RunInspector";
import type { WorkflowsApi } from "../src/api/client";
import type { NodeRunState, RunState } from "../src/api/types";

const RECORD = {
  headline: "design written, no source files touched",
  facts: [
    { label: "repo", value: "demo" },
    { label: "gates", value: "skipped" },
  ],
  handoff: [{ label: "branch", value: "agent/demo" }],
  artifacts: [
    { name: "diff.patch", label: "Diff", kind: "diff" as const, bytes: 6, truncated: false },
  ],
};

function node(extra: Partial<NodeRunState> = {}): NodeRunState {
  return { node_id: "explore", status: "completed", outcome: "success", ...extra } as NodeRunState;
}

function apiWith(text = "+++ a") {
  return {
    getNodeArtifact: vi.fn().mockResolvedValue({
      run_id: "r1",
      node_id: "explore",
      name: "diff.patch",
      text,
      truncated: false,
      bytes: text.length,
    }),
  } as unknown as WorkflowsApi;
}

function renderRecord(n: NodeRunState, api: WorkflowsApi = apiWith(), props = {}) {
  return render(
    <NodeRecordDetail api={api} runId="r1" nodeId="explore" node={n} {...props} />,
  );
}

describe("NodeRecordDetail", () => {
  it("shows the step's title and description from the spec", () => {
    renderRecord(node(), apiWith(), {
      title: "1 · Explore and propose",
      description: "Reads references and writes a design. Touches no source.",
    });

    expect(screen.getByText("1 · Explore and propose")).toBeTruthy();
    expect(screen.getByText(/Touches no source/)).toBeTruthy();
  });

  it("shows how long the step took, from the stamped times", () => {
    renderRecord(node({ started_at: 1788100974, finished_at: 1788101267 }));
    expect(screen.getByText(/4m 53s/)).toBeTruthy();
  });

  it("shows no duration for a step that has not settled", () => {
    renderRecord(node({ status: "running", started_at: 1788100974 }));
    expect(screen.queryByText(/\ds/)).toBeNull();
  });

  it("renders the headline, facts and handoff rows", () => {
    renderRecord(node({ record: RECORD }));

    expect(screen.getByText(/design written/)).toBeTruthy();
    expect(screen.getByText("gates")).toBeTruthy();
    expect(screen.getByText("skipped")).toBeTruthy();
    expect(screen.getByText("agent/demo")).toBeTruthy();
  });

  it("does not fetch an artifact until its section is opened", async () => {
    const api = apiWith();
    renderRecord(node({ record: RECORD }), api);

    expect(api.getNodeArtifact).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Diff"));

    await waitFor(() => expect(screen.getByText("+++ a")).toBeTruthy());
    expect(api.getNodeArtifact).toHaveBeenCalledWith("r1", "explore", "diff.patch");
  });

  it("surfaces a failed artifact fetch instead of an empty section", async () => {
    const api = {
      getNodeArtifact: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as WorkflowsApi;
    renderRecord(node({ record: RECORD }), api);

    fireEvent.click(screen.getByText("Diff"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("boom"));
  });

  it("renders the provider cost through the existing telemetry block", () => {
    renderRecord(node({ telemetry: { total_tokens: 25, cost_usd: 1.4896065 } }));
    expect(screen.getByText("$1.4896")).toBeTruthy();
  });

  it("keeps the raw output for a step that declared no record", () => {
    renderRecord(node({ output: "plain prose output" }));
    expect(screen.getByText("plain prose output")).toBeTruthy();
  });

  it("keeps the raw output alongside a record too", () => {
    renderRecord(node({ record: RECORD, output: "plain prose output" }));
    expect(screen.getByText("Raw output")).toBeTruthy();
  });

  it("offers stderr as its own collapsed section", () => {
    renderRecord(node({ stderr: "worktree: /w" }));
    expect(screen.getByText("Diagnostics (stderr)")).toBeTruthy();
  });

  it("shows a warning the record carried", () => {
    renderRecord(node({ record: { warnings: ["artifact 'gone.txt' not stored"] } }));
    expect(screen.getByText(/gone.txt/)).toBeTruthy();
  });
});

// --- the inspector wiring ------------------------------------------------

const SPEC = {
  workflow: {
    id: "wf",
    nodes: [
      { id: "explore", type: "script", title: "1 · Explore and propose" },
      { id: "gate-design", type: "human_review", title: "Approve the design" },
    ],
    edges: [{ from: "explore", to: "gate-design" }],
  },
  path: "/spec.yaml",
};

function inspectorApi(nodes: Record<string, unknown>) {
  const run = {
    run_id: "r1",
    workflow_id: "wf",
    workflow_version: 1,
    status: "waiting",
    nodes,
  } as unknown as RunState;
  return {
    getRun: vi.fn().mockResolvedValue(run),
    getWorkflow: vi.fn().mockResolvedValue(SPEC),
    retryRun: vi.fn().mockResolvedValue(run),
    cancelRun: vi.fn().mockResolvedValue(run),
    reviewRun: vi.fn(),
    getNodeArtifact: vi.fn(),
  } as unknown as WorkflowsApi;
}

// ReactFlow leaves unmeasured nodes in a hidden subtree under jsdom, so the open
// button is found by aria-label and clicked with fireEvent; userEvent would also
// drive d3-zoom's mousedown, which throws in jsdom.
async function openNode(id: string): Promise<void> {
  const button = await waitFor(() => {
    const el = document.querySelector(`[aria-label="Open node ${id}"]`);
    if (el === null) throw new Error("open button not rendered yet");
    return el as HTMLElement;
  });
  fireEvent.click(button);
}

describe("run inspector — the node modal", () => {
  it("titles the modal with the step's name, not its id", async () => {
    const api = inspectorApi({ explore: { node_id: "explore", status: "completed" } });
    render(<RunInspector runId="r1" client={api} pollMs={0} />);
    await openNode("explore");

    // Scoped to the dialog: the canvas node carries the same title, so an
    // unscoped query matches both and proves nothing about the modal.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("1 · Explore and propose")).toBeTruthy();
    expect(within(dialog).queryByText("explore")).toBeNull();
  });

  it("shows a gate the record of the step it is judging", async () => {
    const api = inspectorApi({
      explore: {
        node_id: "explore",
        status: "completed",
        outcome: "success",
        record: { headline: "design written, no source files touched" },
      },
      "gate-design": { node_id: "gate-design", status: "waiting_for_review" },
    });
    render(<RunInspector runId="r1" client={api} pollMs={0} />);
    await openNode("gate-design");

    expect(await screen.findByText("What you are approving")).toBeTruthy();
    expect(screen.getByText(/design written/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("still offers the buttons when the gated step has not run", async () => {
    const api = inspectorApi({
      "gate-design": { node_id: "gate-design", status: "waiting_for_review" },
    });
    render(<RunInspector runId="r1" client={api} pollMs={0} />);
    await openNode("gate-design");

    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByText("What you are approving")).toBeNull();
  });
});

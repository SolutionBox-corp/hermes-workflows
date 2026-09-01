/** The node audit record in the run inspector.
 *
 * Before this the modal showed a bare node id, a status, and one `<pre>` of
 * whatever the command printed - so a step that wrote a 17 kB design document
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

describe("run inspector - the node modal", () => {
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

describe("NodeRecordDetail - what the reviewer must decide", () => {
  it("lists the questions the step is asking a person", () => {
    renderRecord(node({ record: { questions: ["Funkce nema volajiciho.", "Potvrdit l a ss."] } }));
    expect(screen.getByText("Chce po tobě rozhodnout")).toBeTruthy();
    expect(screen.getByText("Funkce nema volajiciho.")).toBeTruthy();
    expect(screen.getByText("Potvrdit l a ss.")).toBeTruthy();
  });

  it("shows no questions block when the step asked nothing", () => {
    renderRecord(node({ record: { headline: "ok" } }));
    expect(screen.queryByText("Chce po tobě rozhodnout")).toBeNull();
  });

  it("colours a diff per line, and does not colour its file headers", async () => {
    const patch = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1 +1 @@", "-old", "+new", " ctx"].join("\n");
    const api = apiWith(patch);
    renderRecord(node({ record: { artifacts: [{ name: "d.patch", label: "Diff", kind: "diff" as const }] } }), api);
    fireEvent.click(screen.getByText("Diff"));

    const added = await waitFor(() => {
      const el = document.querySelector(".hw-diff__add");
      if (el === null) throw new Error("not rendered yet");
      return el;
    });
    expect(added.textContent).toContain("+new");
    expect(document.querySelector(".hw-diff__del")?.textContent).toContain("-old");
    expect(document.querySelector(".hw-diff__hunk")?.textContent).toContain("@@");
    // `+++`/`---` are file headers, not added or removed lines.
    const heads = [...document.querySelectorAll(".hw-diff__head")].map((e) => e.textContent?.trim());
    expect(heads).toContain("+++ b/x");
    expect(heads).toContain("--- a/x");
  });

  it("renders a markdown artifact as a document, not as its source", async () => {
    // The step declares `kind: "markdown"` on the report it writes; the
    // inspector used to render it into the same `<pre>` as a log dump, so a
    // report arrived as `##` and `**` for a reviewer to decode.
    const api = apiWith(["## Step 1", "", "- first blocker"].join("\n"));
    renderRecord(
      node({ record: { artifacts: [{ name: "report.md", label: "Report", kind: "markdown" as const }] } }),
      api,
    );
    fireEvent.click(screen.getByText("Report"));

    const heading = await waitFor(() => {
      const el = document.querySelector(".hw-md h5");
      if (el === null) throw new Error("not rendered yet");
      return el;
    });
    expect(heading.textContent).toContain("Step 1");
    expect(document.querySelector(".hw-md li")?.textContent).toContain("first blocker");
  });

  it("still renders a plain text artifact as plain output", async () => {
    const api = apiWith("## not markdown, just text");
    renderRecord(
      node({ record: { artifacts: [{ name: "log.txt", label: "Log", kind: "text" as const }] } }),
      api,
    );
    fireEvent.click(screen.getByText("Log"));

    await waitFor(() => expect(screen.getByText("## not markdown, just text")).toBeTruthy());
    expect(document.querySelector(".hw-md")).toBeNull();
  });

  it("opens the primary artifact at a gate, and only the primary one", async () => {
    const api = apiWith("THE DESIGN");
    renderRecord(
      node({
        record: {
          artifacts: [
            { name: "a.md", label: "Other", kind: "text" as const },
            { name: "design.md", label: "Navrh", kind: "markdown" as const, primary: true },
          ],
        },
      }),
      api,
      { expandPrimary: true },
    );
    await waitFor(() => expect(screen.getByText("THE DESIGN")).toBeTruthy());
    expect(api.getNodeArtifact).toHaveBeenCalledTimes(1);
    expect(api.getNodeArtifact).toHaveBeenCalledWith("r1", "explore", "design.md");
  });

  it("leaves the primary artifact closed away from a gate", () => {
    const api = apiWith("THE DESIGN");
    renderRecord(
      node({ record: { artifacts: [{ name: "design.md", label: "Navrh", primary: true }] } }),
      api,
    );
    expect(api.getNodeArtifact).not.toHaveBeenCalled();
  });
});


describe("NodeRecordDetail - how long the step took", () => {
  it("prefers the step's own measurement over the stamped times", () => {
    // Measured in production: a synchronous script node is invoked inline
    // BEFORE the engine writes node state, so the stamps bracket the
    // bookkeeping. A real 296-second step was stamped 22 seconds apart.
    renderRecord(
      node({
        started_at: 1788160789,
        finished_at: 1788160811,
        telemetry: { duration_ms: 295744 },
      }),
    );
    // Scoped to the status line: the telemetry block legitimately shows the
    // same duration as a detail row, so an unscoped query matches both.
    const status = document.querySelector(".hw-record__status");
    expect(status?.textContent).toContain("4m 56s");
    expect(status?.textContent).not.toContain("22s");
  });

  it("falls back to the stamped times when the step measured nothing", () => {
    renderRecord(node({ started_at: 1788160789, finished_at: 1788160811 }));
    expect(document.querySelector(".hw-record__status")?.textContent).toContain("22s");
  });

  it("shows nothing when neither is available", () => {
    renderRecord(node({ status: "running" }));
    expect(screen.queryByText(/\d+s/)).toBeNull();
  });
});

/** Which node's work a gate is judging.
 *
 * The resolver is deliberately conservative. Showing the *wrong* step's record
 * above an Approve button is worse than showing none: the whole point of the
 * gate is that a person is deciding on specific evidence, and quietly attaching
 * the wrong evidence turns a review into a rubber stamp.
 */
import { describe, expect, it } from "vitest";
import { resolveGatedNode, reviewRoutes } from "../src/run/gateGraph";
import type { SpecDetail } from "../src/api/types";

function spec(nodes: unknown[], edges: unknown[]): SpecDetail {
  return { workflow: { id: "wf", nodes, edges }, path: "/spec.yaml" } as unknown as SpecDetail;
}

const WORK = { id: "explore", type: "script" };
const GATE = { id: "gate-design", type: "human_review" };

describe("resolveGatedNode", () => {
  it("resolves the single upstream work node", () => {
    const detail = spec([WORK, GATE], [{ from: "explore", to: "gate-design" }]);
    expect(resolveGatedNode(detail, "gate-design")).toBe("explore");
  });

  it("declines when the gate has no incoming edge", () => {
    expect(resolveGatedNode(spec([GATE], []), "gate-design")).toBeNull();
  });

  it("declines when several nodes feed the gate", () => {
    const detail = spec(
      [WORK, { id: "tdd", type: "script" }, GATE],
      [
        { from: "explore", to: "gate-design" },
        { from: "tdd", to: "gate-design" },
      ],
    );
    expect(resolveGatedNode(detail, "gate-design")).toBeNull();
  });

  it("declines when the upstream node is itself a gate", () => {
    const detail = spec(
      [{ id: "g1", type: "human_review" }, GATE],
      [{ from: "g1", to: "gate-design" }],
    );
    expect(resolveGatedNode(detail, "gate-design")).toBeNull();
  });

  it("ignores the gate's own outgoing edges", () => {
    /** A needs_changes loop means the gate points back at the work node. That
     *  outgoing edge must not be mistaken for the incoming one. */
    const detail = spec(
      [WORK, GATE],
      [
        { from: "explore", to: "gate-design" },
        { from: "gate-design", to: "explore" },
      ],
    );
    expect(resolveGatedNode(detail, "gate-design")).toBe("explore");
  });

  it("declines for a node id that is not in the spec", () => {
    expect(resolveGatedNode(spec([WORK], []), "nope")).toBeNull();
  });

  it("declines when the upstream node id has no spec entry", () => {
    const detail = spec([GATE], [{ from: "ghost", to: "gate-design" }]);
    expect(resolveGatedNode(detail, "gate-design")).toBeNull();
  });

  it("counts duplicate edges between the same pair once", () => {
    const detail = spec(
      [WORK, GATE],
      [
        { from: "explore", to: "gate-design" },
        { from: "explore", to: "gate-design" },
      ],
    );
    expect(resolveGatedNode(detail, "gate-design")).toBe("explore");
  });
});

describe("reviewRoutes", () => {
  const GRAPH = spec(
    [
      { id: "explore", type: "script", title: "1 · Prozkoumat a navrhnout" },
      { id: "gate-design", type: "human_review", options: ["approved", "needs_changes", "rejected"] },
      { id: "tdd", type: "script", title: "2 · Implementovat test-first" },
      { id: "failed", type: "finish", title: "Zastaveno", outcome: "failure" },
    ],
    [
      { from: "explore", to: "gate-design" },
      { from: "gate-design", to: "tdd", condition: { type: "review_status", equals: "approved" } },
      {
        from: "gate-design",
        to: "explore",
        condition: { type: "review_status", equals: "needs_changes" },
      },
      {
        from: "gate-design",
        to: "failed",
        condition: { type: "review_status", equals: "rejected" },
      },
    ],
  );

  it("says where every choice leads, in the order the gate declares them", () => {
    expect(reviewRoutes(GRAPH, "gate-design")).toEqual([
      { decision: "approved", nodeId: "tdd", title: "2 · Implementovat test-first" },
      { decision: "needs_changes", nodeId: "explore", title: "1 · Prozkoumat a navrhnout" },
      { decision: "rejected", nodeId: "failed", title: "Zastaveno", ends: "failure" },
    ]);
  });

  it("marks a choice that ends the run, with its outcome", () => {
    const route = reviewRoutes(GRAPH, "gate-design").find((r) => r.decision === "rejected");
    expect(route?.ends).toBe("failure");
  });

  it("reports a choice the graph routes nowhere rather than inventing one", () => {
    const partial = spec(
      [{ id: "g", type: "human_review", options: ["approved", "rejected"] }, { id: "t", type: "script" }],
      [{ from: "g", to: "t", condition: { type: "review_status", equals: "approved" } }],
    );
    expect(reviewRoutes(partial, "g")).toEqual([
      { decision: "approved", nodeId: "t" },
      { decision: "rejected", nodeId: null },
    ]);
  });

  it("ignores edges into the gate and edges with other conditions", () => {
    const noisy = spec(
      [{ id: "g", type: "human_review", options: ["approved"] }, { id: "t", type: "script" }, { id: "u", type: "script" }],
      [
        { from: "u", to: "g" },
        { from: "g", to: "t", condition: { type: "review_status", equals: "approved" } },
        { from: "g", to: "u", condition: { type: "node_status", node: "g", equals: "failure" } },
      ],
    );
    expect(reviewRoutes(noisy, "g")).toEqual([{ decision: "approved", nodeId: "t" }]);
  });

  it("falls back to the three standard options when the gate declares none", () => {
    const bare = spec([{ id: "g", type: "human_review" }], []);
    expect(reviewRoutes(bare, "g").map((r) => r.decision)).toEqual([
      "approved",
      "rejected",
      "needs_changes",
    ]);
  });

  it("returns nothing for a node that is not a gate", () => {
    expect(reviewRoutes(GRAPH, "explore")).toEqual([]);
    expect(reviewRoutes(GRAPH, "nope")).toEqual([]);
  });
});

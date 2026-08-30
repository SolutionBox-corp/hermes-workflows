/** Which node's work a gate is judging.
 *
 * The resolver is deliberately conservative. Showing the *wrong* step's record
 * above an Approve button is worse than showing none: the whole point of the
 * gate is that a person is deciding on specific evidence, and quietly attaching
 * the wrong evidence turns a review into a rubber stamp.
 */
import { describe, expect, it } from "vitest";
import { resolveGatedNode } from "../src/run/upstreamNode";
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

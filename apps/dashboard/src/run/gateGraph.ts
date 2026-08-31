import type { ReviewOption, SpecDetail, WorkflowNode } from "../api/types";

/**
 * The node whose work a `human_review` gate is judging: the source of the
 * gate's single incoming edge.
 *
 * Conservative on purpose - it answers `null` rather than guessing whenever the
 * graph is not unambiguous (no incoming edge, several distinct sources, or a
 * source that is itself a gate). Showing the *wrong* step's record above an
 * Approve button is worse than showing none: the point of a gate is that a
 * person decides on specific evidence, and quietly attaching the wrong evidence
 * turns the review into a rubber stamp.
 *
 * A `needs_changes` loop makes the gate point back at the work node, so only
 * edges arriving *at* the gate are considered; its own outgoing edges are not.
 */
export function resolveGatedNode(detail: SpecDetail, gateId: string): string | null {
  const workflow = detail.workflow;
  const sources = new Set<string>();
  for (const edge of workflow.edges ?? []) {
    if (edge.to === gateId) sources.add(edge.from);
  }
  if (sources.size !== 1) return null;
  const sourceId = [...sources][0];
  if (sourceId === undefined) return null;
  const source = (workflow.nodes ?? []).find((node) => node.id === sourceId);
  if (source === undefined) return null;
  if (source.type === "human_review") return null;
  return sourceId;
}

/** One choice a gate offers, and where the run goes if it is taken. */
export interface ReviewRoute {
  decision: ReviewOption;
  /** Node the run continues at. Null when the graph routes this choice nowhere. */
  nodeId: string | null;
  /** That node's title, for a reader who does not know the ids. */
  title?: string;
  /** Set when the choice ends the run, with the outcome it ends on. */
  ends?: "success" | "failure";
}

/**
 * Where each of a gate's choices leads, read from the graph.
 *
 * A gate asks for a decision and, until this existed, said nothing about what
 * any of the three buttons would do. The answer is in the spec: each outgoing
 * edge carries a `review_status` condition naming the decision it fires on. So
 * the consequence of every button is knowable before it is pressed, and there is
 * no reason to make somebody learn it by pressing one.
 *
 * Order follows the gate's declared `options`, so the list reads in the order
 * the author intended rather than in edge order.
 */
export function reviewRoutes(detail: SpecDetail, gateId: string): ReviewRoute[] {
  const workflow = detail.workflow;
  const nodes: WorkflowNode[] = workflow.nodes ?? [];
  const gate = nodes.find((node) => node.id === gateId);
  if (gate === undefined || gate.type !== "human_review") return [];

  const byDecision = new Map<string, string>();
  for (const edge of workflow.edges ?? []) {
    if (edge.from !== gateId) continue;
    const condition = edge.condition as { type?: string; equals?: string } | undefined;
    if (condition?.type !== "review_status" || condition.equals === undefined) continue;
    // First edge wins: a duplicate would be a spec bug, and silently showing the
    // second one would describe a route the engine does not take.
    if (!byDecision.has(condition.equals)) byDecision.set(condition.equals, edge.to);
  }

  const options = gate.options ?? (["approved", "rejected", "needs_changes"] as ReviewOption[]);
  return options.map((decision) => {
    const targetId = byDecision.get(decision);
    if (targetId === undefined) return { decision, nodeId: null };
    const target = nodes.find((node) => node.id === targetId);
    const route: ReviewRoute = { decision, nodeId: targetId };
    if (target?.title !== undefined) route.title = target.title;
    if (target?.type === "finish") route.ends = target.outcome ?? "success";
    return route;
  });
}

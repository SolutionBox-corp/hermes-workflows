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

/** What a step received, and from where. */
export interface NodeInput {
  /** The step whose work feeds this one. Null when it has no single source. */
  fromNodeId: string | null;
  fromTitle?: string;
  /** A gate sits between them: its decision, and the note the reviewer left. */
  decision?: string;
  note?: string;
  /** The gate's own id, when one is in the path. */
  gateNodeId?: string;
}

/**
 * What a node was handed, by walking one step back through the graph.
 *
 * Every step's output is already visible on that step. What was missing is the
 * other half of the same fact: on the step that CONSUMES it, saying where its
 * input came from. A gate in between is not a source, it is a decision about a
 * source, so the walk passes through it and reports both: the work node whose
 * output this step received, and the verdict and note attached on the way.
 *
 * Conservative in the same way {@link resolveGatedNode} is: an ambiguous or
 * missing predecessor answers null rather than naming a plausible one.
 */
export function resolveNodeInput(
  detail: SpecDetail,
  nodeId: string,
  nodeStates: Record<string, { review_decision?: string; review_note?: string }>,
): NodeInput | null {
  const workflow = detail.workflow;
  const nodes: WorkflowNode[] = workflow.nodes ?? [];

  const sourcesOf = (target: string): string[] => {
    const found = new Set<string>();
    for (const edge of workflow.edges ?? []) {
      if (edge.to === target && edge.from !== target) found.add(edge.from);
    }
    return [...found];
  };

  const direct = sourcesOf(nodeId);
  if (direct.length !== 1) return null;
  const firstId = direct[0];
  if (firstId === undefined) return null;
  const first = nodes.find((node) => node.id === firstId);
  if (first === undefined) return null;

  if (first.type !== "human_review") {
    const input: NodeInput = { fromNodeId: firstId };
    if (first.title !== undefined) input.fromTitle = first.title;
    return input;
  }

  // A gate: report its verdict, and keep walking to the work it judged.
  const state = nodeStates[firstId];
  const input: NodeInput = { fromNodeId: null, gateNodeId: firstId };
  if (state?.review_decision !== undefined) input.decision = state.review_decision;
  if (state?.review_note !== undefined) input.note = state.review_note;

  const behind = sourcesOf(firstId).filter((id) => id !== nodeId);
  const workId = behind.length === 1 ? behind[0] : undefined;
  if (workId !== undefined) {
    const work = nodes.find((node) => node.id === workId);
    if (work !== undefined) {
      input.fromNodeId = workId;
      if (work.title !== undefined) input.fromTitle = work.title;
    }
  }
  return input;
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

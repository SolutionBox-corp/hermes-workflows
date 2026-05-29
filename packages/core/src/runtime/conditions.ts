/**
 * Pure condition evaluation. Conditions live on edges; an edge fires when its
 * condition evaluates true against the current run state.
 */

import type { EdgeCondition } from "../schema/workflow.ts";
import type { RunState } from "../schema/run.ts";

/**
 * Evaluate a condition. `fromNodeId` is the edge's source node, used by
 * `review_status` (which reads the decision recorded at that node).
 */
export function evaluateCondition(
  condition: EdgeCondition,
  run: RunState,
  fromNodeId: string,
): boolean {
  if (condition.type === "node_status") {
    const node = run.nodes[condition.node];
    if (!node || node.outcome === undefined) return false;
    return node.outcome === condition.equals;
  }
  const source = run.nodes[fromNodeId];
  if (!source || source.review_decision === undefined) return false;
  return source.review_decision === condition.equals;
}

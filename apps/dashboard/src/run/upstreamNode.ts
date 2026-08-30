import type { SpecDetail } from "../api/types";

/**
 * The node whose work a `human_review` gate is judging: the source of the
 * gate's single incoming edge.
 *
 * Conservative on purpose — it answers `null` rather than guessing whenever the
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

/**
 * Node type definitions for a workflow graph.
 *
 * Field names mirror the on-disk YAML/JSON spec 1:1 (snake_case where the spec
 * uses it) so loading is parse + validate with no field remapping layer.
 */

export type NodeType = "agent_task" | "condition" | "human_review" | "finish";

export type ReviewOption = "approved" | "rejected" | "needs_changes";

export type WorkspaceKind = "scratch" | "worktree";

export interface AgentTaskNode {
  id: string;
  type: "agent_task";
  title?: string;
  description?: string;
  /** Profile to assign the Kanban task to. Falls back to `defaults.profile`. */
  profile?: string;
  /** Per-node model override (maps to the native `model_override` column). */
  model?: string;
  /** Extra skills loaded for the worker (maps to the native `skills` column). */
  skills?: string[];
  workdir?: string;
  workspace?: { type: WorkspaceKind };
  /** The core "text prompt" handed to the worker. */
  prompt: string;
  /** Templated references to prior node outputs, e.g. `{{nodes.summarize.output}}`. */
  input_mapping?: Record<string, string>;
  /** Maps to the native `max_retries` column. */
  max_retries?: number;
  /** Maps to the native `max_runtime_seconds` column. */
  timeout_seconds?: number;
}

/** A routing-only node. It performs no work; its outgoing edges carry conditions. */
export interface ConditionNode {
  id: string;
  type: "condition";
  title?: string;
  description?: string;
}

export interface HumanReviewNode {
  id: string;
  type: "human_review";
  title?: string;
  description?: string;
  /** Allowed review decisions. Defaults to all three review options. */
  options?: ReviewOption[];
}

export interface FinishNode {
  id: string;
  type: "finish";
  title?: string;
  description?: string;
  outcome?: "success" | "failure";
}

export type WorkflowNode = AgentTaskNode | ConditionNode | HumanReviewNode | FinishNode;

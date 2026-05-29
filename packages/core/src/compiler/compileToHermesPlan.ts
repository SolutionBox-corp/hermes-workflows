/**
 * Compile a workflow into a deterministic preview of the Hermes primitives it
 * would create. Pure: no side effects, no I/O. This powers the dashboard
 * "compile preview" and the `compile-preview` CLI command.
 */

import type { Workflow, Trigger, MemoryProviderKind } from "../schema/workflow.ts";
import { entryNodes } from "../schema/graph.ts";

export interface CompiledKanbanTask {
  node: string;
  assignee: string;
  workflow_template_id: string;
  current_step_key: string;
  /** Everything the bridge needs to create the card — the engine is the single
   *  interpreter of the spec; the Python orchestrator just executes this. */
  title?: string;
  prompt: string;
  model?: string;
  skills?: string[];
  workspace?: "scratch" | "worktree";
  timeout_seconds?: number;
  max_retries?: number;
}

export interface CompiledCronJob {
  schedule: string;
  timezone?: string;
  command: string;
}

export interface HermesPlan {
  workflow_id: string;
  trigger: Trigger;
  first_node: string | null;
  kanban_tasks: CompiledKanbanTask[];
  cron_jobs: CompiledCronJob[];
  profiles: string[];
  skills: string[];
  memory: { provider: MemoryProviderKind; fail_open: boolean };
}

export function compileToHermesPlan(workflow: Workflow): HermesPlan {
  const defaultProfile = workflow.defaults?.profile;

  const kanban_tasks: CompiledKanbanTask[] = [];
  const profiles = new Set<string>();
  const skills = new Set<string>();

  const defaultRetries = workflow.defaults?.max_retries;

  for (const node of workflow.nodes) {
    if (node.type !== "agent_task") continue;
    const assignee = node.profile ?? defaultProfile ?? "";
    const task: CompiledKanbanTask = {
      node: node.id,
      assignee,
      workflow_template_id: workflow.id,
      current_step_key: node.id,
      prompt: node.prompt,
    };
    if (node.title !== undefined) task.title = node.title;
    if (node.model !== undefined) task.model = node.model;
    if (node.skills !== undefined) task.skills = node.skills;
    if (node.workspace !== undefined) task.workspace = node.workspace.type;
    if (node.timeout_seconds !== undefined) task.timeout_seconds = node.timeout_seconds;
    const retries = node.max_retries ?? defaultRetries;
    if (retries !== undefined) task.max_retries = retries;
    kanban_tasks.push(task);
    if (assignee) profiles.add(assignee);
    for (const skill of node.skills ?? []) skills.add(skill);
  }

  const cron_jobs: CompiledCronJob[] =
    workflow.trigger.type === "cron"
      ? [
          {
            schedule: workflow.trigger.schedule,
            ...(workflow.trigger.timezone !== undefined ? { timezone: workflow.trigger.timezone } : {}),
            command: `hermes-workflows run ${workflow.id}`,
          },
        ]
      : [];

  const entry = entryNodes(workflow)[0];

  return {
    workflow_id: workflow.id,
    trigger: workflow.trigger,
    first_node: entry ? entry.id : null,
    kanban_tasks,
    cron_jobs,
    profiles: [...profiles],
    skills: [...skills],
    memory: {
      provider: workflow.defaults?.memory?.provider ?? "auto",
      fail_open: workflow.defaults?.memory?.fail_open ?? true,
    },
  };
}

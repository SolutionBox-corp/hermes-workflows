/**
 * CLI command handlers. Each returns a JSON-able value; the argv dispatcher in
 * cli.ts prints it. Pure commands (validate/compile-preview/explain) and the
 * persistence/advance commands are all offline — the Python orchestrator wraps
 * `advance` with Kanban I/O via the bridge.
 */

import type { Workflow } from "../schema/workflow.ts";
import type { RunState } from "../schema/run.ts";
import { parseWorkflow } from "../schema/load.ts";
import { validateWorkflow } from "../validation/validateWorkflow.ts";
import type { ValidationResult } from "../validation/validateWorkflow.ts";
import { compileToHermesPlan } from "../compiler/compileToHermesPlan.ts";
import type { HermesPlan } from "../compiler/compileToHermesPlan.ts";
import { advance } from "../runtime/advance.ts";
import type { AdvanceResult } from "../runtime/advance.ts";
import { createRunState } from "../runtime/state.ts";
import { openRunsDatabase } from "../runtime/db/connection.ts";
import { RunRepository } from "../runtime/db/runRepository.ts";
import { SpecStore } from "../runtime/specStore.ts";
import type { SpecSummary } from "../runtime/specStore.ts";

export interface Explanation {
  id: string;
  name: string;
  trigger: string;
  nodes: { id: string; type: string; title?: string }[];
  edges: number;
}

async function loadWorkflow(specPath: string): Promise<Workflow> {
  return parseWorkflow(await Bun.file(specPath).text()).workflow;
}

function repository(dbPath: string): RunRepository {
  return new RunRepository(openRunsDatabase(dbPath));
}

export function cmdListSpecs(roots: string[]): Promise<SpecSummary[]> {
  return new SpecStore(roots).list();
}

export async function cmdValidate(specPath: string): Promise<ValidationResult> {
  return validateWorkflow(await loadWorkflow(specPath));
}

export async function cmdCompilePreview(specPath: string): Promise<HermesPlan> {
  return compileToHermesPlan(await loadWorkflow(specPath));
}

export async function cmdExplain(specPath: string): Promise<Explanation> {
  const workflow = await loadWorkflow(specPath);
  return {
    id: workflow.id,
    name: workflow.name,
    trigger: workflow.trigger.type,
    nodes: workflow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      ...(n.title !== undefined ? { title: n.title } : {}),
    })),
    edges: workflow.edges.length,
  };
}

export async function cmdAdvance(specPath: string, run: RunState): Promise<AdvanceResult> {
  return advance(await loadWorkflow(specPath), run);
}

export async function cmdRunCreate(
  dbPath: string,
  specPath: string,
  runId: string,
  projectId?: string,
): Promise<RunState> {
  const workflow = await loadWorkflow(specPath);
  const run = createRunState(workflow, runId, projectId);
  repository(dbPath).saveRun(run);
  return run;
}

export function cmdRunLoad(dbPath: string, runId: string): RunState | null {
  return repository(dbPath).loadRun(runId);
}

export function cmdRunSave(dbPath: string, run: RunState): void {
  repository(dbPath).saveRun(run);
}

export function cmdRunList(dbPath: string, activeOnly: boolean): RunState[] {
  const repo = repository(dbPath);
  return activeOnly ? repo.listActiveRuns() : repo.listAllRuns();
}

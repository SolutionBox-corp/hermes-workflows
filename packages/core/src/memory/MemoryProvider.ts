/**
 * Optional long-term memory seam. The engine never depends on a concrete
 * provider; OpenSecondBrain is one implementation, and absence is handled by
 * the Noop provider. All writes are expected to be fail-open at the call site.
 */

export interface WorkflowContextRequest {
  workflow_id: string;
  project_id?: string;
  /** Named context buckets to read, e.g. "writing_preferences". */
  keys?: string[];
}

export interface WorkflowContext {
  entries: Record<string, string>;
}

export type WorkflowMemoryEventKind = "run_started" | "node_failed" | "run_completed";

export interface WorkflowMemoryEvent {
  kind: WorkflowMemoryEventKind;
  title: string;
  body: string;
}

export interface WorkflowRetrospective {
  title: string;
  markdown: string;
}

export interface WorkflowMemoryProvider {
  isAvailable(): Promise<boolean>;
  readContext(request: WorkflowContextRequest): Promise<WorkflowContext>;
  writeEvent(event: WorkflowMemoryEvent): Promise<void>;
  writeRetrospective(retrospective: WorkflowRetrospective): Promise<void>;
}

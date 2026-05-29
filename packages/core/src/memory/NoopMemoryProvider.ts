/**
 * Default memory provider used when no long-term memory is configured or
 * available. Reads return empty context; writes are silently skipped.
 */

import type {
  WorkflowMemoryProvider,
  WorkflowContext,
  WorkflowContextRequest,
  WorkflowMemoryEvent,
  WorkflowRetrospective,
} from "./MemoryProvider.ts";

export class NoopMemoryProvider implements WorkflowMemoryProvider {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async readContext(_request: WorkflowContextRequest): Promise<WorkflowContext> {
    return { entries: {} };
  }

  async writeEvent(_event: WorkflowMemoryEvent): Promise<void> {
    // intentionally a no-op
  }

  async writeRetrospective(_retrospective: WorkflowRetrospective): Promise<void> {
    // intentionally a no-op
  }
}

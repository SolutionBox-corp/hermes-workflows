/**
 * Decorator that makes any memory provider fail-open and secret-safe:
 * - write payloads are redacted before delegating,
 * - all provider errors are swallowed (a memory problem never fails a run),
 * - reads degrade to empty context, availability degrades to false.
 */

import type {
  WorkflowMemoryProvider,
  WorkflowContext,
  WorkflowContextRequest,
  WorkflowMemoryEvent,
  WorkflowRetrospective,
} from "./MemoryProvider.ts";
import { redactSecrets } from "./redact.ts";

export class FailOpenMemoryProvider implements WorkflowMemoryProvider {
  constructor(private readonly inner: WorkflowMemoryProvider) {}

  async isAvailable(): Promise<boolean> {
    try {
      return await this.inner.isAvailable();
    } catch {
      return false;
    }
  }

  async readContext(request: WorkflowContextRequest): Promise<WorkflowContext> {
    try {
      return await this.inner.readContext(request);
    } catch {
      return { entries: {} };
    }
  }

  async writeEvent(event: WorkflowMemoryEvent): Promise<void> {
    try {
      await this.inner.writeEvent({
        kind: event.kind,
        title: redactSecrets(event.title),
        body: redactSecrets(event.body),
      });
    } catch {
      // fail-open: never propagate memory write errors
    }
  }

  async writeRetrospective(retrospective: WorkflowRetrospective): Promise<void> {
    try {
      await this.inner.writeRetrospective({
        title: redactSecrets(retrospective.title),
        markdown: redactSecrets(retrospective.markdown),
      });
    } catch {
      // fail-open
    }
  }
}

import { useState } from "react";
import type { WorkflowsApi } from "../api/client";
import type { NodeRecordArtifact, NodeRunState, WorkflowNode } from "../api/types";
import { NodeDefinition } from "./NodeDefinition";
import { TelemetryDetail } from "./TelemetryDetail";
import { useNodeArtifact } from "./useNodeArtifact";

export interface NodeRecordDetailProps {
  api: WorkflowsApi;
  runId: string;
  nodeId: string;
  node: NodeRunState;
  /** The node's spec entry. Answers "what was this step asked to do" without
   *  any cooperation from the step itself. */
  spec?: WorkflowNode;
  /** The node's title from the spec. Rendered as a heading only when given —
   *  the primary record in a modal already has the title in the modal's own
   *  header, while an embedded record (a gate showing the step it judges) needs
   *  to say which step it is describing. */
  title?: string;
  /** The node's description from the spec: what this step is for. */
  description?: string;
}

/** `finished_at - started_at`, in the same shape TelemetryDetail formats. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * One artifact as a collapsed section. The content is fetched the first time it
 * is opened and not before — the run state carries only the name and size.
 */
function ArtifactSection({
  api,
  runId,
  nodeId,
  artifact,
}: {
  api: WorkflowsApi;
  runId: string;
  nodeId: string;
  artifact: NodeRecordArtifact;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { text, truncated, loading, error } = useNodeArtifact(
    api,
    runId,
    nodeId,
    artifact.name,
    open,
  );
  const size = formatBytes(artifact.bytes);
  return (
    <details className="hw-artifact" open={open}>
      {/* Controlled from the summary's own click rather than the element's
          `toggle` event: jsdom does not implement the native details/summary
          toggle, so a test could click this open and observe nothing happen.
          preventDefault stops a real browser from then toggling it a second
          time on top of the state change. */}
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        {artifact.label ?? artifact.name}
        {size !== "" && <span className="hw-artifact__size"> · {size}</span>}
      </summary>
      {loading && <p className="hw-note">Loading…</p>}
      {error !== null && (
        <p className="hw-error" role="alert">
          Could not read {artifact.name}: {error}
        </p>
      )}
      {text !== null && (
        <pre className={artifact.kind === "diff" ? "hw-output hw-diff" : "hw-output"}>{text}</pre>
      )}
      {(truncated || artifact.truncated === true) && (
        <p className="hw-note">Truncated at the artifact size cap — this copy is incomplete.</p>
      )}
    </details>
  );
}

/**
 * One node's audit record: what the step was for, how it ended, how long it
 * took, what it cost, the evidence it left, and where the work is waiting.
 *
 * The raw output is always rendered last and is never conditional on a record
 * existing. A step that declared nothing is still a step, and the plain output
 * is what the inspector showed before any of this — losing it for such a node
 * would be a regression dressed as a feature.
 */
export function NodeRecordDetail({
  api,
  runId,
  nodeId,
  node,
  spec,
  title,
  description,
}: NodeRecordDetailProps): React.ReactElement {
  const record = node.record;
  const elapsed =
    node.started_at !== undefined && node.finished_at !== undefined
      ? formatElapsed(node.finished_at - node.started_at)
      : null;

  return (
    <div className="hw-record">
      <div className="hw-record__head">
        {title !== undefined && <h3 className="hw-record__title">{title}</h3>}
        {description !== undefined && <p className="hw-note">{description}</p>}
        <p className="hw-record__status">
          <span>{node.status}</span>
          {node.outcome !== undefined && <span> · {node.outcome}</span>}
          {node.review_decision !== undefined && <span> · {node.review_decision}</span>}
          {elapsed !== null && <span> · {elapsed}</span>}
        </p>
      </div>

      {/* What the step was asked to do, before anything about what it did. A
          `prompt` node has nothing else at all, and a step that emitted no
          record still shows the command it ran. */}
      <NodeDefinition node={spec} />

      {record?.headline !== undefined && <p className="hw-record__headline">{record.headline}</p>}

      {record?.facts !== undefined && record.facts.length > 0 && (
        <dl className="hw-record__facts">
          {record.facts.map((fact) => (
            <div key={fact.label} className="hw-record__fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {node.telemetry !== undefined && (
        <TelemetryDetail
          telemetry={node.telemetry}
          nodeActive={node.status === "scheduled" || node.status === "running"}
        />
      )}

      {record?.artifacts !== undefined && record.artifacts.length > 0 && (
        <div className="hw-record__section">
          <div className="hw-eyebrow">Evidence</div>
          {record.artifacts.map((artifact) => (
            <ArtifactSection
              key={artifact.name}
              api={api}
              runId={runId}
              nodeId={nodeId}
              artifact={artifact}
            />
          ))}
        </div>
      )}

      {record?.handoff !== undefined && record.handoff.length > 0 && (
        <div className="hw-record__section">
          <div className="hw-eyebrow">Continue here</div>
          <dl className="hw-record__facts">
            {record.handoff.map((row) => (
              <div key={row.label} className="hw-record__fact">
                <dt>{row.label}</dt>
                <dd>
                  <code>{row.value}</code>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {record?.warnings !== undefined && record.warnings.length > 0 && (
        <ul className="hw-record__warnings">
          {record.warnings.map((warning) => (
            <li key={warning} className="hw-note">
              {warning}
            </li>
          ))}
        </ul>
      )}

      {node.error !== undefined && (
        <p className="hw-error" role="alert">
          {node.error}
        </p>
      )}

      {node.stderr !== undefined && (
        <details className="hw-artifact">
          <summary>Diagnostics (stderr)</summary>
          <pre className="hw-output">{node.stderr}</pre>
        </details>
      )}

      {node.output !== undefined && (
        <details className="hw-artifact" open={record === undefined}>
          <summary>Raw output</summary>
          <pre className="hw-output">{node.output}</pre>
        </details>
      )}
    </div>
  );
}

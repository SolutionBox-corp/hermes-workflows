import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getApiClient } from "../host";
import type { WorkflowsApi } from "../api/client";
import type { ReviewDecision, SpecDetail } from "../api/types";
import { applyRunStatus, isTerminalRun } from "./runView";
import { CANVAS_NODE_TYPES } from "./canvasNodeTypes";
import { errorMessage, RUN_POLL_MS, useRunPolling } from "./useRunPolling";
import { NodeRecordDetail } from "./NodeRecordDetail";
import { resolveGatedNode, resolveNodeInput, reviewRoutes } from "./gateGraph";
import { RunLogPanel } from "./RunLogPanel";
import { deriveRunLogEvents, mergeRunLog, type LoggedRunEvent } from "./runLog";
import { Badge, Button, Modal } from "../ui/components";
import { useHeaderSlots } from "../ui/PluginHeader";

export interface RunInspectorProps {
  runId: string;
  /** Injected for tests; defaults to the host-bound client. */
  client?: WorkflowsApi;
  /** Poll interval while the run is active. */
  pollMs?: number;
}

export function RunInspector({
  runId,
  client,
  pollMs = RUN_POLL_MS,
}: RunInspectorProps): React.ReactElement {
  const api = client ?? getApiClient();
  const { run, pollError, replaceRun } = useRunPolling(api, runId, pollMs);
  const [detail, setDetail] = useState<SpecDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // Cancel/retry failure; cleared by the next attempt, shown next to the title.
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [log, setLog] = useState<LoggedRunEvent[]>([]);
  // The reviewer's note for the gate currently open in the modal.
  const [reviewNote, setReviewNote] = useState<string>("");
  const [reviewPending, setReviewPending] = useState(false);
  const slots = useHeaderSlots();

  // Drop the prior run's curated log when the inspected run changes without an
  // unmount; otherwise key-dedupe would suppress the new run's `run:started`.
  useEffect(() => {
    setLog([]);
  }, [runId]);

  // Append any newly-observed run-lifecycle events to the curated run log,
  // stamping each with the time it was first seen (kept on later polls).
  useEffect(() => {
    if (run === null) return;
    setLog((prev) => mergeRunLog(prev, deriveRunLogEvents(run), Date.now()));
  }, [run]);

  // The workflow graph is static for the run's life: load it once the run
  // reveals its workflow id.
  const workflowId = run?.workflow_id;
  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    if (workflowId === undefined) return undefined;
    let active = true;
    api
      .getWorkflow(workflowId)
      .then((workflow) => {
        if (active) setDetail(workflow);
      })
      .catch((error: unknown) => {
        if (active) setDetailError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [api, workflowId]);

  const cancel = useCallback(() => {
    setActionError(null);
    api
      .cancelRun(runId)
      .then(replaceRun)
      .catch((error: unknown) => setActionError(`Cancel failed: ${errorMessage(error)}`));
  }, [api, runId, replaceRun]);

  const retry = useCallback(
    (node?: string) => {
      setActionError(null);
      api
        .retryRun(runId, node)
        .then(replaceRun)
        .catch((error: unknown) => setActionError(`Retry failed: ${errorMessage(error)}`));
    },
    [api, runId, replaceRun],
  );

  const review = useCallback(
    (node: string, decision: ReviewDecision, note: string) => {
      setActionError(null);
      setReviewPending(true);
      api
        .reviewRun(runId, node, decision, note)
        .then(() => api.getRun(runId))
        .then(replaceRun)
        .then(() => {
          setReviewNote("");
          setSelectedNodeId(null);
        })
        .catch((error: unknown) => setActionError(`Review failed: ${errorMessage(error)}`))
        .finally(() => setReviewPending(false));
    },
    [api, runId, replaceRun],
  );

  if (run === null && pollError !== null) {
    return (
      <p className="hw-page" role="alert">
        Failed to load run: {pollError}
      </p>
    );
  }
  if (detailError !== null) {
    return (
      <p className="hw-page" role="alert">
        Failed to load workflow: {detailError}
      </p>
    );
  }
  if (run === null || detail === null) return <p className="hw-page">Loading run…</p>;

  const inspectorError = pollError ?? actionError;

  const { nodes, edges } = applyRunStatus(detail, run);
  // Source handles each node uses (by an outgoing edge), so the run canvas
  // renders the handles its conditioned/fallback edges leave from and the edges
  // stay anchored.
  const usedHandlesByNode: Record<string, string[]> = {};
  for (const edge of edges) {
    (usedHandlesByNode[edge.source] ??= []).push(edge.sourceHandle ?? "out");
  }
  // Carry the open-detail handler on each node's data: ReactFlow does not
  // propagate React context into custom node components, so a context provider
  // would never reach RunNodeView's open button.
  const canvasNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onSelect: setSelectedNodeId,
      usedHandles: usedHandlesByNode[node.id] ?? [],
    },
  }));
  const selected = selectedNodeId === null ? undefined : run.nodes[selectedNodeId];
  const terminal = isTerminalRun(run.status);

  // Spec entries carry the node's title and description — what the step is for,
  // in the author's words. The modal used to show the bare node id and none of
  // this, so a reader had to already know what `explore` meant.
  const specNode = (id: string) => detail.workflow.nodes?.find((node) => node.id === id);
  const selectedSpec = selectedNodeId === null ? undefined : specNode(selectedNodeId);

  // For a gate, the step it is judging. `resolveGatedNode` declines whenever the
  // graph is ambiguous, and a gate whose upstream node has not run yet has no
  // record to show, so both cases fall back to the buttons alone.
  const isGate = selected?.status === "waiting_for_review";
  // What each button does, read from the graph. A gate asked for a decision and
  // said nothing about the consequence of any of its three choices; the spec
  // knows, so there is no reason to learn it by pressing one.
  const routes = isGate && selectedNodeId !== null ? reviewRoutes(detail, selectedNodeId) : [];
  const gatedId =
    selectedNodeId !== null && isGate ? resolveGatedNode(detail, selectedNodeId) : null;
  const gatedNode = gatedId === null ? undefined : run.nodes[gatedId];
  const gated =
    gatedId !== null && gatedNode !== undefined
      ? { nodeId: gatedId, node: gatedNode, spec: specNode(gatedId) }
      : null;

  const title = (
    <>
      <span className="hw-bar-title">{run.run_id}</span>
      <Badge tone={run.status}>{run.status}</Badge>
      {inspectorError !== null && (
        <span role="alert" className="hw-bar-status hw-error">
          {inspectorError}
        </span>
      )}
    </>
  );
  const actions = (
    <>
      <Button onClick={cancel} disabled={terminal}>
        Cancel
      </Button>
      <Button onClick={() => retry()}>Retry run</Button>
    </>
  );

  return (
    <>
      {slots ? (
        <>
          {slots.leftHost ? createPortal(title, slots.leftHost) : null}
          {slots.actionsHost ? createPortal(actions, slots.actionsHost) : null}
        </>
      ) : (
        <div className="hw-editor-toolbar">
          {title}
          {actions}
        </div>
      )}

      <div className="hw-shell">
        <div className="hw-editor-body">
          <div className="hw-canvas">
            <ReactFlow
              nodes={canvasNodes}
              edges={edges}
              nodeTypes={CANVAS_NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls />
            </ReactFlow>
            <RunLogPanel events={log} />
          </div>
        </div>
      </div>

      {/* Click a node to inspect it — the detail (status, output, telemetry,
          retry) opens in a modal, mirroring the editor's node inspector, so
          the run view is a clean canvas with its actions in the header. */}
      {selected !== undefined && selectedNodeId !== null && (
        <Modal
          // The step's name, not its id. `explore` says nothing to a reader who
          // has not read the spec; "1 · Prozkoumat a navrhnout" does.
          title={selectedSpec?.title ?? selectedNodeId}
          ariaLabel={`Node ${selectedNodeId}`}
          className="hw-node-modal"
          onClose={() => setSelectedNodeId(null)}
          footer={
            // A gate is the one node where "retry" is the wrong verb: the run is
            // not broken, it is waiting for a person. Until this existed the
            // dashboard could not resolve a gate at all — the endpoint and the
            // CLI had it, the UI never called them — so a human_review node was
            // a dead end you had to leave the browser to answer.
            selected.status === "waiting_for_review" ? (
              <div className="hw-review-actions">
                <Button
                  disabled={reviewPending}
                  onClick={() => review(selectedNodeId, "approved", reviewNote)}
                >
                  Approve
                </Button>
                <Button
                  disabled={reviewPending}
                  onClick={() => review(selectedNodeId, "needs_changes", reviewNote)}
                >
                  Needs changes
                </Button>
                <Button
                  disabled={reviewPending}
                  onClick={() => review(selectedNodeId, "rejected", reviewNote)}
                >
                  Reject
                </Button>
              </div>
            ) : (
              <Button onClick={() => retry(selectedNodeId)}>Retry node</Button>
            )
          }
        >
          {/* A gate judges the step above it, and until this existed it showed
              nothing about that step at all — you approved blind, or left the
              browser to go read files. Render the gated node's record first, so
              the evidence is above the buttons that act on it. */}
          {/* A gate's own instruction comes first and on its own: it says what
              the reviewer is deciding, and reading the evidence without knowing
              the question means reading it for the wrong thing. */}
          {isGate && selectedSpec?.description !== undefined && (
            <div className="hw-record__section">
              <div className="hw-eyebrow">Rozhoduješ</div>
              <p>{selectedSpec.description}</p>
            </div>
          )}

          {/* A gate judges the step above it, and until this existed it showed
              nothing about that step at all — you approved blind, or left the
              browser to go read files. Render the gated node's record first, so
              the evidence is above the buttons that act on it, and open the one
              artifact the step marked as the thing to read. */}
          {gated !== null && (
            <div className="hw-record-gated">
              <div className="hw-eyebrow">What you are approving</div>
              <NodeRecordDetail
                api={api}
                runId={runId}
                nodeId={gated.nodeId}
                node={gated.node}
                spec={gated.spec}
                title={gated.spec?.title}
                description={gated.spec?.description}
                expandPrimary
              />
            </div>
          )}
          {/* No `title` here: the modal header already carries it, and a second
              heading with the same text is noise. The embedded gated record
              above does pass one, because it has to say which step it describes.
              A gate's description is already shown above, so it is not repeated. */}
          <NodeRecordDetail
            api={api}
            runId={runId}
            nodeId={selectedNodeId}
            node={selected}
            spec={selectedSpec}
            description={isGate ? undefined : selectedSpec?.description}
            input={selectedNodeId === null ? null : resolveNodeInput(detail, selectedNodeId, run.nodes)}
          />
          {selected.status === "waiting_for_review" && routes.length > 0 && (
            <div className="hw-record__section">
              <div className="hw-eyebrow">Kam to půjde</div>
              <dl className="hw-record__facts">
                {routes.map((route) => (
                  <div key={route.decision} className="hw-record__fact">
                    <dt>{route.decision}</dt>
                    <dd>
                      {route.nodeId === null
                        ? "nikam — graf pro tuhle volbu nemá hranu"
                        : route.ends !== undefined
                          ? `${route.title ?? route.nodeId} · běh končí (${route.ends})`
                          : (route.title ?? route.nodeId)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {selected.status === "waiting_for_review" && (
            <label className="hw-review-note">
              Note for the next step
              <textarea
                aria-label="Review note"
                rows={3}
                value={reviewNote}
                disabled={reviewPending}
                onChange={(event) => setReviewNote(event.target.value)}
              />
            </label>
          )}
        </Modal>
      )}
    </>
  );
}

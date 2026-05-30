import { useCallback, useMemo, useState } from "react";
import { getApiClient } from "../host";
import type { WorkflowsApi } from "../api/client";
import type { Scope, ScopeType, Trigger } from "../api/types";
import { buildSeedWorkflow } from "./seed";

export interface NewWorkflowModalProps {
  /** Called with the new workflow id once it is created on disk. */
  onCreated: (workflowId: string) => void;
  /** Dismiss without creating. */
  onCancel: () => void;
  /** Injected for tests; defaults to the host-bound client. */
  client?: WorkflowsApi;
}

// Mirror the core id charset (it becomes the on-disk filename). The core remains
// the authority and re-validates; this only spares an obviously-bad round-trip.
const SLUG = /^[A-Za-z0-9_-]+$/;

function parseProjects(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function buildScope(type: ScopeType, projectsRaw: string): Scope {
  if (type === "global") return { type };
  return { type, projects: parseProjects(projectsRaw) };
}

export function NewWorkflowModal({
  onCreated,
  onCancel,
  client,
}: NewWorkflowModalProps): React.ReactElement {
  const api = useMemo(() => client ?? getApiClient(), [client]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("global");
  const [projects, setProjects] = useState("");
  const [triggerType, setTriggerType] = useState<Trigger["type"]>("manual");
  const [schedule, setSchedule] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    // Only `preventDefault` is needed; typed structurally because @types/react
    // marks the `FormEvent` alias deprecated ("doesn't actually exist").
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
      if (!SLUG.test(id)) {
        setError("Id must be a slug: letters, digits, hyphen, or underscore only.");
        return;
      }
      if (triggerType === "cron" && schedule.trim().length === 0) {
        setError("A cron trigger needs a schedule.");
        return;
      }
      const trigger: Trigger =
        triggerType === "cron" ? { type: "cron", schedule: schedule.trim() } : { type: "manual" };
      const workflow = buildSeedWorkflow({
        id,
        name: name.trim() || id,
        scope: buildScope(scopeType, projects),
        trigger,
      });

      setBusy(true);
      setError(null);
      api
        .createWorkflow({ workflow })
        .then(() => onCreated(id))
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Could not create the workflow.");
          setBusy(false);
        });
    },
    [api, id, name, scopeType, projects, triggerType, schedule, onCreated],
  );

  return (
    <div role="dialog" aria-label="New workflow" style={overlay}>
      <form onSubmit={submit} style={panel}>
        <h3 style={{ margin: 0 }}>New workflow</h3>

        <label htmlFor="nw-id">Id</label>
        <input id="nw-id" value={id} onChange={(e) => setId(e.target.value)} autoFocus />

        <label htmlFor="nw-name">Name</label>
        <input id="nw-name" value={name} onChange={(e) => setName(e.target.value)} />

        <label htmlFor="nw-scope">Scope</label>
        <select
          id="nw-scope"
          value={scopeType}
          onChange={(e) => setScopeType(e.target.value as ScopeType)}
        >
          <option value="global">global</option>
          <option value="project">project</option>
          <option value="projects">projects</option>
        </select>
        {scopeType !== "global" && (
          <>
            <label htmlFor="nw-projects">Projects (comma-separated)</label>
            <input
              id="nw-projects"
              value={projects}
              onChange={(e) => setProjects(e.target.value)}
            />
          </>
        )}

        <label htmlFor="nw-trigger">Trigger</label>
        <select
          id="nw-trigger"
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as Trigger["type"])}
        >
          <option value="manual">manual</option>
          <option value="cron">cron</option>
        </select>
        {triggerType === "cron" && (
          <>
            <label htmlFor="nw-schedule">Schedule (cron)</label>
            <input
              id="nw-schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 5 * * *"
            />
          </>
        )}

        {error !== null && (
          <p role="alert" style={{ color: "var(--error, #d33)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const panel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 320,
  padding: 20,
  background: "var(--bg, #1e1e1e)",
  border: "1px solid var(--border, #2a2a2a)",
  borderRadius: 8,
};

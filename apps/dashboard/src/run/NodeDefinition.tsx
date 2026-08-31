import type { WorkflowNode } from "../api/types";

/**
 * What a step *is*, read out of the workflow spec.
 *
 * The audit record covers what a step did; this covers what it was asked to do,
 * and it needs no cooperation from the step at all - the answer is already in
 * the workflow. Without it a `prompt` node, whose entire content is its text,
 * rendered as a status line and nothing else, and a script node never showed
 * the command it ran.
 *
 * Every node kind contributes whatever it has. A kind with nothing definable
 * (`condition`) renders nothing rather than an empty heading.
 */

interface Row {
  label: string;
  value: string;
  /** Long free text (a prompt) reads as a block, not as a table cell. */
  block?: boolean;
}

function rowsFor(node: WorkflowNode): Row[] {
  const rows: Row[] = [];
  // Read field by field across every node kind rather than switching on `type`:
  // a kind that gains a field later shows it without another edit here, and a
  // kind that lacks one simply contributes no row.
  const n = node as unknown as Record<string, unknown>;

  const prompt = typeof n.prompt === "string" ? n.prompt.trim() : "";
  if (prompt !== "") rows.push({ label: "Prompt", value: prompt, block: true });

  if (typeof n.command === "string") rows.push({ label: "command", value: n.command });
  if (typeof n.workdir === "string") rows.push({ label: "workdir", value: n.workdir });
  if (typeof n.profile === "string") rows.push({ label: "profile", value: n.profile });
  if (typeof n.model === "string") rows.push({ label: "model", value: n.model });
  if (Array.isArray(n.skills) && n.skills.length > 0) {
    rows.push({ label: "skills", value: n.skills.join(", ") });
  }
  if (Array.isArray(n.env) && n.env.length > 0) {
    rows.push({ label: "env", value: n.env.join(", ") });
  }
  if (Array.isArray(n.options) && n.options.length > 0) {
    rows.push({ label: "options", value: n.options.join(", ") });
  }
  if (n.wait_for !== undefined && n.wait_for !== null && typeof n.wait_for === "object") {
    for (const [key, value] of Object.entries(n.wait_for as Record<string, unknown>)) {
      rows.push({ label: key, value: String(value) });
    }
  }
  if (typeof n.outcome === "string") rows.push({ label: "outcome", value: n.outcome });
  if (typeof n.timeout_seconds === "number") {
    rows.push({ label: "timeout", value: `${n.timeout_seconds}s` });
  }
  if (typeof n.max_retries === "number") {
    rows.push({ label: "max retries", value: String(n.max_retries) });
  }
  return rows;
}

export function NodeDefinition({ node }: { node?: WorkflowNode }): React.ReactElement | null {
  if (node === undefined) return null;
  const rows = rowsFor(node);
  if (rows.length === 0) return null;

  const blocks = rows.filter((r) => r.block === true);
  const pairs = rows.filter((r) => r.block !== true);

  return (
    <div className="hw-record__section">
      <div className="hw-eyebrow">Definition</div>
      {blocks.map((row) => (
        <pre key={row.label} className="hw-output">
          {row.value}
        </pre>
      ))}
      {pairs.length > 0 && (
        <dl className="hw-record__facts">
          {pairs.map((row) => (
            <div key={row.label} className="hw-record__fact">
              <dt>{row.label}</dt>
              <dd>
                <code>{row.value}</code>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

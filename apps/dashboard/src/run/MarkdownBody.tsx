import { isValidElement } from "react";
import Markdown, { type MarkdownToJSX } from "markdown-to-jsx";
import { DiffBody } from "./DiffBody";

/**
 * A markdown artifact rendered as a document.
 *
 * Steps declare `kind: "markdown"` on the reports they write, and every one of
 * them used to arrive in the same monospace `<pre>` as a log dump: a 300-line
 * report reached the reviewer as `##`, `**` and backticks, which is a form to
 * decode rather than to read. The hint was already in the record; this is the
 * half that acts on it.
 *
 * The text is model output. It is rendered, never trusted: raw HTML stays raw
 * characters (`disableParsingRawHTML`), so nothing a step writes can put an
 * element into the dashboard. That is also why no markdown-to-HTML-string
 * library is used here - there is no HTML string to sanitise, only React
 * elements the compiler builds itself.
 */

/** Everything under a node, flattened back to the text it came from. */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/**
 * A fenced block. The compiler hands `pre` its `<code>` child, whose class
 * carries the fence's language (`lang-diff`).
 *
 * A fenced diff is the same thing a `kind: "diff"` artifact is, so it goes
 * through the same DiffBody rather than a second colouring rule that would
 * drift from it. Everything else keeps the plain output styling it had.
 */
function FencedBlock({ children }: { children?: React.ReactNode }): React.ReactElement {
  const code = isValidElement<{ className?: string; children?: React.ReactNode }>(children)
    ? children
    : null;
  const text = textOf(code === null ? children : code.props.children);
  const language = code?.props.className ?? "";
  if (/(^|\s)lang-diff(\s|$)/.test(language)) return <DiffBody text={text} />;
  return <pre className="hw-output">{text}</pre>;
}

/**
 * A table in its own scrolling box. A wide table would otherwise widen the
 * modal until the gate's own Approve / Reject buttons leave the screen.
 */
function TableBox({ children }: { children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="hw-md__tablebox">
      <table>{children}</table>
    </div>
  );
}

/**
 * Headings drop two levels: the modal already owns `h3` for the step's title,
 * so a report's own `#` starts at `h4` and the page keeps one outline instead
 * of restarting it inside a section. Size is CSS's job, not the tag's.
 */
const OPTIONS: MarkdownToJSX.Options = {
  disableParsingRawHTML: true,
  // Always block-level: a one-line artifact should still be a paragraph, not a
  // bare span glued to whatever sits next to it.
  forceBlock: true,
  overrides: {
    h1: { component: "h4" },
    h2: { component: "h5" },
    h3: { component: "h6" },
    h4: { component: "h6" },
    h5: { component: "h6" },
    h6: { component: "h6" },
    pre: { component: FencedBlock },
    table: { component: TableBox },
    // A report links out to a repo or a dashboard; opening that over the run
    // inspector would lose the review in progress.
    a: { props: { target: "_blank", rel: "noopener noreferrer" } },
  },
};

export function MarkdownBody({ text }: { text: string }): React.ReactElement {
  return (
    <div className="hw-md">
      <Markdown options={OPTIONS}>{text}</Markdown>
    </div>
  );
}

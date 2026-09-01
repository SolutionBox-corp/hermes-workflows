/** A markdown artifact rendered as a document.
 *
 * Steps already declare `kind: "markdown"` on the reports they write, and the
 * inspector rendered every one of them into the same monospace `<pre>` as a log
 * dump: a 300-line report arrived as `## Step 1`, `**FEATURE**` and backticks,
 * which is the form a reviewer has to decode rather than read.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownBody } from "../src/run/MarkdownBody";

const REPORT = [
  "# What this task turned out to be",
  "",
  "## Step 1 - bug or feature",
  "",
  "**FEATURE**, and specifically not yet startable.",
  "",
  "### Reference discovery",
  "",
  "- first blocker",
  "- second blocker",
  "",
].join("\n");

describe("MarkdownBody", () => {
  it("renders headings, lists and emphasis as elements rather than as source", () => {
    const { container } = render(<MarkdownBody text={REPORT} />);

    expect(screen.getByRole("heading", { level: 4 }).textContent).toContain("What this task");
    expect(screen.getByRole("heading", { level: 5 }).textContent).toContain("Step 1");
    expect(screen.getByRole("heading", { level: 6 }).textContent).toContain("Reference discovery");
    expect(screen.getByText("FEATURE").tagName).toBe("STRONG");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    // The markers are consumed, not printed: seeing `##` or `**` on screen is
    // the whole defect this answers.
    expect(container.textContent).not.toContain("##");
    expect(container.textContent).not.toContain("**");
  });

  it("keeps a fenced block verbatim instead of parsing what is inside it", () => {
    const text = ["```", "## not a heading", "```"].join("\n");
    const { container } = render(<MarkdownBody text={text} />);

    expect(container.querySelector("pre.hw-output")?.textContent).toContain("## not a heading");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("colours a fenced diff the same way a diff artifact is coloured", () => {
    const text = ["```diff", "--- a/x", "+++ b/x", "-old", "+new", "```"].join("\n");
    const { container } = render(<MarkdownBody text={text} />);

    expect(container.querySelector(".hw-diff__add")?.textContent).toContain("+new");
    expect(container.querySelector(".hw-diff__del")?.textContent).toContain("-old");
    // `+++`/`---` are file headers, not an added or a removed line.
    const heads = [...container.querySelectorAll(".hw-diff__head")].map((e) => e.textContent?.trim());
    expect(heads).toContain("+++ b/x");
  });

  it("does not let raw HTML in the text become elements", () => {
    // The text is model output. It is rendered, never trusted: an artifact that
    // happens to contain a tag must read as that tag's characters.
    const text = 'Prose with <img src="x" onerror="boom()"> and <b>markup</b> in it.';
    const { container } = render(<MarkdownBody text={text} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<img");
    expect(container.textContent).toContain("<b>markup</b>");
  });

  it("renders a table inside its own scrolling box", () => {
    const text = ["| krok | stav |", "| --- | --- |", "| explore | hotovo |"].join("\n");
    const { container } = render(<MarkdownBody text={text} />);

    // A wide table must scroll in its own box; letting it widen the modal
    // pushes the gate's own buttons off screen.
    expect(container.querySelector(".hw-md__tablebox table")).not.toBeNull();
    expect(screen.getByText("explore").tagName).toBe("TD");
  });

  it("sends a link to a new tab without handing it the opener", () => {
    const { container } = render(<MarkdownBody text="[docs](https://example.test/doc)" />);

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/doc");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });
});

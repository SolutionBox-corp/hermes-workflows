/**
 * A patch, coloured per line so it reads the way a diff is meant to read.
 *
 * A single `<pre>` cannot colour anything: the artifact is plain text with no
 * per-line elements to target, so a diff looked exactly like any other file and
 * a reviewer had to spot `+` and `-` by eye. Each line becomes its own element
 * classed by what it is, which is also what lets a long patch be skimmed.
 *
 * Its own module because two places render a patch: a `kind: "diff"` artifact,
 * and a fenced ```diff block inside a markdown report. One rule set, so the two
 * cannot drift apart.
 */
export function DiffBody({ text }: { text: string }): React.ReactElement {
  return (
    <pre className="hw-output hw-diff">
      {text.split("\n").map((line, index) => {
        // Order matters: `+++` and `---` are file headers, not an added or a
        // removed line, and colouring them green and red is actively wrong.
        const kind = line.startsWith("+++") || line.startsWith("---")
          ? "head"
          : line.startsWith("@@")
            ? "hunk"
            : line.startsWith("diff ") || line.startsWith("index ")
              ? "head"
              : line.startsWith("+")
                ? "add"
                : line.startsWith("-")
                  ? "del"
                  : "ctx";
        return (
          <span key={index} className={`hw-diff__${kind}`}>
            {/* A blank context line still needs to occupy one: an empty span
                collapses and the patch loses the gap it had. */}
            {line === "" ? " " : line}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

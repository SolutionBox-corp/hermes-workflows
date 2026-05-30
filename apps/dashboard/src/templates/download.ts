// Trigger a client-side download of text content. Isolated from the page so the
// DOM plumbing stays in one testable place and the page handlers read cleanly.
export function downloadTextFile(filename: string, content: string, type = "text/yaml"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

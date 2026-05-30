/**
 * Serialize a workflow (plus optional ui layout) back to a portable spec string.
 *
 * Bun ships `Bun.YAML.parse` but no stringify, and the project keeps zero runtime
 * dependencies. So this emitter writes YAML *structure* (indented maps, block
 * sequences) while every *scalar* goes through `JSON.stringify`. A JSON
 * double-quoted string is a valid YAML double-quoted scalar, so the round-trip
 * `parseWorkflow(serializeWorkflow(w, ui))` deep-equals `{ workflow: w, ui }` by
 * construction — multiline prompts and special characters are escaped safely.
 *
 * Known cosmetic limit: multiline strings emit as quoted scalars with `\n`, not
 * `|` block scalars. Acceptable for an editor foundation.
 */

import type { Workflow } from "../schema/workflow.ts";
import type { UiLayout } from "../schema/ui.ts";

const INDENT = "  ";

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

/** Every scalar (string, number, boolean, null) emits as a JSON-quoted token. */
function scalar(value: unknown): string {
  return JSON.stringify(value);
}

function definedEntries(obj: Record<string, unknown>): [string, unknown][] {
  return Object.entries(obj).filter(([, v]) => v !== undefined);
}

function emitMapping(obj: Record<string, unknown>, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const lines: string[] = [];
  for (const [key, value] of definedEntries(obj)) {
    if (isScalar(value)) {
      lines.push(`${pad}${key}: ${scalar(value)}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(...emitSequence(value, depth + 1));
      }
    } else {
      const entries = definedEntries(value as Record<string, unknown>);
      if (entries.length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(...emitMapping(value as Record<string, unknown>, depth + 1));
      }
    }
  }
  return lines;
}

function emitSequence(arr: unknown[], depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const lines: string[] = [];
  for (const item of arr) {
    if (isScalar(item)) {
      lines.push(`${pad}- ${scalar(item)}`);
    } else if (Array.isArray(item)) {
      lines.push(`${pad}-`);
      lines.push(...emitSequence(item, depth + 1));
    } else {
      const entries = definedEntries(item as Record<string, unknown>);
      if (entries.length === 0) {
        lines.push(`${pad}- {}`);
      } else {
        // Dash on its own line, mapping keys indented under it (valid YAML).
        lines.push(`${pad}-`);
        lines.push(...emitMapping(item as Record<string, unknown>, depth + 1));
      }
    }
  }
  return lines;
}

/** Emit `workflow` (and `ui`, when present) as a portable YAML spec string. */
export function serializeWorkflow(workflow: Workflow, ui?: UiLayout): string {
  const doc: Record<string, unknown> = { ...workflow };
  if (ui !== undefined) doc["ui"] = ui;
  return emitMapping(doc, 0).join("\n") + "\n";
}

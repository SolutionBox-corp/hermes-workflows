/**
 * Discover, load, and save workflow specs across the configured storage roots
 * (`~/.hermes/workflows/{global,templates}` and `<project>/.hermes/workflows`).
 * Listing skips files that fail to parse so one bad spec does not hide the rest.
 */

import { readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { parseWorkflow } from "../schema/load.ts";
import type { LoadResult } from "../schema/load.ts";
import type { Scope, Trigger } from "../schema/workflow.ts";

export interface SpecSummary {
  id: string;
  name: string;
  scope: Scope;
  trigger: Trigger["type"];
  path: string;
}

export class SpecStore {
  constructor(private readonly roots: string[]) {}

  async list(): Promise<SpecSummary[]> {
    const fileLists = await Promise.all(this.roots.map((root) => this.specFiles(root)));
    const summaries = await Promise.all(fileLists.flat().map((path) => this.summarize(path)));
    return summaries.filter((s): s is SpecSummary => s !== null);
  }

  private async summarize(path: string): Promise<SpecSummary | null> {
    try {
      const { workflow } = parseWorkflow(await Bun.file(path).text());
      return {
        id: workflow.id,
        name: workflow.name,
        scope: workflow.scope,
        trigger: workflow.trigger.type,
        path,
      };
    } catch {
      return null; // skip unparseable spec files when listing
    }
  }

  async load(id: string): Promise<LoadResult | null> {
    const match = (await this.list()).find((s) => s.id === id);
    if (!match) return null;
    return parseWorkflow(await Bun.file(match.path).text());
  }

  /** Persist a spec into the first (primary) root and return its path. */
  async save(id: string, source: string): Promise<string> {
    const root = this.roots[0];
    if (root === undefined) throw new Error("SpecStore has no root to save into");
    await mkdir(root, { recursive: true });
    const path = join(root, `${id}.workflow.yaml`);
    await Bun.write(path, source);
    return path;
  }

  private async specFiles(root: string): Promise<string[]> {
    try {
      const entries = await readdir(root);
      return entries
        .filter((f) => f.endsWith(".workflow.yaml") || f.endsWith(".workflow.json"))
        .map((f) => join(root, f));
    } catch {
      return []; // missing directory → no specs
    }
  }
}

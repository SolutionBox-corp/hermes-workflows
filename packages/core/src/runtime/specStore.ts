/**
 * Discover, load, and save workflow specs across the configured storage roots
 * (`~/.hermes/workflows/{global,templates}` and `<project>/.hermes/workflows`).
 * Listing skips files that fail to parse so one bad spec does not hide the rest.
 */

import { readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { parseWorkflow } from "../schema/load.ts";
import type { LoadResult } from "../schema/load.ts";
import type { Scope, Trigger, Workflow } from "../schema/workflow.ts";
import type { UiLayout } from "../schema/ui.ts";
import { serializeWorkflow } from "../serialize/serializeWorkflow.ts";
import { validateWorkflow } from "../validation/validateWorkflow.ts";
import type { ValidationIssue } from "../validation/validateWorkflow.ts";

export interface SpecSummary {
  id: string;
  name: string;
  scope: Scope;
  trigger: Trigger["type"];
  path: string;
}

/** A loaded spec with its on-disk location, for the editor to render and save. */
export interface SpecDetail {
  workflow: Workflow;
  ui?: UiLayout;
  path: string;
}

/** Candidate write roots; `chooseWriteRoot` picks one from the workflow scope. */
export interface WriteRoots {
  global: string;
  templates?: string;
  project?: string;
}

/** Raised when a save is refused because the graph fails validation. */
export class SpecValidationError extends Error {
  override name = "SpecValidationError";
  constructor(readonly errors: ValidationIssue[]) {
    super(`workflow failed validation: ${errors.map((e) => e.code).join(", ")}`);
  }
}

/** Pick the destination root for a workflow from its scope. Pure. */
export function chooseWriteRoot(scope: Scope, roots: WriteRoots): string {
  if (scope.type === "project" && roots.project) return roots.project;
  return roots.global;
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

  /** Load a spec with its on-disk path, for the editor. */
  async getById(id: string): Promise<SpecDetail | null> {
    const match = (await this.list()).find((s) => s.id === id);
    if (!match) return null;
    const { workflow, ui } = parseWorkflow(await Bun.file(match.path).text());
    return ui === undefined ? { workflow, path: match.path } : { workflow, ui, path: match.path };
  }

  /** Persist a raw spec source into the first (primary) root and return its path. */
  async save(id: string, source: string): Promise<string> {
    const root = this.roots[0];
    if (root === undefined) throw new Error("SpecStore has no root to save into");
    await mkdir(root, { recursive: true });
    const path = join(root, `${id}.workflow.yaml`);
    await Bun.write(path, source);
    return path;
  }

  /**
   * Validate, serialize, and write a workflow to `destRoot`, returning its path.
   * Refuses (throws {@link SpecValidationError}) if the graph has errors, so no
   * invalid spec is ever persisted. Removes any other same-id file across the
   * read roots so there is exactly one spec per id.
   */
  async saveWorkflow(workflow: Workflow, ui: UiLayout | undefined, destRoot: string): Promise<string> {
    const result = validateWorkflow(workflow);
    if (!result.valid) throw new SpecValidationError(result.errors);

    await mkdir(destRoot, { recursive: true });
    const path = join(destRoot, `${workflow.id}.workflow.yaml`);
    await Bun.write(path, serializeWorkflow(workflow, ui));

    const stale = (await this.pathsFor(workflow.id)).filter((p) => p !== path);
    await Promise.all(stale.map((p) => unlink(p).catch(() => undefined)));
    return path;
  }

  /** Like {@link saveWorkflow} but refuses to overwrite an existing id. */
  async createWorkflow(workflow: Workflow, ui: UiLayout | undefined, destRoot: string): Promise<string> {
    if ((await this.pathsFor(workflow.id)).length > 0) {
      throw new Error(`workflow '${workflow.id}' already exists`);
    }
    return this.saveWorkflow(workflow, ui, destRoot);
  }

  /** Delete every spec file for `id`. Returns whether anything was removed. */
  async deleteSpec(id: string): Promise<boolean> {
    const paths = await this.pathsFor(id);
    await Promise.all(paths.map((p) => unlink(p).catch(() => undefined)));
    return paths.length > 0;
  }

  private async pathsFor(id: string): Promise<string[]> {
    return (await this.list()).filter((s) => s.id === id).map((s) => s.path);
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

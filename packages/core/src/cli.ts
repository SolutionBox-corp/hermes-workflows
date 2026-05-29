#!/usr/bin/env bun
/**
 * Hermes Workflows core CLI: a thin JSON-in/JSON-out surface over the engine.
 * Invoked by the Python orchestrator (via cli_bridge) for pure decisions and
 * run-state persistence. Prints one JSON document to stdout; errors go to
 * stderr with a non-zero exit.
 */

import type { RunState } from "./schema/run.ts";
import {
  cmdValidate,
  cmdCompilePreview,
  cmdExplain,
  cmdAdvance,
  cmdRunCreate,
  cmdRunLoad,
  cmdRunSave,
  cmdRunList,
} from "./cli/commands.ts";

interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      flags._.push(token);
    }
  }
  return flags;
}

function str(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

async function readRunFile(path: string): Promise<RunState> {
  return JSON.parse(await Bun.file(path).text()) as RunState;
}

async function dispatch(command: string | undefined, flags: Flags): Promise<unknown> {
  const spec = flags._[0];
  const db = str(flags, "db") ?? "";

  switch (command) {
    case "validate":
      return cmdValidate(requireSpec(spec));
    case "compile-preview":
      return cmdCompilePreview(requireSpec(spec));
    case "explain":
      return cmdExplain(requireSpec(spec));
    case "advance":
      return cmdAdvance(requireSpec(spec), await readRunFile(required(str(flags, "run-file"), "--run-file")));
    case "run-create":
      return cmdRunCreate(required(db, "--db"), requireSpec(spec), required(str(flags, "id"), "--id"), str(flags, "project"));
    case "run-load":
      return cmdRunLoad(required(db, "--db"), required(str(flags, "id"), "--id"));
    case "run-save":
      cmdRunSave(required(db, "--db"), await readRunFile(required(str(flags, "run-file"), "--run-file")));
      return { ok: true };
    case "run-list":
      return cmdRunList(required(db, "--db"), flags["active"] === true);
    default:
      throw new Error(`unknown command: ${command ?? "(none)"}`);
  }
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`missing required argument ${name}`);
  return value;
}

function requireSpec(spec: string | undefined): string {
  return required(spec, "<spec path>");
}

async function main(): Promise<number> {
  const [command, ...rest] = Bun.argv.slice(2);
  try {
    const result = await dispatch(command, parseFlags(rest));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
}

process.exit(await main());

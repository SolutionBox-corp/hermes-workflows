import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "../src/cli.ts");
const example = join(import.meta.dir, "../../../examples/feature-development.workflow.yaml");

async function run(args: string[]): Promise<{ code: number; json: unknown }> {
  const proc = Bun.spawn(["bun", "run", cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, json: out.trim() ? JSON.parse(out) : null };
}

describe("cli.ts dispatcher", () => {
  test("validate prints a JSON result and exits 0", async () => {
    const { code, json } = await run(["validate", example]);
    expect(code).toBe(0);
    expect((json as { valid: boolean }).valid).toBe(true);
  });

  test("explain prints the workflow summary", async () => {
    const { json } = await run(["explain", example]);
    expect((json as { id: string }).id).toBe("feature-development");
  });

  test("an unknown command exits non-zero", async () => {
    const { code } = await run(["frobnicate"]);
    expect(code).not.toBe(0);
  });

  test("run-load without --db fails instead of silently using a throwaway db", async () => {
    const { code } = await run(["run-load", "--id", "x"]);
    expect(code).not.toBe(0);
  });
});

describe("cli.ts dispatcher — spec write round trip", () => {
  let base: string;
  let globalRoot: string;
  let specFile: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "hw-dispatch-"));
    globalRoot = join(base, "global");
    specFile = join(base, "spec.json");
    await writeFile(
      specFile,
      JSON.stringify({
        id: "argv-made",
        name: "Argv Made",
        version: 1,
        scope: { type: "global" },
        trigger: { type: "manual" },
        nodes: [{ id: "done", type: "finish" }],
        edges: [],
        ui: { xyflow: { viewport: { x: 0, y: 0, zoom: 1 } } },
      }),
    );
  });
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  test("spec-save then spec-get round-trips through argv", async () => {
    const saved = await run([
      "spec-save",
      "--roots",
      globalRoot,
      "--global-root",
      globalRoot,
      "--spec-file",
      specFile,
    ]);
    expect(saved.code).toBe(0);
    expect((saved.json as { path: string }).path.endsWith("argv-made.workflow.yaml")).toBe(true);

    const got = await run(["spec-get", "--roots", globalRoot, "--id", "argv-made"]);
    expect((got.json as { workflow: { name: string } }).workflow.name).toBe("Argv Made");
    expect((got.json as { ui: unknown }).ui).toEqual({ xyflow: { viewport: { x: 0, y: 0, zoom: 1 } } });
  });
});

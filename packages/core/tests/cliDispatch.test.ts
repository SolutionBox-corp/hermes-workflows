import { describe, expect, test } from "bun:test";
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

import { join } from "node:path";

import { parseWorkflow } from "../src/index.ts";
import type { LoadResult } from "../src/index.ts";

const examplesDir = join(import.meta.dir, "../../../examples");

export async function loadExample(name: string): Promise<LoadResult> {
  const text = await Bun.file(join(examplesDir, name)).text();
  return parseWorkflow(text);
}

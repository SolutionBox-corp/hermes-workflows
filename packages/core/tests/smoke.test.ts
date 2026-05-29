import { expect, test } from "bun:test";

import { CORE_VERSION } from "../src/index.ts";

test("core exposes its version", () => {
  expect(CORE_VERSION).toBe("0.1.0");
});

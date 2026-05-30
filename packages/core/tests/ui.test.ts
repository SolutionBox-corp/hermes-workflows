import { describe, expect, test } from "bun:test";

import { fromObject } from "../src/index.ts";
import type { UiLayout } from "../src/index.ts";

const base = {
  id: "x",
  name: "X",
  version: 1,
  scope: { type: "global" },
  trigger: { type: "manual" },
  nodes: [{ id: "done", type: "finish" }],
  edges: [],
};

describe("ui layout parsing", () => {
  test("parses xyflow node positions and viewport into a typed layout", () => {
    const { ui } = fromObject({
      ...base,
      ui: {
        xyflow: {
          nodes: [{ id: "done", x: 100, y: 200 }],
          viewport: { x: 1, y: 2, zoom: 1.5 },
        },
      },
    });
    const layout = ui as UiLayout;
    expect(layout.xyflow?.nodes).toEqual([{ id: "done", x: 100, y: 200 }]);
    expect(layout.xyflow?.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 });
  });

  test("drops malformed node entries leniently", () => {
    const { ui } = fromObject({
      ...base,
      ui: {
        xyflow: {
          nodes: [{ id: "done", x: 1, y: 2 }, { id: "bad" }, { x: 5, y: 6 }, "nonsense"],
        },
      },
    });
    expect((ui as UiLayout).xyflow?.nodes).toEqual([{ id: "done", x: 1, y: 2 }]);
  });

  test("absent ui yields undefined", () => {
    expect(fromObject(base).ui).toBeUndefined();
  });

  test("a non-mapping ui is dropped, not thrown", () => {
    expect(fromObject({ ...base, ui: "garbage" }).ui).toBeUndefined();
  });

  test("ignores unknown keys inside ui", () => {
    const { ui } = fromObject({
      ...base,
      ui: { xyflow: { viewport: { x: 0, y: 0, zoom: 1 } }, extra: 9 },
    });
    expect(ui).toEqual({ xyflow: { viewport: { x: 0, y: 0, zoom: 1 } } });
  });
});

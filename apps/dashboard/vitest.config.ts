import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;

// Standalone test config. Deliberately does NOT alias `react` to the host shim:
// tests run against the real React from node_modules. The shim only applies in
// the production build (vite.config.ts), which the bundle-load test exercises by
// building and evaluating the artifact, not by importing source through Vitest.
//
// The `@hermes-workflows/core/*` alias lets tests import the core's PURE modules
// (validation, schema, graph helpers) as real runtime values — used to assert a
// seeded spec actually passes the canonical validator rather than a copy of it.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@hermes-workflows\/core\/(.*)$/,
        replacement: resolve(here, "../../packages/core/src/$1"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});

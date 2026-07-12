import { defineConfig } from "vitest/config";

// Root Vitest config. Each package's tests run in the Node environment against
// an in-process PGlite database (real Postgres in WASM — RLS actually applies),
// so no external database server is required for the foundation test suites.
export default defineConfig({
  test: {
    environment: "node",
    include: ["casper-*/src/**/*.test.ts"],
    globals: false,
    pool: "forks",
  },
});

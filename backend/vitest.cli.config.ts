import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // CLI tests live in the parent repo's cli/tests/ directory
    // Path is relative to the backend/ directory (one level up = repo root)
    include: ["../cli/tests/**/*.test.ts"],
    testTimeout: 10000,
  },
});

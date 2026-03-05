import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/acceptance/**/*.acceptance.test.ts"],
    testTimeout: 30000, // acceptance tests may be slower
  },
});

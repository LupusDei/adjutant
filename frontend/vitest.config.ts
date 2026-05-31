import { cpus } from "node:os";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Cap the worker pool so concurrent agent test runs don't oversubscribe the CPU
 * and grind the machine. ~1/4 of cores (min 2); override with VITEST_MAX_WORKERS.
 * See backend/vitest.config.ts for the rationale.
 */
const MAX_WORKERS = process.env["VITEST_MAX_WORKERS"]
  ? Math.max(1, Number(process.env["VITEST_MAX_WORKERS"]))
  : Math.max(2, Math.floor(cpus().length / 4));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    maxWorkers: MAX_WORKERS,
    minWorkers: 1,
    poolOptions: {
      forks: { maxForks: MAX_WORKERS, minForks: 1 },
      threads: { maxThreads: MAX_WORKERS, minThreads: 1 },
    },
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/main.tsx", "src/vite-env.d.ts"],
      thresholds: {
        lines: 75,
        branches: 65,
        functions: 55,
      },
    },
    testTimeout: 10000,
  },
});

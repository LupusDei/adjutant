import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * Cap the worker pool so multiple agents running tests concurrently don't
 * oversubscribe the CPU and grind the machine to a halt. Vitest defaults to
 * ~one worker per core, so N concurrent runs = N*cores workers. We bound each
 * run to ~1/4 of the cores (min 2); N concurrent runs then stay near the core
 * count instead of N*cores. Override with VITEST_MAX_WORKERS (e.g. =1 to be
 * maximally polite during a big swarm, or higher for a fast solo run).
 */
const MAX_WORKERS = process.env["VITEST_MAX_WORKERS"]
  ? Math.max(1, Number(process.env["VITEST_MAX_WORKERS"]))
  : Math.max(2, Math.floor(cpus().length / 4));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    maxWorkers: MAX_WORKERS,
    minWorkers: 1,
    poolOptions: {
      forks: { maxForks: MAX_WORKERS, minForks: 1 },
      threads: { maxThreads: MAX_WORKERS, minThreads: 1 },
    },
    // Suppress migration log spam during tests (20K+ lines of noise)
    env: {
      BACKEND_LOG_LEVEL: "warn",
    },
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/acceptance/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/types/**"],
      thresholds: {
        lines: 75,
        branches: 65,
        functions: 55,
      },
    },
    testTimeout: 10000,
  },
});

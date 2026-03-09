import { describe, it, expect } from "vitest";

import { parseArgs } from "../../src/acceptance/cli.js";
import {
  analyzeTestFile,
  scanSpecCoverage,
  formatCoverageReport,
} from "../../src/acceptance/reporter.js";
import type { SpecCoverageEntry } from "../../src/acceptance/reporter.js";

// ============================================================================
// Tests — --report flag parsing
// ============================================================================

describe("CoverageReport", () => {
  describe("parseArgs --report flag", () => {
    it("should parse --report flag", () => {
      const opts = parseArgs(["node", "cli.ts", "--report"]);
      expect(opts.report).toBe(true);
    });

    it("should not default to --run when --report is set", () => {
      const opts = parseArgs(["node", "cli.ts", "--report"]);
      expect(opts.run).toBeFalsy();
    });

    it("should combine --report with --verbose", () => {
      const opts = parseArgs(["node", "cli.ts", "--report", "--verbose"]);
      expect(opts.report).toBe(true);
      expect(opts.verbose).toBe(true);
    });
  });

  // ============================================================================
  // Tests — analyzeTestFile (counting exec/skip/todo)
  // ============================================================================

  describe("analyzeTestFile", () => {
    it("should count executable it() blocks", () => {
      const content = `
        it("should do thing one", async () => {
          expect(1).toBe(1);
        });
        it("should do thing two", async () => {
          expect(2).toBe(2);
        });
      `;
      const result = analyzeTestFile(content);
      expect(result.executable).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.todo).toBe(0);
    });

    it("should count it.skip() blocks as skipped", () => {
      const content = `
        it.skip("should be skipped", () => {
          // Requires browser
        });
        it("should work", async () => {
          expect(1).toBe(1);
        });
      `;
      const result = analyzeTestFile(content);
      expect(result.executable).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it("should count it() blocks with TODO comment as todo", () => {
      const content = `
        it("should do something", async () => {
          // TODO: implement step definitions
          // Given something
        });
      `;
      const result = analyzeTestFile(content);
      expect(result.executable).toBe(0);
      expect(result.todo).toBe(1);
    });

    it("should handle mixed content", () => {
      const content = `
        it("should work", async () => {
          expect(1).toBe(1);
        });
        it.skip("should be skipped", () => {
          // UI only
        });
        it("should be todo", async () => {
          // TODO: implement step definitions
        });
        it.skip("also skipped", () => {
          // Agent behavior
        });
      `;
      const result = analyzeTestFile(content);
      expect(result.executable).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.todo).toBe(1);
    });

    it("should return zeros for empty content", () => {
      const result = analyzeTestFile("");
      expect(result.executable).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.todo).toBe(0);
    });
  });

  // ============================================================================
  // Tests — formatCoverageReport
  // ============================================================================

  describe("formatCoverageReport", () => {
    it("should include header", () => {
      const entries: SpecCoverageEntry[] = [];
      const output = formatCoverageReport(entries);
      expect(output).toContain("ACCEPTANCE SPEC COVERAGE");
    });

    it("should display spec entry with counts", () => {
      const entries: SpecCoverageEntry[] = [
        {
          specName: "017-agent-proposals",
          totalScenarios: 18,
          executable: 4,
          skipped: 14,
          todo: 0,
          hasTests: true,
        },
      ];
      const output = formatCoverageReport(entries);
      expect(output).toContain("017-agent-proposals");
      expect(output).toContain("4 exec");
      expect(output).toContain("14 skip");
      expect(output).toContain("0 todo");
      expect(output).toContain("generated");
    });

    it("should show 'no tests' for specs without test files", () => {
      const entries: SpecCoverageEntry[] = [
        {
          specName: "008-agent-mcp-bridge",
          totalScenarios: 5,
          executable: 0,
          skipped: 0,
          todo: 0,
          hasTests: false,
        },
      ];
      const output = formatCoverageReport(entries);
      expect(output).toContain("008-agent-mcp-bridge");
      expect(output).toContain("no tests");
    });

    it("should show summary footer with totals", () => {
      const entries: SpecCoverageEntry[] = [
        {
          specName: "017-agent-proposals",
          totalScenarios: 18,
          executable: 4,
          skipped: 14,
          todo: 0,
          hasTests: true,
        },
        {
          specName: "008-agent-mcp-bridge",
          totalScenarios: 5,
          executable: 0,
          skipped: 0,
          todo: 0,
          hasTests: false,
        },
      ];
      const output = formatCoverageReport(entries);
      // 1 of 2 specs covered
      expect(output).toContain("1/2 specs covered");
      expect(output).toContain("4 executable");
      expect(output).toContain("14 skipped");
      expect(output).toContain("0 TODO");
    });

    it("should draw box borders", () => {
      const entries: SpecCoverageEntry[] = [];
      const output = formatCoverageReport(entries);
      expect(output).toContain("\u2554"); // top-left
      expect(output).toContain("\u2557"); // top-right
      expect(output).toContain("\u255A"); // bottom-left
      expect(output).toContain("\u255D"); // bottom-right
    });
  });
});

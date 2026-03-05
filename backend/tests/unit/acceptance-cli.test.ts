import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { parseArgs } from "../../src/acceptance/cli.js";
import { generateTestContent, generateTestFiles } from "../../src/acceptance/test-generator.js";
import { formatReport, countResults } from "../../src/acceptance/reporter.js";
import type { ParseResult } from "../../src/acceptance/types.js";
import type { AcceptanceReport } from "../../src/acceptance/reporter.js";

// ============================================================================
// Test fixtures
// ============================================================================

const SAMPLE_SPEC = `# Feature Specification: Test Feature

## User Scenarios & Testing

### User Story 1 - Basic CRUD (Priority: P1)

Basic operations.

**Acceptance Scenarios**:

1. **Given** the database is initialized, **When** a record is created via POST /api/items, **Then** it is persisted with a generated ID
2. **Given** records exist, **When** GET /api/items is called, **Then** all records are returned

---

### User Story 2 - Filtering (Priority: P2)

Filter support.

**Acceptance Scenarios**:

1. **Given** items with different statuses, **When** GET /api/items?status=active is called, **Then** only active items are returned
`;

const SAMPLE_PARSE_RESULT: ParseResult = {
  specPath: "specs/099-test/spec.md",
  featureName: "Test Feature",
  userStories: [
    {
      title: "Basic CRUD",
      storyNumber: 1,
      priority: "P1",
      scenarios: [
        {
          index: 1,
          given: "the database is initialized",
          when: "a record is created via POST /api/items",
          then: "it is persisted with a generated ID",
          raw: "**Given** the database is initialized, **When** a record is created via POST /api/items, **Then** it is persisted with a generated ID",
        },
        {
          index: 2,
          given: "records exist",
          when: "GET /api/items is called",
          then: "all records are returned",
          raw: "**Given** records exist, **When** GET /api/items is called, **Then** all records are returned",
        },
      ],
      requirementIds: [],
    },
  ],
  requirements: [],
  edgeCases: [],
  warnings: [],
};

const SAMPLE_REPORT: AcceptanceReport = {
  featureName: "Test Feature",
  stories: [
    {
      label: "US1 - Basic CRUD (P1)",
      scenarios: [
        { description: "should persist with generated ID", status: "passed" },
        { description: "should return all records", status: "passed" },
      ],
    },
    {
      label: "US2 - Filtering (P2)",
      scenarios: [
        { description: "should return only active items", status: "failed", error: "Expected 200, received 404" },
        { description: "should support pagination", status: "pending" },
      ],
    },
  ],
};

// ============================================================================
// Tests — CLI Arg Parsing
// ============================================================================

describe("AcceptanceCLI", () => {
  describe("parseArgs", () => {
    it("should parse spec-dir as positional argument", () => {
      const opts = parseArgs(["node", "cli.ts", "specs/017-agent-proposals"]);
      expect(opts.specDir).toBe("specs/017-agent-proposals");
    });

    it("should parse --generate flag", () => {
      const opts = parseArgs(["node", "cli.ts", "specs/017", "--generate"]);
      expect(opts.generate).toBe(true);
    });

    it("should parse --run flag", () => {
      const opts = parseArgs(["node", "cli.ts", "--run"]);
      expect(opts.run).toBe(true);
    });

    it("should parse --verbose flag", () => {
      const opts = parseArgs(["node", "cli.ts", "--verbose"]);
      expect(opts.verbose).toBe(true);
    });

    it("should default to --run when no flags given", () => {
      const opts = parseArgs(["node", "cli.ts"]);
      expect(opts.run).toBe(true);
      expect(opts.generate).toBe(false);
    });

    it("should handle multiple flags together", () => {
      const opts = parseArgs([
        "node",
        "cli.ts",
        "specs/017",
        "--generate",
        "--verbose",
      ]);
      expect(opts.specDir).toBe("specs/017");
      expect(opts.generate).toBe(true);
      expect(opts.verbose).toBe(true);
    });

    it("should handle flags before positional arg", () => {
      const opts = parseArgs([
        "node",
        "cli.ts",
        "--generate",
        "specs/017",
      ]);
      expect(opts.specDir).toBe("specs/017");
      expect(opts.generate).toBe(true);
    });
  });

  // ============================================================================
  // Tests — Generate Mode (file I/O)
  // ============================================================================

  describe("generateTestFiles", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "acceptance-cli-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should create test files in the output directory", async () => {
      const files = await generateTestFiles(SAMPLE_PARSE_RESULT, {
        outputDir: tmpDir,
      });

      expect(files).toHaveLength(1);
      expect(existsSync(files[0]!)).toBe(true);
    });

    it("should generate file with correct kebab-case name", async () => {
      const files = await generateTestFiles(SAMPLE_PARSE_RESULT, {
        outputDir: tmpDir,
      });

      expect(files[0]).toContain("test-feature.acceptance.test.ts");
    });

    it("should produce valid TypeScript content in generated file", async () => {
      const files = await generateTestFiles(SAMPLE_PARSE_RESULT, {
        outputDir: tmpDir,
      });

      const content = readFileSync(files[0]!, "utf-8");

      // Should contain valid vitest imports
      expect(content).toContain('import { describe, it, expect');
      // Should contain describe/it blocks
      expect(content).toContain('describe("Acceptance: Test Feature"');
      expect(content).toContain('describe("US1 - Basic CRUD (P1)"');
      // Should contain scenario test blocks
      expect(content).toMatch(/it\("should .+"/);
    });
  });

  // ============================================================================
  // Tests — Reporter
  // ============================================================================

  describe("Reporter", () => {
    it("should format report with correct pass/fail/pending counts", () => {
      const output = formatReport(SAMPLE_REPORT);

      expect(output).toContain("ACCEPTANCE TESTS: Test Feature");
      expect(output).toContain("2 passed");
      expect(output).toContain("1 failed");
      expect(output).toContain("1 pending");
    });

    it("should show pass symbol for passing tests", () => {
      const output = formatReport(SAMPLE_REPORT);

      // Checkmark before passing test descriptions
      expect(output).toContain("\u2713 should persist with generated ID");
      expect(output).toContain("\u2713 should return all records");
    });

    it("should show fail symbol and error for failing tests", () => {
      const output = formatReport(SAMPLE_REPORT);

      expect(output).toContain("\u2717 should return only active items");
      expect(output).toContain("\u2192 Expected 200, received 404");
    });

    it("should show pending symbol for pending tests", () => {
      const output = formatReport(SAMPLE_REPORT);

      expect(output).toContain("\u25CB should support pagination");
    });

    it("should include story labels", () => {
      const output = formatReport(SAMPLE_REPORT);

      expect(output).toContain("US1 - Basic CRUD (P1)");
      expect(output).toContain("US2 - Filtering (P2)");
    });

    it("should draw box borders", () => {
      const output = formatReport(SAMPLE_REPORT);

      // Unicode box drawing characters
      expect(output).toContain("\u2554"); // top-left corner
      expect(output).toContain("\u2557"); // top-right corner
      expect(output).toContain("\u255A"); // bottom-left corner
      expect(output).toContain("\u255D"); // bottom-right corner
    });

    it("should count results correctly", () => {
      const { passed, failed, pending } = countResults(SAMPLE_REPORT);

      expect(passed).toBe(2);
      expect(failed).toBe(1);
      expect(pending).toBe(1);
    });

    it("should handle empty report", () => {
      const emptyReport: AcceptanceReport = {
        featureName: "Empty",
        stories: [],
      };

      const output = formatReport(emptyReport);
      expect(output).toContain("ACCEPTANCE TESTS: Empty");
      expect(output).toContain("0 passed");
      expect(output).toContain("0 failed");
      expect(output).toContain("0 pending");
    });
  });
});

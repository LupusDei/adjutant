/**
 * Acceptance Test Reporter — Formats test results grouped by User Story.
 *
 * Takes structured test results and produces a terminal-friendly report
 * with pass/fail/pending counts and per-story breakdown.
 *
 * Also provides spec coverage analysis: scanning specs for GWT scenarios
 * and checking which have generated test files with executable/skipped/TODO counts.
 *
 * @module acceptance/reporter
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";

import { parseSpecContent } from "./spec-parser.js";
import { generateFileName } from "./test-generator.js";

// ============================================================================
// Types
// ============================================================================

/** Status of a single test scenario */
export type ScenarioStatus = "passed" | "failed" | "pending";

/** Result of a single test scenario */
export interface ScenarioResult {
  /** Test description (from the `it` block) */
  description: string;
  /** Pass/fail/pending status */
  status: ScenarioStatus;
  /** Error message if failed */
  error?: string;
}

/** Results grouped by user story */
export interface StoryResult {
  /** Story label, e.g. "US1 - Data Model & Backend API (P1)" */
  label: string;
  /** Scenario results within this story */
  scenarios: ScenarioResult[];
}

/** Full acceptance test report */
export interface AcceptanceReport {
  /** Feature name, e.g. "Agent Proposals System" */
  featureName: string;
  /** Results by user story */
  stories: StoryResult[];
}

// ============================================================================
// Formatting Constants
// ============================================================================

const BOX_WIDTH = 52;
const PASS_SYMBOL = "\u2713"; // checkmark
const FAIL_SYMBOL = "\u2717"; // x-mark
const PENDING_SYMBOL = "\u25CB"; // open circle

// ============================================================================
// Public API
// ============================================================================

/**
 * Format an acceptance report as a terminal-friendly string.
 */
export function formatReport(report: AcceptanceReport): string {
  const lines: string[] = [];

  // Top border
  lines.push(`\u2554${"=".repeat(BOX_WIDTH)}\u2557`);
  lines.push(
    `\u2551  ACCEPTANCE TESTS: ${padRight(report.featureName, BOX_WIDTH - 22)}\u2551`
  );
  lines.push(`\u2560${"=".repeat(BOX_WIDTH)}\u2563`);
  lines.push("");

  // Story results
  for (const story of report.stories) {
    lines.push(`  ${story.label}`);

    for (const scenario of story.scenarios) {
      const symbol = getSymbol(scenario.status);
      lines.push(`    ${symbol} ${scenario.description}`);

      if (scenario.status === "failed" && scenario.error) {
        lines.push(`      \u2192 ${scenario.error}`);
      }

      if (scenario.status === "pending") {
        // No extra line needed — the symbol says it all
      }
    }

    lines.push("");
  }

  // Summary
  const { passed, failed, pending } = countResults(report);
  const summaryText = `${passed} passed \u2502 ${failed} failed \u2502 ${pending} pending`;

  lines.push(`\u2560${"=".repeat(BOX_WIDTH)}\u2563`);
  lines.push(
    `\u2551  ${padRight(summaryText, BOX_WIDTH - 3)}\u2551`
  );
  lines.push(`\u255A${"=".repeat(BOX_WIDTH)}\u255D`);

  return lines.join("\n");
}

/**
 * Count pass/fail/pending totals from a report.
 */
export function countResults(report: AcceptanceReport): {
  passed: number;
  failed: number;
  pending: number;
} {
  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const story of report.stories) {
    for (const scenario of story.scenarios) {
      switch (scenario.status) {
        case "passed":
          passed++;
          break;
        case "failed":
          failed++;
          break;
        case "pending":
          pending++;
          break;
      }
    }
  }

  return { passed, failed, pending };
}

// ============================================================================
// Helpers
// ============================================================================

/** Get the terminal symbol for a scenario status */
function getSymbol(status: ScenarioStatus): string {
  switch (status) {
    case "passed":
      return PASS_SYMBOL;
    case "failed":
      return FAIL_SYMBOL;
    case "pending":
      return PENDING_SYMBOL;
  }
}

/** Pad a string to a fixed width. If too long, truncate with ellipsis to preserve box alignment. */
function padRight(s: string, width: number): string {
  if (width <= 0) return s;
  if (s.length > width) {
    return width > 3 ? s.slice(0, width - 3) + "..." : s.slice(0, width);
  }
  return s + " ".repeat(width - s.length);
}

// ============================================================================
// Spec Coverage Report Types
// ============================================================================

/** Analysis result for a single test file */
export interface TestFileAnalysis {
  executable: number;
  skipped: number;
  todo: number;
}

/** Coverage data for one spec */
export interface SpecCoverageEntry {
  /** Spec directory name, e.g. "017-agent-proposals" */
  specName: string;
  /** Total GWT scenarios in the spec.md */
  totalScenarios: number;
  /** Count of executable it() blocks (no skip, no TODO) */
  executable: number;
  /** Count of it.skip() blocks */
  skipped: number;
  /** Count of it() blocks containing TODO */
  todo: number;
  /** Whether a generated test file exists */
  hasTests: boolean;
}

// ============================================================================
// Coverage Report — Constants
// ============================================================================

const COVERAGE_BOX_WIDTH = 62;

// ============================================================================
// Coverage Report — Public API
// ============================================================================

/**
 * Analyze a test file's content to count executable, skipped, and TODO test blocks.
 *
 * - `it.skip(` counts as skipped
 * - `it(` containing `// TODO` in its body counts as TODO
 * - `it(` without skip and without TODO counts as executable
 */
export function analyzeTestFile(content: string): TestFileAnalysis {
  let executable = 0;
  let skipped = 0;
  let todo = 0;

  // Split into lines for stateful parsing
  const lines = content.split("\n");
  let inItBlock = false;
  let currentBlockIsSkip = false;
  let currentBlockHasTodo = false;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of it.skip(
    if (!inItBlock && /it\.skip\s*\(/.test(trimmed)) {
      skipped++;
      // We don't need to track interior — just count and move on
      // But we need to handle multi-line blocks for brace tracking
      inItBlock = true;
      currentBlockIsSkip = true;
      currentBlockHasTodo = false;
      braceDepth = countBraces(trimmed);
      if (braceDepth <= 0) {
        inItBlock = false;
        currentBlockIsSkip = false;
      }
      continue;
    }

    // Detect start of it(
    if (!inItBlock && /it\s*\(/.test(trimmed) && !trimmed.includes('it.skip')) {
      inItBlock = true;
      currentBlockIsSkip = false;
      currentBlockHasTodo = false;
      braceDepth = countBraces(trimmed);
      // Check this first line for TODO
      if (/\/\/\s*TODO/.test(trimmed)) {
        currentBlockHasTodo = true;
      }
      if (braceDepth <= 0) {
        // Block closed on same line
        if (currentBlockHasTodo) {
          todo++;
        } else {
          executable++;
        }
        inItBlock = false;
      }
      continue;
    }

    // Inside an it() block — track braces and TODO
    if (inItBlock) {
      braceDepth += countBraces(trimmed);
      if (!currentBlockIsSkip && /\/\/\s*TODO/.test(trimmed)) {
        currentBlockHasTodo = true;
      }
      if (braceDepth <= 0) {
        // Block closed
        if (!currentBlockIsSkip) {
          if (currentBlockHasTodo) {
            todo++;
          } else {
            executable++;
          }
        }
        inItBlock = false;
        currentBlockIsSkip = false;
        currentBlockHasTodo = false;
      }
    }
  }

  return { executable, skipped, todo };
}

/**
 * Scan specs directory and acceptance test directory to build coverage entries.
 *
 * @param specsDir - Path to the specs/ directory containing spec folders
 * @param testsDir - Path to the backend/tests/acceptance/ directory
 * @returns Array of coverage entries, one per spec with GWT scenarios
 */
export function scanSpecCoverage(
  specsDir: string,
  testsDir: string
): SpecCoverageEntry[] {
  const entries: SpecCoverageEntry[] = [];

  if (!existsSync(specsDir)) {
    return entries;
  }

  const specFolders = readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const folder of specFolders) {
    const specPath = resolve(specsDir, folder, "spec.md");
    if (!existsSync(specPath)) {
      continue;
    }

    const specContent = readFileSync(specPath, "utf-8");
    const parsed = parseSpecContent(specContent, specPath);

    // Count total GWT scenarios
    const totalScenarios = parsed.userStories.reduce(
      (sum, s) => sum + s.scenarios.length,
      0
    );

    // Only include specs that have GWT scenarios
    if (totalScenarios === 0) {
      continue;
    }

    // Check for generated test file
    const testFileName = generateFileName(parsed.featureName);
    const testFilePath = resolve(testsDir, testFileName);
    const hasTests = existsSync(testFilePath);

    let analysis: TestFileAnalysis = { executable: 0, skipped: 0, todo: 0 };
    if (hasTests) {
      const testContent = readFileSync(testFilePath, "utf-8");
      analysis = analyzeTestFile(testContent);
    }

    entries.push({
      specName: folder,
      totalScenarios,
      executable: analysis.executable,
      skipped: analysis.skipped,
      todo: analysis.todo,
      hasTests,
    });
  }

  return entries;
}

/**
 * Format coverage entries into a terminal-friendly table.
 */
export function formatCoverageReport(entries: SpecCoverageEntry[]): string {
  const lines: string[] = [];
  const W = COVERAGE_BOX_WIDTH;

  // Top border
  lines.push(`\u2554${"=".repeat(W)}\u2557`);
  lines.push(
    `\u2551  ${padRight("ACCEPTANCE SPEC COVERAGE", W - 3)}\u2551`
  );
  lines.push(`\u2560${"=".repeat(W)}\u2563`);

  if (entries.length === 0) {
    lines.push(`  (no specs with GWT scenarios found)`);
  }

  // Entry rows
  for (const entry of entries) {
    const status = entry.hasTests ? "\u2713 generated" : "\u2717 no tests";
    const counts = `${String(entry.executable).padStart(2)} exec \u2502 ${String(entry.skipped).padStart(2)} skip \u2502 ${String(entry.todo).padStart(2)} todo`;
    const row = `  ${padRight(entry.specName, 28)} ${counts} \u2502 ${status}`;
    lines.push(row);
  }

  // Summary footer
  const coveredCount = entries.filter((e) => e.hasTests).length;
  const totalExec = entries.reduce((s, e) => s + e.executable, 0);
  const totalSkip = entries.reduce((s, e) => s + e.skipped, 0);
  const totalTodo = entries.reduce((s, e) => s + e.todo, 0);

  const summary = `${coveredCount}/${entries.length} specs covered \u2502 ${totalExec} executable \u2502 ${totalSkip} skipped \u2502 ${totalTodo} TODO`;

  lines.push(`\u2560${"=".repeat(W)}\u2563`);
  lines.push(`\u2551  ${padRight(summary, W - 3)}\u2551`);
  lines.push(`\u255A${"=".repeat(W)}\u255D`);

  return lines.join("\n");
}

// ============================================================================
// Coverage Report — Helpers
// ============================================================================

/** Count net brace depth change in a line ({  = +1, } = -1) */
function countBraces(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

/**
 * Acceptance Test Reporter — Formats test results grouped by User Story.
 *
 * Takes structured test results and produces a terminal-friendly report
 * with pass/fail/pending counts and per-story breakdown.
 *
 * @module acceptance/reporter
 */

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

/** Pad a string to a fixed width, truncating if needed */
function padRight(s: string, width: number): string {
  if (s.length >= width) {
    return s.slice(0, width);
  }
  return s + " ".repeat(width - s.length);
}

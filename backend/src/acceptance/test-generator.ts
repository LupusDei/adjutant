/**
 * Test File Generator — Generates Vitest acceptance test files from parsed specs.
 *
 * Takes a ParseResult (from the spec parser) and generates a `.test.ts` file
 * that developers can fill in with step implementations.
 *
 * @module acceptance/test-generator
 */

import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";

import type { ParseResult, Scenario } from "./types.js";

// ============================================================================
// Public Types
// ============================================================================

export interface GeneratorOptions {
  /** Output directory for generated test files */
  outputDir: string;
  /** Whether to overwrite existing test files */
  overwrite?: boolean;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate test file content from a parsed spec.
 *
 * Produces a string of TypeScript source code containing describe/it blocks
 * for each user story and scenario, with Given/When/Then comments.
 */
export function generateTestContent(parsed: ParseResult): string {
  const lines: string[] = [];

  // File header
  lines.push("/**");
  lines.push(` * Acceptance Tests: ${parsed.featureName}`);
  lines.push(` * Generated from: ${parsed.specPath}`);
  lines.push(" *");
  lines.push(
    " * DO NOT EDIT GENERATED STRUCTURE — add step implementations only."
  );
  lines.push(" */");

  // Imports
  lines.push(
    'import { describe, it, expect, beforeEach, afterEach } from "vitest";'
  );
  lines.push("");
  lines.push(
    'import { TestHarness } from "../../src/acceptance/test-harness.js";'
  );
  lines.push("");

  // Outer describe
  lines.push(`describe("Acceptance: ${parsed.featureName}", () => {`);
  lines.push("  let harness: TestHarness;");
  lines.push("");
  lines.push("  beforeEach(async () => {");
  lines.push("    harness = new TestHarness();");
  lines.push("    await harness.setup();");
  lines.push("  });");
  lines.push("");
  lines.push("  afterEach(async () => {");
  lines.push("    await harness.destroy();");
  lines.push("  });");

  // Track whether we've generated the first scenario (for example implementation)
  let isFirstScenario = true;

  for (const story of parsed.userStories) {
    lines.push("");
    lines.push(
      `  describe("US${story.storyNumber} - ${story.title} (${story.priority})", () => {`
    );

    for (const scenario of story.scenarios) {
      const itDescription = generateItDescription(scenario);
      lines.push(
        `    it("${escapeDoubleQuotes(itDescription)}", async () => {`
      );

      if (isFirstScenario) {
        // First scenario gets a working example skeleton
        generateExampleBody(lines, scenario);
        isFirstScenario = false;
      } else {
        // Subsequent scenarios get TODO stubs
        generateTodoBody(lines, scenario);
      }

      lines.push("    });");
      lines.push("");
    }

    lines.push("  });");
  }

  lines.push("});");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate and write test file(s) to disk.
 *
 * @returns Array of file paths that were written
 */
export async function generateTestFiles(
  parsed: ParseResult,
  options: GeneratorOptions
): Promise<string[]> {
  const content = generateTestContent(parsed);
  const fileName = generateFileName(parsed.featureName);
  const filePath = join(options.outputDir, fileName);

  // Ensure output directory exists
  await mkdir(dirname(filePath), { recursive: true });

  await writeFile(filePath, content, "utf-8");

  return [filePath];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a kebab-case file name from the feature name.
 *
 * @example "Agent Proposals System" -> "agent-proposals-system.acceptance.test.ts"
 */
export function generateFileName(featureName: string): string {
  const kebab = featureName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${kebab}.acceptance.test.ts`;
}

/**
 * Generate a meaningful `it` description from a scenario's Then clause.
 * Prefixes with "should" and truncates to ~80 chars.
 */
function generateItDescription(scenario: Scenario): string {
  const thenText = scenario.then.toLowerCase();
  // Remove leading articles for cleaner description
  const cleaned = thenText.replace(/^(it |they |the )/, "");
  const description = `should ${cleaned}`;

  // Truncate to ~80 chars at a word boundary
  if (description.length <= 80) {
    return description;
  }
  const truncated = description.slice(0, 77);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 40 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
}

/**
 * Generate the body of the first scenario with a working example skeleton.
 */
function generateExampleBody(lines: string[], scenario: Scenario): void {
  lines.push(`      // Given ${scenario.given}`);
  lines.push("      // (harness provides this automatically)");
  lines.push("");
  lines.push(`      // When ${scenario.when}`);
  lines.push("      // TODO: implement request using harness.request");
  lines.push("");
  lines.push(`      // Then ${scenario.then}`);
  lines.push("      // TODO: add assertions");
  lines.push("      expect(harness).toBeTruthy();");
}

/**
 * Generate a TODO stub body for subsequent scenarios.
 */
function generateTodoBody(lines: string[], scenario: Scenario): void {
  lines.push("      // TODO: implement step definitions");
  lines.push(`      // Given ${scenario.given}`);
  lines.push(`      // When ${scenario.when}`);
  lines.push(`      // Then ${scenario.then}`);
}

/**
 * Escape double quotes in a string for use inside a double-quoted JS string.
 */
function escapeDoubleQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

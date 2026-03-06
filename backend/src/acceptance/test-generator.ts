/**
 * Test File Generator — Generates Vitest acceptance test files from parsed specs.
 *
 * Takes a ParseResult (from the spec parser) and generates a `.test.ts` file
 * with smart code generation based on scenario classification:
 * - API-testable scenarios get inline supertest calls
 * - Step-matched scenarios get executeStep() calls
 * - UI-only and agent-behavior scenarios get it.skip()
 * - Unknown scenarios get TODO stubs
 *
 * @module acceptance/test-generator
 */

import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";

import type {
  ParseResult,
  Scenario,
  ScenarioClassification,
  DetectedApiCall,
  DetectedAssertion,
  DetectedPrecondition,
} from "./types.js";
import {
  classifyScenario,
  detectApiCall,
  detectAssertions,
  detectPrecondition,
} from "./pattern-detector.js";

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
 * for each user story and scenario. Uses pattern detection to generate
 * executable code instead of TODO stubs wherever possible.
 */
export function generateTestContent(parsed: ParseResult): string {
  // Pre-classify all scenarios to determine which imports are needed
  const classifications = new Map<Scenario, ScenarioClassification>();
  for (const story of parsed.userStories) {
    for (const scenario of story.scenarios) {
      classifications.set(scenario, classifyScenario(scenario));
    }
  }

  const hasStepMatched = [...classifications.values()].includes("step-matched");
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

  // Conditional imports for step-matched scenarios
  if (hasStepMatched) {
    lines.push(
      'import { executeStep } from "../../src/acceptance/step-registry.js";'
    );
    lines.push('import "../../src/acceptance/steps/common-steps.js";');
  }

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

  for (const story of parsed.userStories) {
    lines.push("");
    lines.push(
      `  describe("US${story.storyNumber} - ${story.title} (${story.priority})", () => {`
    );

    // Pre-compute it descriptions and deduplicate within the story
    const itDescriptions: string[] = [];
    for (const scenario of story.scenarios) {
      itDescriptions.push(generateItDescription(scenario));
    }
    const descCounts = new Map<string, number>();
    const descOccurrence = new Map<string, number>();
    for (const desc of itDescriptions) {
      descCounts.set(desc, (descCounts.get(desc) ?? 0) + 1);
    }
    for (let i = 0; i < itDescriptions.length; i++) {
      const desc = itDescriptions[i]!;
      if ((descCounts.get(desc) ?? 0) > 1) {
        const occ = (descOccurrence.get(desc) ?? 0) + 1;
        descOccurrence.set(desc, occ);
        itDescriptions[i] = `${desc} (scenario ${story.scenarios[i]!.index})`;
      }
    }

    for (let si = 0; si < story.scenarios.length; si++) {
      const scenario = story.scenarios[si]!;
      const itDescription = itDescriptions[si]!;
      const classification = classifications.get(scenario) ?? "unknown";

      generateScenarioBlock(lines, scenario, itDescription, classification);
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

  // Skip if file already exists and overwrite is not set
  if (existsSync(filePath) && !options.overwrite) {
    // eslint-disable-next-line no-console
    console.log(`Skipping ${filePath} (already exists, use --overwrite to replace)`);
    return [];
  }

  await writeFile(filePath, content, "utf-8");

  return [filePath];
}

// ============================================================================
// Scenario Block Generation
// ============================================================================

/**
 * Generate a complete it() or it.skip() block for a single scenario.
 */
function generateScenarioBlock(
  lines: string[],
  scenario: Scenario,
  itDescription: string,
  classification: ScenarioClassification
): void {
  switch (classification) {
    case "api-testable":
      generateApiTestableBlock(lines, scenario, itDescription);
      break;
    case "step-matched":
      generateStepMatchedBlock(lines, scenario, itDescription);
      break;
    case "ui-only":
      generateSkipBlock(lines, scenario, itDescription, "Requires browser — not API-testable");
      break;
    case "agent-behavior":
      generateSkipBlock(lines, scenario, itDescription, "Requires agent simulation — not API-testable");
      break;
    default:
      generateTodoBlock(lines, scenario, itDescription);
      break;
  }
}

/**
 * Generate an API-testable scenario with inline supertest calls.
 */
function generateApiTestableBlock(
  lines: string[],
  scenario: Scenario,
  itDescription: string
): void {
  const apiCall = detectApiCall(scenario.when);
  const assertions = detectAssertions(scenario.then);
  const precondition = detectPrecondition(scenario.given);

  lines.push(
    `    it("${escapeDoubleQuotes(itDescription)}", async () => {`
  );

  // Given clause
  lines.push(`      // Given ${scenario.given}`);
  generatePreconditionCode(lines, precondition);
  lines.push("");

  // When clause
  lines.push(`      // When ${scenario.when}`);
  const responseVar = generateApiCallCode(lines, apiCall, precondition);
  lines.push("");

  // Then clause
  lines.push(`      // Then ${scenario.then}`);
  generateAssertionCode(lines, assertions, responseVar);

  lines.push("    });");
  lines.push("");
}

/**
 * Generate a step-matched scenario with executeStep() calls.
 */
function generateStepMatchedBlock(
  lines: string[],
  scenario: Scenario,
  itDescription: string
): void {
  lines.push(
    `    it("${escapeDoubleQuotes(itDescription)}", async () => {`
  );

  lines.push(`      // Given ${scenario.given}`);
  lines.push(
    `      await executeStep("given", "${escapeDoubleQuotes(scenario.given)}", harness);`
  );
  lines.push("");

  lines.push(`      // When ${scenario.when}`);
  lines.push(
    `      await executeStep("when", "${escapeDoubleQuotes(scenario.when)}", harness);`
  );
  lines.push("");

  lines.push(`      // Then ${scenario.then}`);
  lines.push(
    `      await executeStep("then", "${escapeDoubleQuotes(scenario.then)}", harness);`
  );

  lines.push("    });");
  lines.push("");
}

/**
 * Generate a skipped scenario with reason comment.
 */
function generateSkipBlock(
  lines: string[],
  scenario: Scenario,
  itDescription: string,
  reason: string
): void {
  lines.push(
    `    it.skip("${escapeDoubleQuotes(itDescription)}", () => {`
  );
  lines.push(`      // ${reason}`);
  lines.push(`      // Given ${scenario.given}`);
  lines.push(`      // When ${scenario.when}`);
  lines.push(`      // Then ${scenario.then}`);
  lines.push("    });");
  lines.push("");
}

/**
 * Generate a TODO stub for unknown scenarios.
 */
function generateTodoBlock(
  lines: string[],
  scenario: Scenario,
  itDescription: string
): void {
  lines.push(
    `    it("${escapeDoubleQuotes(itDescription)}", async () => {`
  );
  lines.push("      // TODO: implement step definitions");
  lines.push(`      // Given ${scenario.given}`);
  lines.push(`      // When ${scenario.when}`);
  lines.push(`      // Then ${scenario.then}`);
  lines.push("    });");
  lines.push("");
}

// ============================================================================
// Code Generation Helpers
// ============================================================================

/**
 * Generate precondition/seed code from a DetectedPrecondition.
 */
function generatePreconditionCode(
  lines: string[],
  precondition: DetectedPrecondition
): void {
  switch (precondition.type) {
    case "database":
      lines.push("      // (harness provides this automatically)");
      break;
    case "proposal": {
      const status = precondition.params?.["status"] as string | undefined;
      lines.push("      const seeded = await harness.seedProposal({");
      lines.push('        author: "test-agent",');
      lines.push(`        title: "${status ? `${capitalize(status)} proposal` : "Test Proposal"}",`);
      lines.push('        description: "Seeded for testing",');
      lines.push('        type: "engineering",');
      lines.push('        project: "adjutant",');
      lines.push("      });");
      break;
    }
    case "message":
      lines.push("      await harness.seedMessage({");
      lines.push('        agentId: "test-agent",');
      lines.push('        role: "agent",');
      lines.push('        body: "Seeded message for testing",');
      lines.push("      });");
      break;
    case "agent":
      lines.push('      await harness.seedAgent({ agentId: "test-agent" });');
      break;
    case "none":
      lines.push("      // (no precondition needed)");
      break;
  }
}

/**
 * Generate the API call code from a DetectedApiCall.
 * Returns the variable name used for the response.
 */
function generateApiCallCode(
  lines: string[],
  apiCall: DetectedApiCall | null,
  precondition: DetectedPrecondition
): string {
  if (!apiCall) {
    lines.push("      // TODO: implement request");
    return "res";
  }

  const method = apiCall.method.toLowerCase();
  const path = resolvePath(apiCall.path, precondition);

  switch (apiCall.method) {
    case "POST":
      lines.push(`      const res = await harness.post("${path}", {`);
      if (apiCall.body) {
        for (const [key, value] of Object.entries(apiCall.body)) {
          lines.push(`        ${key}: ${JSON.stringify(value)},`);
        }
      } else {
        // Generate sensible defaults for POST bodies based on the path
        generateDefaultPostBody(lines, path);
      }
      lines.push("      });");
      break;

    case "GET":
      if (apiCall.query && Object.keys(apiCall.query).length > 0) {
        const queryEntries = Object.entries(apiCall.query)
          .map(([k, v]) => `${k}: "${v}"`)
          .join(", ");
        lines.push(
          `      const res = await harness.get("${path}", { ${queryEntries} });`
        );
      } else {
        lines.push(`      const res = await harness.get("${path}");`);
      }
      break;

    case "PATCH":
      if (apiCall.body) {
        const bodyStr = JSON.stringify(apiCall.body);
        lines.push(
          `      const res = await harness.patch("${path}", ${bodyStr});`
        );
      } else {
        lines.push(`      const res = await harness.${method}("${path}", {});`);
      }
      break;

    case "PUT":
      lines.push(`      const res = await harness.request.put("${path}").send({});`);
      break;

    case "DELETE":
      lines.push(`      const res = await harness.request.delete("${path}");`);
      break;
  }

  return "res";
}

/**
 * Generate expect() assertions from DetectedAssertions.
 */
function generateAssertionCode(
  lines: string[],
  assertions: DetectedAssertion[],
  responseVar: string
): void {
  if (assertions.length === 0) {
    lines.push(`      expect(${responseVar}).toBeTruthy();`);
    return;
  }

  for (const assertion of assertions) {
    const accessor = buildAccessor(responseVar, assertion.path);

    switch (assertion.matcher) {
      case "toBe":
        if (typeof assertion.value === "string") {
          lines.push(`      expect(${accessor}).toBe("${assertion.value}");`);
        } else {
          lines.push(`      expect(${accessor}).toBe(${String(assertion.value)});`);
        }
        break;
      case "toBeTruthy":
        lines.push(`      expect(${accessor}).toBeTruthy();`);
        break;
      case "toBeDefined":
        lines.push(`      expect(${accessor}).toBeDefined();`);
        break;
      case "toContain":
        lines.push(
          `      expect(${accessor}).toContain(${JSON.stringify(assertion.value)});`
        );
        break;
    }
  }
}

// ============================================================================
// Utility Helpers
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
 *
 * Handles grammatical transformations:
 * - "it is persisted" -> "should be persisted"
 * - "they are returned" -> "should be returned"
 * - "the system responds" -> "should respond"
 */
function generateItDescription(scenario: Scenario): string {
  let text = scenario.then.toLowerCase();

  // Strip leading pronouns/articles
  text = text.replace(/^(it |they |the system |the |a |an )/, "");

  // Grammatical fix: "is/are" -> "be" when used after "should"
  if (text.startsWith("is ")) {
    text = "should " + text.replace(/^is /, "be ");
  } else if (text.startsWith("are ")) {
    text = "should " + text.replace(/^are /, "be ");
  } else {
    text = "should " + text;
  }

  // Truncate to ~80 chars at a word boundary
  if (text.length <= 80) {
    return text;
  }
  const truncated = text.slice(0, 77);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 40 ? truncated.slice(0, lastSpace) + "..." : truncated + "...";
}

/**
 * Escape double quotes in a string for use inside a double-quoted JS string.
 */
function escapeDoubleQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

/**
 * Resolve path parameters. If the path has :id and we have a seeded entity,
 * replace :id with template expression referencing the seeded variable.
 */
function resolvePath(
  path: string,
  precondition: DetectedPrecondition
): string {
  if (path.includes(":id") && precondition.type !== "none" && precondition.type !== "database") {
    // Replace :id with interpolated seeded.id
    return path.replace(":id", '${seeded.id}');
  }
  return path;
}

/**
 * Build a property accessor expression from a response variable and dot path.
 */
function buildAccessor(responseVar: string, path: string): string {
  if (path === "status") {
    return `${responseVar}.status`;
  }
  // For body paths like "data.status", use res.body.data.status
  return `${responseVar}.body.${path}`;
}

/**
 * Generate default POST body fields based on the endpoint path.
 */
function generateDefaultPostBody(lines: string[], path: string): void {
  if (path.includes("/proposals")) {
    lines.push('        author: "test-agent",');
    lines.push('        title: "Test Proposal",');
    lines.push('        description: "Test description",');
    lines.push('        type: "engineering",');
    lines.push('        project: "adjutant",');
  } else if (path.includes("/messages")) {
    lines.push('        agentId: "test-agent",');
    lines.push('        role: "user",');
    lines.push('        body: "Test message",');
  } else {
    lines.push("        // TODO: add request body fields");
  }
}

/**
 * Capitalize first letter.
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

import { existsSync, readFileSync } from "fs";
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
  /** Sync mode: preserve manual edits, replace auto-generated bodies */
  sync?: boolean;
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

  // In sync mode, merge new generated content with existing file
  if (options.sync && existsSync(filePath)) {
    const existingContent = readFileSync(filePath, "utf-8");
    const merged = syncTestFile(existingContent, content);
    await writeFile(filePath, merged, "utf-8");
    return [filePath];
  }

  await writeFile(filePath, content, "utf-8");

  return [filePath];
}

// ============================================================================
// Sync Mode — Merge Generated Content with Manual Edits
// ============================================================================

/**
 * Parsed representation of a single it() block for sync merging.
 */
interface ItBlock {
  /** The full text of the it() block including opening and closing */
  fullText: string;
  /** The it() description string */
  description: string;
  /** The body content between opening `{` and closing `});` */
  body: string;
  /** Whether the body has the AUTO-GENERATED marker */
  isAutoGenerated: boolean;
}

/**
 * Extract all it() / it.skip() blocks from test file content.
 */
function extractItBlocks(content: string): ItBlock[] {
  const blocks: ItBlock[] = [];
  // Match it("...", ... => { ... }); or it.skip("...", ... => { ... });
  const regex = /^( *(?:it|it\.skip)\(("[^"]+")[^)]*\)[^{]*\{)\n([\s\S]*?)\n( *\}\);)/gm;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const opening = match[1]!;
    const description = match[2]!.slice(1, -1); // Remove quotes
    const body = match[3]!;
    const closing = match[4]!;
    const fullText = `${opening}\n${body}\n${closing}`;

    blocks.push({
      fullText,
      description,
      body,
      isAutoGenerated: body.trimStart().startsWith("// AUTO-GENERATED"),
    });
  }

  return blocks;
}

/**
 * Merge newly generated test content with existing content, preserving
 * manually edited it() bodies while replacing auto-generated ones.
 *
 * Rules:
 * - If existing body has `// AUTO-GENERATED` marker -> replace with new
 * - If existing body lacks marker -> preserve (manually edited)
 * - New scenarios (in new but not existing) -> add with generated code
 * - Removed scenarios (in existing but not new) -> drop
 *
 * @param existingContent - The current test file content
 * @param newContent - The freshly generated test file content
 * @returns Merged content respecting manual edits
 */
export function syncTestFile(existingContent: string, newContent: string): string {
  const existingBlocks = extractItBlocks(existingContent);
  const newBlocks = extractItBlocks(newContent);

  // Build a map of existing blocks by description
  const existingByDesc = new Map<string, ItBlock>();
  for (const block of existingBlocks) {
    existingByDesc.set(block.description, block);
  }

  // Build a map of new blocks by description
  const newByDesc = new Map<string, ItBlock>();
  for (const block of newBlocks) {
    newByDesc.set(block.description, block);
  }

  // Start with the new content as the base, then replace blocks as needed
  let result = newContent;

  for (const newBlock of newBlocks) {
    const existing = existingByDesc.get(newBlock.description);

    if (existing && !existing.isAutoGenerated) {
      // Preserve manually edited body: replace the new block's body with old
      result = result.replace(newBlock.fullText, newBlock.fullText.replace(newBlock.body, existing.body));
    }
    // If existing is auto-generated or doesn't exist, keep the new generated code (already in result)
  }

  // Scenarios in existing but not in new are automatically dropped
  // because we started from newContent

  return result;
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
  lines.push("      // AUTO-GENERATED");

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
  lines.push("      // AUTO-GENERATED");

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
  lines.push("      // AUTO-GENERATED");
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
  lines.push("      // AUTO-GENERATED");
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

  const quoted = quotePath(path);

  switch (apiCall.method) {
    case "POST":
      lines.push(`      const res = await harness.post(${quoted}, {`);
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
          `      const res = await harness.get(${quoted}, { ${queryEntries} });`
        );
      } else {
        lines.push(`      const res = await harness.get(${quoted});`);
      }
      break;

    case "PATCH":
      if (apiCall.body) {
        const bodyStr = JSON.stringify(apiCall.body);
        lines.push(
          `      const res = await harness.patch(${quoted}, ${bodyStr});`
        );
      } else {
        lines.push(`      const res = await harness.${method}(${quoted}, {});`);
      }
      break;

    case "PUT":
      lines.push(`      const res = await harness.request.put(${quoted}).send({});`);
      break;

    case "DELETE":
      lines.push(`      const res = await harness.request.delete(${quoted});`);
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
 * Delegates to descriptionFromThen for grammar transformations.
 */
function generateItDescription(scenario: Scenario): string {
  return descriptionFromThen(scenario.then);
}

/**
 * Transform a Then-clause into a grammatical "should ..." test description.
 *
 * Handles:
 * - Strip leading articles/pronouns (it, they, the, a, an, each)
 * - Passive "is/are VERB-ed" -> "be VERB-ed" or active form
 * - Third-person verbs: "responds" -> "respond", "includes" -> "include"
 * - "X updates to Y and Z is refreshed" -> "update X to Y and refresh Z"
 * - "each X has Y" -> "have Y for each X"
 * - Lowercase first verb after "should"
 * - Truncate at ~80 chars on word boundary
 *
 * @param thenText - The Then clause text from a GWT scenario
 * @returns A "should ..." description string
 */
export function descriptionFromThen(thenText: string): string {
  if (!thenText || !thenText.trim()) {
    return "should handle empty then clause";
  }

  let text = thenText.trim();

  // Try specialized pattern transforms first
  const specialized = trySpecializedTransforms(text);
  if (specialized) {
    return truncateDescription(specialized);
  }

  // General approach: strip leading subject, fix verb, prepend "should"

  // Strip leading pronouns/articles (preserve original case in rest)
  const stripped = text.replace(
    /^(it |they |the system |the response |the |a |an |each )/i,
    ""
  ).trim();

  const lowerStripped = stripped.toLowerCase();

  // If we stripped "each X verb Y", restructure to "verb Y for each X"
  if (/^each /i.test(text)) {
    const eachResult = transformEachClause(lowerStripped);
    if (eachResult) {
      return truncateDescription("should " + eachResult);
    }
  }

  // Handle "is/are + past participle" -> "be + past participle"
  // Preserve case of the rest (e.g., "ID")
  if (/^is /i.test(lowerStripped)) {
    return truncateDescription("should " + stripped.replace(/^is /i, "be "));
  }
  if (/^are /i.test(lowerStripped)) {
    return truncateDescription("should " + stripped.replace(/^are /i, "be "));
  }

  // De-conjugate third-person present verbs: "responds" -> "respond"
  const deconj = deconjugateLeadingVerb(lowerStripped);

  return truncateDescription("should " + deconj);
}

/**
 * Try to match and transform specialized patterns that need more
 * than simple subject stripping.
 */
function trySpecializedTransforms(text: string): string | null {
  // Pattern: "X are returned Y" -> "should return X Y"
  // e.g. "only pending proposals are returned sorted by newest first"
  // Skip when subject is just a pronoun (they, it, etc.)
  const areReturnedMatch = text.match(
    /^(?:only )?(.+?)\s+are\s+returned\b(.*)$/i
  );
  if (areReturnedMatch) {
    const subject = areReturnedMatch[1]!.toLowerCase();
    const isPronoun = /^(they|it|these|those)$/i.test(subject.replace(/^only\s+/, ""));
    if (!isPronoun) {
      const rest = areReturnedMatch[2]!.toLowerCase().trim();
      const onlyPrefix = /^only /i.test(text) ? "only " : "";
      const cleanSubject = subject.replace(/^only\s+/, "");
      return `should return ${onlyPrefix}${cleanSubject}${rest ? " " + rest : ""}`;
    }
  }

  // Pattern: "X updates to Y and Z is refreshed"
  // -> "should update X to Y and refresh Z"
  const updatesAndRefreshed = text.match(
    /^(.+?)\s+updates?\s+to\s+(.+?)\s+and\s+(.+?)\s+is\s+refreshed$/i
  );
  if (updatesAndRefreshed) {
    const subject = updatesAndRefreshed[1]!.toLowerCase();
    const target = updatesAndRefreshed[2]!;
    const refreshTarget = updatesAndRefreshed[3]!.toLowerCase();
    return `should update ${subject} to ${target} and refresh ${refreshTarget}`;
  }

  // Pattern: "a/an X is VERBed" -> "should VERB a/an X"
  const articlePassive = text.match(
    /^(a|an)\s+(.+?)\s+is\s+(\w+ed)\b(.*)$/i
  );
  if (articlePassive) {
    const article = articlePassive[1]!.toLowerCase();
    const noun = articlePassive[2]!.toLowerCase();
    const verb = depassivize(articlePassive[3]!.toLowerCase());
    const rest = articlePassive[4]!.toLowerCase().trim();
    return `should ${verb} ${article} ${noun}${rest ? " " + rest : ""}`;
  }

  // Pattern: "the discussion is appended to the proposal"
  // -> "should append the discussion to the proposal"
  const theXIsVerbed = text.match(
    /^the\s+(.+?)\s+is\s+(\w+ed)\b(.*)$/i
  );
  if (theXIsVerbed) {
    const noun = theXIsVerbed[1]!.toLowerCase();
    const verb = depassivize(theXIsVerbed[2]!.toLowerCase());
    const rest = theXIsVerbed[3]!.toLowerCase().trim();
    return `should ${verb} the ${noun}${rest ? " " + rest : ""}`;
  }

  return null;
}

/**
 * Transform "X has/have Y" after "each" was stripped.
 * "proposal has required fields" -> "have required fields for each proposal"
 */
function transformEachClause(text: string): string | null {
  const hasMatch = text.match(/^(.+?)\s+has\s+(.+)$/i);
  if (hasMatch) {
    return `have ${hasMatch[2]!.toLowerCase()} for each ${hasMatch[1]!.toLowerCase()}`;
  }
  return null;
}

/**
 * Convert a past participle back to base form for active voice.
 * "returned" -> "return", "appended" -> "append", "created" -> "create"
 */
function depassivize(pastParticiple: string): string {
  // Common irregular forms
  const irregulars: Record<string, string> = {
    returned: "return",
    created: "create",
    persisted: "persist",
    appended: "append",
    refreshed: "refresh",
    included: "include",
    received: "receive",
    sorted: "sort",
  };

  if (irregulars[pastParticiple]) {
    return irregulars[pastParticiple]!;
  }

  // Regular: remove -ed, handle doubling and -e stems
  if (pastParticiple.endsWith("ied")) {
    return pastParticiple.slice(0, -3) + "y";
  }
  if (pastParticiple.endsWith("ed")) {
    const stem = pastParticiple.slice(0, -2);
    // If stem ends with doubled consonant, remove one
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      return stem.slice(0, -1);
    }
    // Check if "stem + e" looks more natural (e.g., "saved" -> "save")
    if (pastParticiple.endsWith("ted") || pastParticiple.endsWith("ded")) {
      return stem + "e";
    }
    return stem;
  }

  return pastParticiple;
}

/**
 * De-conjugate a leading third-person present verb.
 * "responds with 200" -> "respond with 200"
 * "includes proposals" -> "include proposals"
 * "has required fields" -> "have required fields"
 */
function deconjugateLeadingVerb(text: string): string {
  // Special case: "has" -> "have"
  if (/^has\b/.test(text)) {
    return text.replace(/^has\b/, "have");
  }

  // Words ending in -es where base form drops the -es
  // "responds" -> "respond", but "includes" -> "include"
  const esMatch = text.match(/^(\w+)(es)\b(.*)/);
  if (esMatch) {
    const stem = esMatch[1]!;
    const rest = esMatch[3]!;
    // "includes" -> "include" (stem ends in consonant before -es -> add e)
    if (/[sc]h$/.test(stem) || /[sxz]$/.test(stem)) {
      // "matches" -> "match", "fixes" -> "fix"
      return stem + rest;
    }
    // "includes" -> the stem is "includ", we want "include"
    return stem + "e" + rest;
  }

  // Words ending in -s (simple third person)
  const sMatch = text.match(/^(\w+)s\b(.*)/);
  if (sMatch) {
    const stem = sMatch[1]!;
    const rest = sMatch[2]!;
    // Don't strip 's' from short words or words where it's not a verb inflection
    if (stem.length >= 3) {
      return stem + rest;
    }
  }

  return text;
}

/**
 * Truncate a description to ~80 chars at a word boundary.
 */
function truncateDescription(text: string): string {
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
 * Wrap a path string in the correct quoting.
 * Uses backticks for paths containing `${` (template expressions),
 * double quotes for static paths.
 */
function quotePath(path: string): string {
  if (path.includes("${")) {
    return `\`${path}\``;
  }
  return `"${path}"`;
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

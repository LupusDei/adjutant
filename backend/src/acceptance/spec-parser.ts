/**
 * Spec Parser — Extracts structured Given/When/Then scenarios from spec.md files.
 *
 * Parses the markdown format used by speckit-generated spec files, extracting:
 * - User Stories with acceptance scenarios
 * - Functional Requirements (FR-xxx)
 * - Edge Cases
 *
 * @module acceptance/spec-parser
 */

import { readFile } from "fs/promises";

import type {
  ParseResult,
  UserStory,
  Scenario,
  Requirement,
} from "./types.js";

// ============================================================================
// Parser State Machine
// ============================================================================

/**
 * States for the line-by-line parser.
 *
 * SEEKING_STORY  — looking for a `### User Story N` header
 * IN_STORY       — inside a user story, looking for `**Acceptance Scenarios**:`
 * IN_SCENARIOS   — inside the scenarios block, accumulating scenario lines
 * IN_EDGE_CASES  — inside `### Edge Cases`, accumulating `- ` lines
 * IN_REQUIREMENTS — inside `### Functional Requirements`, accumulating `- **FR-xxx**:` lines
 */
type ParserState =
  | "SEEKING_STORY"
  | "IN_STORY"
  | "IN_SCENARIOS"
  | "IN_EDGE_CASES"
  | "IN_REQUIREMENTS";

/** Regex to match user story headers */
const USER_STORY_RE =
  /^###\s+User Story\s+(\d+)\s*[-–—]\s*(.+?)\s*\(Priority:\s*(P\d+)(?:,\s*\w+)?\)/;

/** Regex to detect the acceptance scenarios marker */
const ACCEPTANCE_SCENARIOS_RE = /^\*\*Acceptance Scenarios\*\*\s*:/;

/** Regex to detect a numbered scenario line start */
const NUMBERED_ITEM_RE = /^\d+\.\s+/;

/** Regex to extract bold GWT keywords */
const GIVEN_RE = /\*\*Given\*\*\s*/;
const WHEN_RE = /\*\*When\*\*\s*/;
const THEN_RE = /\*\*Then\*\*\s*/;

/** Regex for functional requirement lines */
const FR_LINE_RE = /^-\s+\*\*([A-Z]+-\d+)\*\*\s*:\s*(.+)/;

/** Regex for FR references anywhere in text */
const FR_REF_RE = /\bFR-\d+\b/g;

/** Regex for edge case lines */
const EDGE_CASE_RE = /^-\s+(.+)/;

/** Regex for section breaks and headers that end a block */
const SECTION_BREAK_RE = /^(---|##\s|###\s)/;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a spec.md file from disk and extract structured data.
 *
 * @param specPath - Path to the spec.md file
 * @returns Parsed result with user stories, requirements, and edge cases
 */
export async function parseSpec(specPath: string): Promise<ParseResult> {
  const content = await readFile(specPath, "utf-8");
  return parseSpecContent(content, specPath);
}

/**
 * Parse spec content from a string (for testing without file I/O).
 *
 * @param content - Raw markdown content of the spec
 * @param specPath - Path to associate with the result
 * @returns Parsed result
 */
export function parseSpecContent(content: string, specPath: string): ParseResult {
  const lines = content.split("\n");
  const featureName = extractFeatureName(lines);
  const userStories: UserStory[] = [];
  const requirements: Requirement[] = [];
  const edgeCases: string[] = [];

  let state: ParserState = "SEEKING_STORY";
  let currentStory: UserStory | null = null;
  let currentStoryTextLines: string[] = [];
  let scenarioAccumulator = "";
  let scenarioIndex = 0;

  /**
   * Flush accumulated multi-line scenario text into a Scenario object,
   * validate it, and push it to the current story.
   */
  function flushScenario(): void {
    if (!scenarioAccumulator.trim() || !currentStory) return;

    const scenario = parseGwtLine(scenarioAccumulator.trim(), scenarioIndex);
    if (scenario) {
      currentStory.scenarios.push(scenario);
    }
    scenarioAccumulator = "";
  }

  /**
   * Finalize the current story: extract FR references from its text and scenarios.
   */
  function finalizeStory(): void {
    if (!currentStory) return;

    // Collect FR references from story description text
    const storyText = currentStoryTextLines.join(" ");
    const storyFrRefs = extractFrReferences(storyText);

    // Collect FR references from scenario text
    for (const scenario of currentStory.scenarios) {
      const scenarioFrRefs = extractFrReferences(scenario.raw);
      for (const ref of scenarioFrRefs) {
        storyFrRefs.add(ref);
      }
    }

    currentStory.requirementIds = [...storyFrRefs].sort();
    userStories.push(currentStory);
    currentStory = null;
    currentStoryTextLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for User Story header — always transitions state
    const storyMatch = USER_STORY_RE.exec(trimmed);
    if (storyMatch) {
      // Flush any pending scenario from previous story
      flushScenario();
      finalizeStory();

      currentStory = {
        title: storyMatch[2]!.trim(),
        storyNumber: parseInt(storyMatch[1]!, 10),
        priority: storyMatch[3]!,
        scenarios: [],
        requirementIds: [],
      };
      state = "IN_STORY";
      continue;
    }

    // Check for Edge Cases section
    if (trimmed === "### Edge Cases") {
      flushScenario();
      finalizeStory();
      state = "IN_EDGE_CASES";
      continue;
    }

    // Check for Functional Requirements section
    if (trimmed === "### Functional Requirements") {
      flushScenario();
      finalizeStory();
      state = "IN_REQUIREMENTS";
      continue;
    }

    // Check for section breaks that end current block
    if (state !== "SEEKING_STORY" && SECTION_BREAK_RE.test(trimmed)) {
      if (state === "IN_SCENARIOS") {
        flushScenario();
        finalizeStory();
      } else if (state === "IN_STORY") {
        finalizeStory();
      }
      state = "SEEKING_STORY";
      // Don't continue — let fall through for potential header re-detection
      // (but we already checked storyMatch above)
      continue;
    }

    switch (state) {
      case "SEEKING_STORY":
        // Nothing to do — waiting for a story header
        break;

      case "IN_STORY":
        // Look for acceptance scenarios marker
        if (ACCEPTANCE_SCENARIOS_RE.test(trimmed)) {
          state = "IN_SCENARIOS";
          scenarioIndex = 0;
          break;
        }
        // Accumulate story text for FR reference extraction
        if (trimmed) {
          currentStoryTextLines.push(trimmed);
        }
        break;

      case "IN_SCENARIOS":
        if (NUMBERED_ITEM_RE.test(trimmed)) {
          // Flush previous scenario (if any)
          flushScenario();
          // Start new scenario — strip the numbering prefix
          scenarioIndex++;
          scenarioAccumulator = trimmed.replace(NUMBERED_ITEM_RE, "");
        } else if (trimmed === "") {
          // Empty line within scenarios section — could be inter-item spacing
          // Don't flush yet; multi-line scenarios may have blank lines between
        } else {
          // Continuation of multi-line scenario
          scenarioAccumulator += " " + trimmed;
        }
        break;

      case "IN_EDGE_CASES": {
        const edgeMatch = EDGE_CASE_RE.exec(trimmed);
        if (edgeMatch) {
          edgeCases.push(edgeMatch[1]!);
        }
        break;
      }

      case "IN_REQUIREMENTS": {
        const frMatch = FR_LINE_RE.exec(trimmed);
        if (frMatch) {
          requirements.push({
            id: frMatch[1]!,
            text: frMatch[2]!.trim(),
            coveredByStories: [],
          });
        }
        break;
      }
    }
  }

  // Flush any remaining state
  flushScenario();
  finalizeStory();

  // Build the coveredByStories mapping for requirements
  buildRequirementCoverage(requirements, userStories);

  return {
    specPath,
    featureName,
    userStories,
    requirements,
    edgeCases,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Extract the feature name from the `# Feature Specification: [Name]` header.
 */
function extractFeatureName(lines: string[]): string {
  for (const line of lines) {
    const match = /^#\s+Feature Specification:\s*(.+)/.exec(line.trim());
    if (match) {
      return match[1]!.trim();
    }
  }
  return "Unknown Feature";
}

/**
 * Parse a single GWT scenario line into a Scenario object.
 * Returns null if the line is malformed (missing When or Then).
 */
function parseGwtLine(text: string, index: number): Scenario | null {
  // Check that all three keywords are present
  if (!GIVEN_RE.test(text) || !WHEN_RE.test(text) || !THEN_RE.test(text)) {
    // Malformed — skip with implicit warning
    return null;
  }

  // Split on bold keywords to extract clauses
  // The text format is: **Given** X, **When** Y, **Then** Z
  // We need to split carefully since the text between keywords may contain commas

  const givenStart = text.search(GIVEN_RE);
  const whenStart = text.search(WHEN_RE);
  const thenStart = text.search(THEN_RE);

  if (givenStart === -1 || whenStart === -1 || thenStart === -1) {
    return null;
  }

  // Extract text between keywords
  const afterGiven = text.slice(givenStart).replace(GIVEN_RE, "");
  const givenText = afterGiven.slice(0, afterGiven.search(WHEN_RE)).replace(/,\s*$/, "").trim();

  const afterWhen = text.slice(whenStart).replace(WHEN_RE, "");
  const whenText = afterWhen.slice(0, afterWhen.search(THEN_RE)).replace(/,\s*$/, "").trim();

  const afterThen = text.slice(thenStart).replace(THEN_RE, "");
  const thenText = afterThen.trim();

  if (!givenText || !whenText || !thenText) {
    return null;
  }

  return {
    index,
    given: givenText,
    when: whenText,
    then: thenText,
    raw: text,
  };
}

/**
 * Extract all FR-xxx references from a block of text.
 */
function extractFrReferences(text: string): Set<string> {
  const refs = new Set<string>();
  const matches = text.match(FR_REF_RE);
  if (matches) {
    for (const m of matches) {
      refs.add(m);
    }
  }
  return refs;
}

/**
 * Build the coveredByStories mapping: for each requirement, find which
 * user stories reference it (in story text or scenario text).
 */
function buildRequirementCoverage(
  requirements: Requirement[],
  userStories: UserStory[]
): void {
  for (const req of requirements) {
    const storyNumbers = new Set<number>();

    for (const story of userStories) {
      if (story.requirementIds.includes(req.id)) {
        storyNumbers.add(story.storyNumber);
      }
    }

    req.coveredByStories = [...storyNumbers].sort((a, b) => a - b);
  }
}

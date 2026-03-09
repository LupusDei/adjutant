/**
 * Pattern Detector — Extracts API calls, assertions, and preconditions from
 * GWT scenario text to drive smart code generation.
 *
 * Each detector uses regex patterns matched against real-world spec text
 * (e.g. from 017-agent-proposals) to extract structured data the code
 * generator can use to emit inline supertest calls instead of TODO stubs.
 *
 * @module acceptance/pattern-detector
 */

import type {
  DetectedApiCall,
  DetectedAssertion,
  DetectedPrecondition,
  Scenario,
  ScenarioClassification,
} from "./types.js";
import { findStep } from "./step-registry.js";

// ============================================================================
// When-Clause: API Call Detection
// ============================================================================

/**
 * HTTP methods we look for in When-clause text.
 * Order matters for regex alternation — longer methods first to avoid
 * partial matches (e.g. "DELETE" before "DE...").
 */
const HTTP_METHODS = ["DELETE", "PATCH", "POST", "PUT", "GET"] as const;

/**
 * Regex to find an HTTP method + path in the When-clause text.
 *
 * Matches patterns like:
 *   - "POST /api/proposals"
 *   - "a proposal is created via POST /api/proposals"
 *   - "GET /api/proposals is called with ..."
 *   - "PATCH /api/proposals/:id with ..."
 */
const API_CALL_REGEX = new RegExp(
  `(?:via\\s+)?(${HTTP_METHODS.join("|")})\\s+(\/[\\w/:.-]+)`,
  "i",
);

/**
 * Regex to extract query parameters from the When-clause text.
 * Matches `?key=value` or `?key=value&key2=value2`, with or without backticks.
 */
const QUERY_PARAM_REGEX = /[`?]?\?([^`\s]+)/;

/**
 * Regex to extract a JSON body from the When-clause text.
 * Matches content inside backticks that looks like JSON: `{ ... }`
 */
const JSON_BODY_REGEX = /`\s*(\{[^`]+\})\s*`/;

/**
 * Detect an API call from When-clause text.
 *
 * @param whenText - The "When" clause from a GWT scenario
 * @returns Detected API call details, or null if no API pattern found
 */
export function detectApiCall(whenText: string): DetectedApiCall | null {
  const methodMatch = API_CALL_REGEX.exec(whenText);
  if (!methodMatch) return null;

  const method = methodMatch[1]!.toUpperCase() as DetectedApiCall["method"];
  const path = methodMatch[2]!;

  const result: DetectedApiCall = { method, path };

  // Extract query parameters
  const queryMatch = QUERY_PARAM_REGEX.exec(whenText);
  if (queryMatch) {
    const queryString = queryMatch[1]!;
    const query: Record<string, string> = {};
    for (const pair of queryString.split("&")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx);
        const value = pair.slice(eqIdx + 1);
        query[key] = value;
      }
    }
    if (Object.keys(query).length > 0) {
      result.query = query;
    }
  }

  // Extract JSON body
  const bodyMatch = JSON_BODY_REGEX.exec(whenText);
  if (bodyMatch) {
    try {
      result.body = JSON.parse(bodyMatch[1]!) as Record<string, unknown>;
    } catch {
      // Try fixing non-standard JSON (unquoted keys like { status: "accepted" })
      const fixed = bodyMatch[1]!.replace(
        /(\{|,)\s*(\w+)\s*:/g,
        '$1 "$2":',
      );
      try {
        result.body = JSON.parse(fixed) as Record<string, unknown>;
      } catch {
        // Truly malformed — skip body extraction
      }
    }
  }

  return result;
}

// ============================================================================
// Then-Clause: Assertion Detection
// ============================================================================

/**
 * Regex patterns for extracting assertions from Then-clause text.
 * Each entry maps a pattern to an assertion factory.
 */
interface AssertionPattern {
  regex: RegExp;
  extract: (match: RegExpMatchArray) => DetectedAssertion[];
}

const ASSERTION_PATTERNS: AssertionPattern[] = [
  // "it is persisted with status "pending"" → data.status = "pending"
  // "status updates to "accepted"" → data.status = "accepted"
  {
    regex: /status\s+(?:\w+\s+)*?"(\w+)"/i,
    extract: (match) => [
      { path: "data.status", value: match[1]!, matcher: "toBe" },
    ],
  },
  // "a generated UUID" or "a UUID" → data.id exists
  {
    regex: /generated\s+UUID|a\s+UUID|an?\s+id/i,
    extract: () => [{ path: "data.id", value: null, matcher: "toBeTruthy" }],
  },
  // "updated_at is refreshed" → data.updatedAt exists (camelCase API response)
  {
    regex: /updated_at\s+is\s+refreshed/i,
    extract: () => [{ path: "data.updatedAt", value: null, matcher: "toBeTruthy" }],
  },
  // "the response status is 200" → status = 200
  {
    regex: /response\s+status\s+is\s+(\d+)/i,
    extract: (match) => [
      { path: "status", value: parseInt(match[1]!, 10), matcher: "toBe" },
    ],
  },
  // "only pending proposals are returned" → data exists
  {
    regex: /(?:only\s+\w+\s+)?(?:proposals|messages|items|results)\s+are\s+returned/i,
    extract: () => [{ path: "data", value: null, matcher: "toBeTruthy" }],
  },
];

/**
 * Detect assertions from Then-clause text.
 *
 * @param thenText - The "Then" clause from a GWT scenario
 * @returns Array of detected assertions (may be empty if no patterns match)
 */
export function detectAssertions(thenText: string): DetectedAssertion[] {
  const assertions: DetectedAssertion[] = [];

  for (const pattern of ASSERTION_PATTERNS) {
    const match = pattern.regex.exec(thenText);
    if (match) {
      assertions.push(...pattern.extract(match));
    }
  }

  return assertions;
}

// ============================================================================
// Given-Clause: Precondition Detection
// ============================================================================

/**
 * Regex patterns for extracting preconditions from Given-clause text.
 */
interface PreconditionPattern {
  regex: RegExp;
  extract: (match: RegExpMatchArray) => DetectedPrecondition;
}

const PRECONDITION_PATTERNS: PreconditionPattern[] = [
  // "the database is initialized"
  {
    regex: /database\s+is\s+initialized/i,
    extract: () => ({ type: "database" }),
  },
  // "a pending proposal" / "an accepted proposal"
  {
    regex: /(?:a|an)\s+(\w+)\s+proposal/i,
    extract: (match) => ({
      type: "proposal",
      params: { status: match[1]!.toLowerCase() },
    }),
  },
  // "proposals exist"
  {
    regex: /proposals?\s+exist/i,
    extract: () => ({ type: "proposal" }),
  },
  // "messages exist"
  {
    regex: /messages?\s+exist/i,
    extract: () => ({ type: "message" }),
  },
  // "an agent connected via MCP" / "agent is connected"
  {
    regex: /agent\s+(?:is\s+)?connected/i,
    extract: () => ({ type: "agent" }),
  },
  // "a persona exists" / "a persona named X exists" / "no personas exist"
  {
    regex: /persona/i,
    extract: () => ({ type: "persona" }),
  },
  // "a bead exists" / "beads exist"
  {
    regex: /beads?\s+exist/i,
    extract: () => ({ type: "agent", params: { entity: "bead" } }),
  },
  // "events exist"
  {
    regex: /events?\s+exist/i,
    extract: () => ({ type: "agent", params: { entity: "event" } }),
  },
  // "a session exists" / "an active session exists"
  {
    regex: /session\s+exist/i,
    extract: () => ({ type: "agent", params: { entity: "session" } }),
  },
  // UI navigation: "the user navigates to ..." / "the user is on ..."
  {
    regex: /user\s+(?:navigates|is\s+on|opens|views)/i,
    extract: () => ({ type: "none" }),
  },
];

/**
 * Detect a precondition from Given-clause text.
 *
 * @param givenText - The "Given" clause from a GWT scenario
 * @returns Detected precondition (defaults to { type: "none" } if unrecognized)
 */
export function detectPrecondition(givenText: string): DetectedPrecondition {
  for (const pattern of PRECONDITION_PATTERNS) {
    const match = pattern.regex.exec(givenText);
    if (match) {
      return pattern.extract(match);
    }
  }

  return { type: "none" };
}

// ============================================================================
// Scenario Classification
// ============================================================================

/** Keywords that indicate a UI-only scenario (checked in Given, When, and Then text). */
const UI_KEYWORDS =
  /\b(?:clicks?|navigates?|taps?|views?|sees?|swipes?|scrolls?|drags?|toggles?|filters?|selects?|opens?\s+(?:the\s+)?(?:page|tab|modal|dialog|settings))\b/i;

/** Keywords that indicate agent-behavior scenario. */
const AGENT_KEYWORDS =
  /\b(?:agent|spawns?|teammate|MCP\s+tool\s+call|create_proposal|calls\s+\w+_\w+)\b/i;

/**
 * Classify a scenario to determine the code generation strategy.
 *
 * Priority order:
 * 1. Step registry match (any clause) -> "step-matched"
 * 2. API pattern in When clause -> "api-testable"
 * 3. UI keywords in When/Then -> "ui-only"
 * 4. Agent keywords in When/Then -> "agent-behavior"
 * 5. Default -> "unknown"
 *
 * @param scenario - The scenario to classify
 * @returns Classification determining the code generation approach
 */
export function classifyScenario(scenario: Scenario): ScenarioClassification {
  // 1. Check step registry for matches on any clause
  const hasGivenStep = findStep("given", scenario.given) !== null;
  const hasWhenStep = findStep("when", scenario.when) !== null;
  const hasThenStep = findStep("then", scenario.then) !== null;

  if (hasGivenStep || hasWhenStep || hasThenStep) {
    return "step-matched";
  }

  // 2. Check When text for API patterns
  const apiCall = detectApiCall(scenario.when);
  if (apiCall !== null) {
    return "api-testable";
  }

  // 3. Check for UI keywords in Given, When, and Then
  const combinedAllClauses = `${scenario.given} ${scenario.when} ${scenario.then}`;
  if (UI_KEYWORDS.test(combinedAllClauses)) {
    return "ui-only";
  }

  // 4. Check for agent keywords in Given, When, and Then
  if (AGENT_KEYWORDS.test(combinedAllClauses)) {
    return "agent-behavior";
  }

  // 5. Default
  return "unknown";
}

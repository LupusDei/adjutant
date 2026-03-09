// ============================================================================
// Acceptance Test Fixture Framework — Core Types
// ============================================================================

/**
 * A single Given/When/Then acceptance scenario extracted from a spec.
 */
export interface Scenario {
  /** 1-based scenario number within the user story */
  index: number;
  /** The "Given" clause text */
  given: string;
  /** The "When" clause text */
  when: string;
  /** The "Then" clause text */
  then: string;
  /** Original full text from spec */
  raw: string;
}

/**
 * A parsed User Story with its acceptance scenarios.
 */
export interface UserStory {
  /** e.g. "Agent-to-User Messaging" */
  title: string;
  /** e.g. 1 */
  storyNumber: number;
  /** e.g. "P1" */
  priority: string;
  /** Acceptance scenarios for this story */
  scenarios: Scenario[];
  /** FR-xxx IDs associated with this story */
  requirementIds: string[];
}

/**
 * A functional requirement extracted from the spec.
 */
export interface Requirement {
  /** e.g. "FR-001" */
  id: string;
  /** The requirement text after the ID */
  text: string;
  /** Story numbers that reference this requirement */
  coveredByStories: number[];
}

/**
 * Full parse result from a spec.md file.
 */
export interface ParseResult {
  /** Path to the spec file that was parsed */
  specPath: string;
  /** Feature name extracted from the spec header */
  featureName: string;
  /** All user stories found in the spec */
  userStories: UserStory[];
  /** All functional requirements found in the spec */
  requirements: Requirement[];
  /** Edge case descriptions */
  edgeCases: string[];
  /** Warnings generated during parsing (e.g. malformed GWT scenarios) */
  warnings: string[];
}

/**
 * Configuration for the test harness.
 */
export interface HarnessConfig {
  /** Path to SQLite database (temp dir if omitted) */
  dbPath?: string;
  /** Server port (0 = random available port) */
  port?: number;
}

/**
 * Step definition types for Given/When/Then matching.
 */
export type StepType = "given" | "when" | "then";

/**
 * A step definition that maps a text pattern to a test function.
 */
export interface StepDefinition {
  /** Which GWT clause this step handles */
  type: StepType;
  /** Pattern to match against clause text (string for exact, RegExp for flexible) */
  pattern: string | RegExp;
  /** Function to execute when matched; receives harness and captured groups */
  fn: (harness: unknown, ...args: string[]) => Promise<void>;
}

// ============================================================================
// Pattern Detector Types — Used by the smart code generator (adj-039)
// ============================================================================

/**
 * Detected API call from When-clause text.
 *
 * Pattern detector extracts HTTP method, path, query params, and request body
 * from scenario When-clauses that describe REST API interactions.
 */
export interface DetectedApiCall {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

/**
 * Detected assertion from Then-clause text.
 *
 * Each assertion describes a single expect() call the generator should emit.
 */
export interface DetectedAssertion {
  /** Dot path into response body, e.g. "data.status" */
  path: string;
  /** Expected value, or null for existence check */
  value: unknown;
  /** Vitest matcher to use */
  matcher: "toBe" | "toBeTruthy" | "toBeDefined" | "toContain";
}

/**
 * Detected precondition from Given-clause text.
 *
 * Tells the generator what seed data or setup is needed before the When step.
 */
export interface DetectedPrecondition {
  /** What kind of seed data is needed */
  type: "proposal" | "message" | "agent" | "database" | "none";
  /** Optional parameters for seeding */
  params?: Record<string, unknown>;
}

/**
 * How a scenario should be generated.
 *
 * The classifier inspects each scenario's GWT text and determines
 * which code-generation strategy to use.
 */
export type ScenarioClassification =
  | "api-testable"      // Has detectable API pattern -> inline supertest
  | "step-matched"      // Matches step registry -> executeStep()
  | "ui-only"           // Frontend/browser interaction -> it.skip()
  | "agent-behavior"    // Agent simulation required -> it.skip()
  | "unknown";          // Unrecognized -> TODO stub

/**
 * CLI options for the acceptance test runner.
 */
export interface AcceptanceOptions {
  /** Directory containing spec files */
  specDir: string;
  /** Generate test files from specs */
  generate?: boolean;
  /** Run acceptance tests */
  run?: boolean;
  /** Overwrite existing test files during generation */
  overwrite?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
  /** Process all specs in the specs/ directory */
  all?: boolean;
}

/**
 * Result of discovering a spec directory with parseable GWT scenarios.
 */
export interface DiscoveredSpec {
  /** Directory name (e.g. "017-agent-proposals") */
  dirName: string;
  /** Full path to the spec directory */
  dirPath: string;
  /** Parsed spec result */
  parsed: ParseResult;
}

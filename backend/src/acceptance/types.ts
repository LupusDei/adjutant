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
}

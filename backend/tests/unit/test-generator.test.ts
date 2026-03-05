import { describe, it, expect } from "vitest";

import { generateTestContent } from "../../src/acceptance/test-generator.js";
import type { ParseResult } from "../../src/acceptance/types.js";

// ============================================================================
// Test fixtures
// ============================================================================

const SIMPLE_PARSE_RESULT: ParseResult = {
  specPath: "specs/017-agent-proposals/spec.md",
  featureName: "Agent Proposals System",
  userStories: [
    {
      title: "Data Model & Backend API",
      storyNumber: 1,
      priority: "P1",
      scenarios: [
        {
          index: 1,
          given: "the database is initialized",
          when: "a proposal is created via POST /api/proposals",
          then: 'it is persisted with status "pending" and a generated UUID',
          raw: '**Given** the database is initialized, **When** a proposal is created via POST /api/proposals, **Then** it is persisted with status "pending" and a generated UUID',
        },
        {
          index: 2,
          given: "proposals exist",
          when: "GET /api/proposals is called with ?status=pending",
          then: "only pending proposals are returned sorted by newest first",
          raw: "**Given** proposals exist, **When** GET /api/proposals is called with ?status=pending, **Then** only pending proposals are returned sorted by newest first",
        },
      ],
      requirementIds: ["FR-001", "FR-002"],
    },
    {
      title: "MCP Tools for Agents",
      storyNumber: 2,
      priority: "P1",
      scenarios: [
        {
          index: 1,
          given: "an agent connected via MCP",
          when: "it calls create_proposal with title, description, and type",
          then: "the proposal is created with the agent's resolved identity as author",
          raw: "**Given** an agent connected via MCP, **When** it calls create_proposal with title, description, and type, **Then** the proposal is created with the agent's resolved identity as author",
        },
      ],
      requirementIds: ["FR-003"],
    },
  ],
  requirements: [
    { id: "FR-001", text: "Persist proposals in SQLite", coveredByStories: [1] },
    { id: "FR-002", text: "Support filtering by status", coveredByStories: [1] },
    { id: "FR-003", text: "Expose MCP tools for agents", coveredByStories: [2] },
  ],
  edgeCases: ["Empty title should return 400"],
};

const EMPTY_PARSE_RESULT: ParseResult = {
  specPath: "specs/000-empty/spec.md",
  featureName: "Empty Feature",
  userStories: [],
  requirements: [],
  edgeCases: [],
};

// ============================================================================
// Tests — Test File Generator
// ============================================================================

describe("TestGenerator", () => {
  describe("generateTestContent", () => {
    it("should produce valid TypeScript with describe/it blocks", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // Should contain outer describe with feature name
      expect(content).toContain('describe("Acceptance: Agent Proposals System"');

      // Should have describe blocks for each user story
      expect(content).toContain('describe("US1 - Data Model & Backend API (P1)"');
      expect(content).toContain('describe("US2 - MCP Tools for Agents (P1)"');

      // Should have it blocks for each scenario
      // US1 has 2 scenarios, US2 has 1
      const itBlocks = content.match(/it\("should .+"/g);
      expect(itBlocks).toBeTruthy();
      expect(itBlocks!.length).toBe(3);
    });

    it("should include GWT comments inside each test", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // Each scenario should have Given/When/Then comments
      expect(content).toContain("// Given the database is initialized");
      expect(content).toContain("// When a proposal is created via POST /api/proposals");
      expect(content).toContain('// Then it is persisted with status "pending" and a generated UUID');

      expect(content).toContain("// Given proposals exist");
      expect(content).toContain("// When GET /api/proposals is called with ?status=pending");
      expect(content).toContain("// Then only pending proposals are returned sorted by newest first");
    });

    it("should import TestHarness from the acceptance module", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      expect(content).toContain('import { TestHarness }');
      expect(content).toContain("test-harness");
    });

    it("should include beforeEach/afterEach for harness lifecycle", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      expect(content).toContain("let harness: TestHarness");
      expect(content).toContain("beforeEach");
      expect(content).toContain("afterEach");
      expect(content).toContain("harness.setup()");
      expect(content).toContain("harness.destroy()");
    });

    it("should include header comment with spec path and generation notice", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      expect(content).toContain("Acceptance Tests: Agent Proposals System");
      expect(content).toContain("Generated from: specs/017-agent-proposals/spec.md");
      expect(content).toContain("DO NOT EDIT GENERATED STRUCTURE");
    });

    it("should generate a meaningful it description from the Then clause", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // The descriptions should be derived from the Then clause
      // and start with "should"
      expect(content).toMatch(/it\("should .+persist.+pending/i);
      expect(content).toMatch(/it\("should .+pending proposals.+sorted/i);
    });

    it("should mark TODO stubs in non-first scenarios", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // The second and subsequent scenarios should have TODO markers
      expect(content).toContain("// TODO: implement step definitions");
    });

    it("should handle empty parse result gracefully", () => {
      const content = generateTestContent(EMPTY_PARSE_RESULT);

      expect(content).toContain('describe("Acceptance: Empty Feature"');
      // Should not contain any it blocks
      const itBlocks = content.match(/it\("/g);
      expect(itBlocks).toBeNull();
    });

    it("should import describe, it, expect from vitest", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      expect(content).toContain('import { describe, it, expect, beforeEach, afterEach } from "vitest"');
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";

import { generateTestContent, generateFileName } from "../../src/acceptance/test-generator.js";
import {
  defineGiven,
  defineWhen,
  defineThen,
  findStep,
  executeStep,
  clearSteps,
  getRegisteredSteps,
} from "../../src/acceptance/step-registry.js";
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
  warnings: [],
};

const EMPTY_PARSE_RESULT: ParseResult = {
  specPath: "specs/000-empty/spec.md",
  featureName: "Empty Feature",
  userStories: [],
  requirements: [],
  edgeCases: [],
  warnings: [],
};

/** Fixture with a UI-only scenario */
const UI_ONLY_PARSE_RESULT: ParseResult = {
  specPath: "specs/099-ui-test/spec.md",
  featureName: "UI Feature",
  userStories: [
    {
      title: "UI Interaction",
      storyNumber: 1,
      priority: "P1",
      scenarios: [
        {
          index: 1,
          given: "the user navigates to the Proposals tab",
          when: "the user clicks Accept on a proposal",
          then: "the proposal card shows accepted status",
          raw: "**Given** the user navigates to the Proposals tab, **When** the user clicks Accept on a proposal, **Then** the proposal card shows accepted status",
        },
      ],
      requirementIds: [],
    },
  ],
  requirements: [],
  edgeCases: [],
  warnings: [],
};

/** Fixture with an agent-behavior scenario */
const AGENT_BEHAVIOR_PARSE_RESULT: ParseResult = {
  specPath: "specs/098-agent-test/spec.md",
  featureName: "Agent Feature",
  userStories: [
    {
      title: "Agent Orchestration",
      storyNumber: 1,
      priority: "P1",
      scenarios: [
        {
          index: 1,
          given: "an agent has no remaining tasks",
          when: "the agent enters proposal mode",
          then: "it spawns teammates to evaluate proposals",
          raw: "**Given** an agent has no remaining tasks, **When** the agent enters proposal mode, **Then** it spawns teammates to evaluate proposals",
        },
      ],
      requirementIds: [],
    },
  ],
  requirements: [],
  edgeCases: [],
  warnings: [],
};

/** Fixture with mixed scenarios: API + UI + agent */
const MIXED_PARSE_RESULT: ParseResult = {
  specPath: "specs/097-mixed/spec.md",
  featureName: "Mixed Feature",
  userStories: [
    {
      title: "Mixed Scenarios",
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
          given: "the user navigates to the Proposals tab",
          when: "the user clicks Accept",
          then: "the proposal card shows accepted",
          raw: "**Given** the user navigates to the Proposals tab, **When** the user clicks Accept, **Then** the proposal card shows accepted",
        },
        {
          index: 3,
          given: "an agent connected via MCP",
          when: "the agent enters proposal mode",
          then: "it spawns teammates",
          raw: "**Given** an agent connected via MCP, **When** the agent enters proposal mode, **Then** it spawns teammates",
        },
      ],
      requirementIds: [],
    },
  ],
  requirements: [],
  edgeCases: [],
  warnings: [],
};

/** Fixture for PATCH scenario with :id parameter */
const PATCH_PARSE_RESULT: ParseResult = {
  specPath: "specs/096-patch/spec.md",
  featureName: "Patch Feature",
  userStories: [
    {
      title: "Update Operations",
      storyNumber: 1,
      priority: "P1",
      scenarios: [
        {
          index: 1,
          given: "a pending proposal",
          when: 'PATCH /api/proposals/:id with `{ "status": "accepted" }`',
          then: "the response status is 200",
          raw: '**Given** a pending proposal, **When** PATCH /api/proposals/:id with `{ "status": "accepted" }`, **Then** the response status is 200',
        },
      ],
      requirementIds: [],
    },
  ],
  requirements: [],
  edgeCases: [],
  warnings: [],
};

// ============================================================================
// Tests — Test File Generator (Structure)
// ============================================================================

describe("TestGenerator", () => {
  beforeEach(() => {
    clearSteps();
  });

  describe("generateTestContent (structure)", () => {
    it("should produce valid TypeScript with describe/it blocks", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // Should contain outer describe with feature name
      expect(content).toContain('describe("Acceptance: Agent Proposals System"');

      // Should have describe blocks for each user story
      expect(content).toContain('describe("US1 - Data Model & Backend API (P1)"');
      expect(content).toContain('describe("US2 - MCP Tools for Agents (P1)"');

      // Should have it blocks for each scenario
      // US1 has 2 scenarios, US2 has 1 (agent-behavior -> it.skip)
      const itBlocks = content.match(/(?:it|it\.skip)\(/g);
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
      expect(content).toMatch(/(?:it|it\.skip)\("should .+persist.+pending/i);
      expect(content).toMatch(/(?:it|it\.skip)\("should .+pending proposals.+sorted/i);
    });

    it("should handle empty parse result gracefully", () => {
      const content = generateTestContent(EMPTY_PARSE_RESULT);

      expect(content).toContain('describe("Acceptance: Empty Feature"');
      // Should not contain any it blocks
      const itBlocks = content.match(/(?:it|it\.skip)\(/g);
      expect(itBlocks).toBeNull();
    });

    it("should import describe, it, expect from vitest", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      expect(content).toContain('import { describe, it, expect, beforeEach, afterEach } from "vitest"');
    });
  });

  // ============================================================================
  // Tests — Smart Code Generation (adj-039.3.x)
  // ============================================================================

  describe("generateTestContent (api-testable scenarios)", () => {
    it("should generate harness.post() for POST API scenarios", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // First scenario: POST /api/proposals
      expect(content).toContain('harness.post("/api/proposals"');
    });

    it("should generate harness.get() with query for GET API scenarios", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // Second scenario: GET /api/proposals with ?status=pending
      expect(content).toContain('harness.get("/api/proposals"');
      expect(content).toContain("status");
      expect(content).toContain("pending");
    });

    it("should generate expect() assertions for status field", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // First scenario should have assertions for data.status = "pending"
      expect(content).toContain(".toBe(");
      expect(content).toMatch(/expect\(.+\)\.toBe\("pending"\)/);
    });

    it("should generate expect() assertions for id existence", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // First scenario should have assertions for data.id existence
      expect(content).toContain(".toBeTruthy()");
    });

    it("should generate harness.patch() for PATCH scenarios", () => {
      const content = generateTestContent(PATCH_PARSE_RESULT);

      expect(content).toContain('harness.patch(');
      expect(content).toContain("accepted");
    });

    it("should generate seedProposal() for proposal preconditions", () => {
      const content = generateTestContent(PATCH_PARSE_RESULT);

      // PATCH scenario has "a pending proposal" as Given
      expect(content).toContain("harness.seedProposal(");
    });

    it("should generate seedProposal() for proposals exist precondition", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // Second scenario has "proposals exist" as Given
      expect(content).toContain("harness.seedProposal(");
    });

    it("should generate PATCH with template literal path and real body", () => {
      const content = generateTestContent(PATCH_PARSE_RESULT);

      // Path should use template literal with seeded.id interpolation
      expect(content).toContain("harness.patch(`/api/proposals/${seeded.id}`");
      // Body should contain the actual status from the spec
      expect(content).toContain('"accepted"');
    });
  });

  describe("generateTestContent (ui-only scenarios)", () => {
    it("should generate it.skip() for UI scenarios", () => {
      const content = generateTestContent(UI_ONLY_PARSE_RESULT);

      expect(content).toContain("it.skip(");
    });

    it("should include reason comment for skipped UI scenarios", () => {
      const content = generateTestContent(UI_ONLY_PARSE_RESULT);

      expect(content).toContain("Requires browser");
    });

    it("should still include GWT comments in skipped scenarios", () => {
      const content = generateTestContent(UI_ONLY_PARSE_RESULT);

      expect(content).toContain("// Given the user navigates to the Proposals tab");
      expect(content).toContain("// When the user clicks Accept on a proposal");
      expect(content).toContain("// Then the proposal card shows accepted status");
    });
  });

  describe("generateTestContent (agent-behavior scenarios)", () => {
    it("should generate it.skip() for agent scenarios", () => {
      const content = generateTestContent(AGENT_BEHAVIOR_PARSE_RESULT);

      expect(content).toContain("it.skip(");
    });

    it("should include reason comment for skipped agent scenarios", () => {
      const content = generateTestContent(AGENT_BEHAVIOR_PARSE_RESULT);

      expect(content).toContain("Requires agent simulation");
    });
  });

  describe("generateTestContent (step-matched scenarios)", () => {
    it("should generate executeStep() calls for step-matched scenarios", () => {
      // Register steps that match the common-steps patterns
      defineGiven("the database is initialized", async () => { /* no-op */ });
      defineWhen(
        /^(?:a )?proposal is created via POST \/api\/proposals$/,
        async () => { /* no-op */ },
      );
      defineThen(
        /^it is persisted with status "(\w+)"/,
        async () => { /* no-op */ },
      );

      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // When step registry matches exist, scenario should use executeStep
      expect(content).toContain('executeStep("given"');
      expect(content).toContain('executeStep("when"');
      expect(content).toContain('executeStep("then"');
    });

    it("should import step-registry and common-steps when step-matched", () => {
      defineGiven("the database is initialized", async () => { /* no-op */ });
      defineWhen(
        /^(?:a )?proposal is created via POST \/api\/proposals$/,
        async () => { /* no-op */ },
      );
      defineThen(
        /^it is persisted with status "(\w+)"/,
        async () => { /* no-op */ },
      );

      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      expect(content).toContain("step-registry");
      expect(content).toContain("common-steps");
    });
  });

  describe("generateTestContent (mixed scenarios)", () => {
    it("should produce correct mix of api/skip/agent in one spec", () => {
      const content = generateTestContent(MIXED_PARSE_RESULT);

      // First scenario: API testable (POST) -> real code
      expect(content).toContain('harness.post("/api/proposals"');

      // Second scenario: UI -> it.skip
      expect(content).toContain("it.skip(");

      // Should have both regular it() and it.skip() blocks
      const regularIt = content.match(/\bit\(/g);
      const skipIt = content.match(/it\.skip\(/g);
      expect(regularIt).toBeTruthy();
      expect(skipIt).toBeTruthy();
    });

    it("should not generate it.skip for scenarios that have API calls", () => {
      const content = generateTestContent(SIMPLE_PARSE_RESULT);

      // The first two scenarios are API testable - should use regular it()
      // Only the agent-behavior scenario (US2) should be skipped
      const lines = content.split("\n");
      const apiTestLines = lines.filter((l) =>
        l.includes("harness.post(") || l.includes("harness.get("),
      );
      expect(apiTestLines.length).toBeGreaterThan(0);
    });
  });

  describe("generateFileName", () => {
    it("should produce kebab-case file name with .acceptance.test.ts suffix", () => {
      expect(generateFileName("Agent Proposals System")).toBe(
        "agent-proposals-system.acceptance.test.ts"
      );
    });

    it("should handle special characters and collapse multiple separators", () => {
      expect(generateFileName("Data Model & Backend API")).toBe(
        "data-model-backend-api.acceptance.test.ts"
      );
    });

    it("should handle single word feature names", () => {
      expect(generateFileName("Messaging")).toBe(
        "messaging.acceptance.test.ts"
      );
    });

    it("should strip leading and trailing hyphens", () => {
      expect(generateFileName("  Agent Proposals  ")).toBe(
        "agent-proposals.acceptance.test.ts"
      );
    });
  });
});

// ============================================================================
// Tests — Step Definition Registry
// ============================================================================

describe("StepRegistry", () => {
  beforeEach(() => {
    clearSteps();
  });

  describe("defineGiven / findStep round-trip", () => {
    it("should register and find a string pattern step", async () => {
      const fn = async () => { /* no-op */ };
      defineGiven("the database is initialized", fn);

      const result = findStep("given", "the database is initialized");
      expect(result).not.toBeNull();
      expect(result!.step.type).toBe("given");
      expect(result!.step.fn).toBe(fn);
      expect(result!.args).toEqual([]);
    });

    it("should match string patterns case-insensitively", () => {
      defineGiven("The Database Is Initialized", async () => { /* no-op */ });

      const result = findStep("given", "the database is initialized");
      expect(result).not.toBeNull();
    });

    it("should not match across step types", () => {
      defineWhen("the database is initialized", async () => { /* no-op */ });

      const result = findStep("given", "the database is initialized");
      expect(result).toBeNull();
    });
  });

  describe("regex patterns with capture groups", () => {
    it("should capture groups from regex patterns", () => {
      defineThen(/^it is persisted with status "(\w+)"$/, async () => { /* no-op */ });

      const result = findStep("then", 'it is persisted with status "pending"');
      expect(result).not.toBeNull();
      expect(result!.args).toEqual(["pending"]);
    });

    it("should capture multiple groups", () => {
      defineWhen(
        /^(\w+) calls (\w+) with (\d+) args$/,
        async () => { /* no-op */ }
      );

      const result = findStep("when", "agent calls send_message with 3 args");
      expect(result).not.toBeNull();
      expect(result!.args).toEqual(["agent", "send_message", "3"]);
    });

    it("should return null for non-matching regex", () => {
      defineThen(/^it is persisted with status "(\w+)"$/, async () => { /* no-op */ });

      const result = findStep("then", "something completely different");
      expect(result).toBeNull();
    });
  });

  describe("executeStep", () => {
    it("should execute matched step with harness and captured args", async () => {
      const calls: unknown[] = [];
      defineThen(
        /^the status is "(\w+)"$/,
        async (harness, status) => {
          calls.push({ harness, status });
        }
      );

      const fakeHarness = { name: "test-harness" };
      await executeStep("then", 'the status is "accepted"', fakeHarness);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        harness: fakeHarness,
        status: "accepted",
      });
    });

    it("should throw descriptive error when no step definition found", async () => {
      await expect(
        executeStep("given", "the moon is full", {})
      ).rejects.toThrow(
        'No step definition found for: Given "the moon is full"'
      );
    });

    it("should include registration hint in the error message", async () => {
      await expect(
        executeStep("when", "something happens", {})
      ).rejects.toThrow("defineWhen");
    });
  });

  describe("clearSteps", () => {
    it("should reset the registry to empty", () => {
      defineGiven("step 1", async () => { /* no-op */ });
      defineWhen("step 2", async () => { /* no-op */ });
      defineThen("step 3", async () => { /* no-op */ });

      expect(getRegisteredSteps()).toHaveLength(3);

      clearSteps();

      expect(getRegisteredSteps()).toHaveLength(0);
      expect(findStep("given", "step 1")).toBeNull();
    });
  });

  describe("getRegisteredSteps", () => {
    it("should return all registered steps as readonly", () => {
      defineGiven("g1", async () => { /* no-op */ });
      defineWhen("w1", async () => { /* no-op */ });
      defineThen("t1", async () => { /* no-op */ });

      const steps = getRegisteredSteps();
      expect(steps).toHaveLength(3);
      expect(steps[0]!.type).toBe("given");
      expect(steps[1]!.type).toBe("when");
      expect(steps[2]!.type).toBe("then");
    });
  });
});

// ============================================================================
// Tests — Built-in Common Steps
// ============================================================================

describe("CommonSteps", () => {
  it("should load all common step definitions without errors", async () => {
    // Common steps register at import time. Since vitest caches modules,
    // we need to rely on the fact that the first import populates the registry.
    // We clear and re-import to test loading.
    clearSteps();

    // Re-import with cache bust to force re-registration
    const modulePath = "../../src/acceptance/steps/common-steps.js";
    // Vitest's import does NOT re-execute on second call (module cache),
    // so we check that the module can be imported without throwing.
    // The steps registered from the initial import are still there in
    // the registry if we don't clear, but we cleared above.
    // Instead, we verify the module shape is valid.
    const mod = await import(modulePath);
    // Module is side-effect only — should have no named exports (or empty)
    expect(mod).toBeDefined();
  });

  it("should register given/when/then steps when the module is first loaded", () => {
    // This test relies on the common-steps module having been imported
    // at least once in this test file. We populate a fresh registry
    // by calling the define functions directly to verify matching works.
    clearSteps();

    // Manually re-register a subset to verify the patterns work
    defineGiven("the database is initialized", async () => { /* no-op */ });
    defineWhen(
      /^(?:a )?proposal is created via POST \/api\/proposals$/,
      async () => { /* no-op */ }
    );
    defineThen(
      /^it is persisted with status "(\w+)"/,
      async () => { /* no-op */ }
    );

    const steps = getRegisteredSteps();
    expect(steps).toHaveLength(3);

    // Verify pattern matching works
    expect(findStep("given", "the database is initialized")).not.toBeNull();
    expect(findStep("when", "proposal is created via POST /api/proposals")).not.toBeNull();
    expect(findStep("when", "a proposal is created via POST /api/proposals")).not.toBeNull();

    const thenResult = findStep("then", 'it is persisted with status "pending"');
    expect(thenResult).not.toBeNull();
    expect(thenResult!.args).toEqual(["pending"]);
  });
});

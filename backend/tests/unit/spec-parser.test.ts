import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { parseSpecContent } from "../../src/acceptance/spec-parser.js";
import type { ParseResult } from "../../src/acceptance/types.js";

// ============================================================================
// Test fixtures — inline spec content for deterministic tests
// ============================================================================

const VALID_SPEC = `# Feature Specification: Agent Messaging System

**Feature Branch**: \`008-agent-messaging\`
**Created**: 2026-01-15
**Status**: Draft

## Overview

A messaging system for agents.

## User Scenarios & Testing

### User Story 1 - Send Messages (Priority: P1)

Agents can send messages to each other.

**Acceptance Scenarios**:

1. **Given** an agent is connected via MCP, **When** it calls send_message with to and body, **Then** the message is persisted in SQLite
2. **Given** a message exists, **When** the recipient calls read_messages, **Then** the message appears in the response

---

### User Story 2 - Message Threading (Priority: P2)

Messages can be grouped into threads.

**Acceptance Scenarios**:

1. **Given** a message with threadId "t1", **When** another message is sent with threadId "t1", **Then** both messages appear in the same thread
2. **Given** multiple threads exist, **When** list_threads is called, **Then** all thread IDs are returned with message counts
3. **Given** a thread with 5 messages, **When** read_messages is called with threadId "t1" and limit 2, **Then** only the 2 newest messages are returned

---

### Edge Cases

- What happens when a message is sent to a non-existent agent? Return success but mark delivery as pending.
- What happens when the database is full? Return a structured error with code "storage_full".

## Requirements

### Functional Requirements

- **FR-001**: System MUST persist messages in SQLite with id, from, to, body, threadId, createdAt
- **FR-002**: System MUST support cursor-based pagination for message retrieval
- **FR-003**: System MUST resolve agent identity server-side via MCP session
`;

const MULTI_LINE_SCENARIO_SPEC = `# Feature Specification: Multi-line Test

## User Scenarios & Testing

### User Story 1 - Complex Scenario (Priority: P1)

A story with multi-line scenarios.

**Acceptance Scenarios**:

1. **Given** the database is initialized with a fresh schema
and all tables are created, **When** a proposal is created
via POST /api/proposals with a valid JSON body containing title and description,
**Then** it is persisted with status "pending" and a generated UUID
that can be retrieved via GET /api/proposals/:id
2. **Given** a simple precondition, **When** action happens, **Then** result occurs
`;

const EMPTY_SPEC = `# Feature Specification: Empty Feature

## Overview

Nothing here yet.
`;

const MALFORMED_GWT_SPEC = `# Feature Specification: Malformed Test

## User Scenarios & Testing

### User Story 1 - Bad Scenarios (Priority: P1)

Some bad scenarios.

**Acceptance Scenarios**:

1. **Given** a precondition, **When** something happens, **Then** result is good
2. **Given** only a given clause with no when or then
3. **Given** another precondition, **Then** missing the when clause
4. **Given** valid given, **When** valid when, **Then** valid then
`;

const PARTIAL_SPEC = `# Feature Specification: Partial Spec

## User Scenarios & Testing

### User Story 1 - Only Stories (Priority: P3)

A story with scenarios but no requirements or edge cases.

**Acceptance Scenarios**:

1. **Given** setup is done, **When** action runs, **Then** expected result
`;

const FR_REFERENCE_SPEC = `# Feature Specification: FR Reference Test

## User Scenarios & Testing

### User Story 1 - Data Layer (Priority: P1)

Implements FR-001 and FR-003 for data persistence.

**Acceptance Scenarios**:

1. **Given** a fresh database (FR-001), **When** a record is inserted, **Then** it persists correctly
2. **Given** records exist, **When** queried with pagination (FR-002), **Then** cursor-based results are returned

---

### User Story 2 - API Layer (Priority: P1)

Implements FR-002 and FR-003 endpoints.

**Acceptance Scenarios**:

1. **Given** the API server is running, **When** GET /api/items is called (FR-003), **Then** items are returned

## Requirements

### Functional Requirements

- **FR-001**: System MUST persist data in SQLite
- **FR-002**: System MUST support cursor-based pagination
- **FR-003**: System MUST expose REST API endpoints
`;

// ============================================================================
// Tests
// ============================================================================

describe("SpecParser", () => {
  describe("parseSpecContent", () => {
    it("should parse a valid spec with multiple user stories and scenarios", () => {
      const result = parseSpecContent(VALID_SPEC, "test/spec.md");

      expect(result.specPath).toBe("test/spec.md");
      expect(result.featureName).toBe("Agent Messaging System");
      expect(result.userStories).toHaveLength(2);

      // User Story 1
      const us1 = result.userStories[0]!;
      expect(us1.title).toBe("Send Messages");
      expect(us1.storyNumber).toBe(1);
      expect(us1.priority).toBe("P1");
      expect(us1.scenarios).toHaveLength(2);

      // Scenario 1 of US1
      const s1 = us1.scenarios[0]!;
      expect(s1.index).toBe(1);
      expect(s1.given).toBe("an agent is connected via MCP");
      expect(s1.when).toBe("it calls send_message with to and body");
      expect(s1.then).toBe("the message is persisted in SQLite");
      expect(s1.raw).toContain("Given");
      expect(s1.raw).toContain("When");
      expect(s1.raw).toContain("Then");

      // Scenario 2 of US1
      const s2 = us1.scenarios[1]!;
      expect(s2.index).toBe(2);
      expect(s2.given).toBe("a message exists");
      expect(s2.when).toBe("the recipient calls read_messages");
      expect(s2.then).toBe("the message appears in the response");

      // User Story 2
      const us2 = result.userStories[1]!;
      expect(us2.title).toBe("Message Threading");
      expect(us2.storyNumber).toBe(2);
      expect(us2.priority).toBe("P2");
      expect(us2.scenarios).toHaveLength(3);
    });

    it("should handle multi-line scenarios", () => {
      const result = parseSpecContent(MULTI_LINE_SCENARIO_SPEC, "test/spec.md");

      expect(result.userStories).toHaveLength(1);
      const us1 = result.userStories[0]!;
      expect(us1.scenarios).toHaveLength(2);

      // Multi-line scenario should be joined
      const s1 = us1.scenarios[0]!;
      expect(s1.given).toContain("the database is initialized");
      expect(s1.given).toContain("all tables are created");
      expect(s1.when).toContain("a proposal is created");
      expect(s1.when).toContain("valid JSON body");
      expect(s1.then).toContain("persisted with status");
      expect(s1.then).toContain("retrieved via GET");
    });

    it("should handle empty spec with no user stories", () => {
      const result = parseSpecContent(EMPTY_SPEC, "test/empty.md");

      expect(result.specPath).toBe("test/empty.md");
      expect(result.featureName).toBe("Empty Feature");
      expect(result.userStories).toEqual([]);
      expect(result.requirements).toEqual([]);
      expect(result.edgeCases).toEqual([]);
    });

    it("should handle malformed GWT by skipping invalid scenarios", () => {
      const result = parseSpecContent(MALFORMED_GWT_SPEC, "test/bad.md");

      expect(result.userStories).toHaveLength(1);
      const us1 = result.userStories[0]!;

      // Only valid scenarios should be kept (items 1 and 4)
      // Items 2 (no When/Then) and 3 (no When) should be skipped
      expect(us1.scenarios).toHaveLength(2);
      expect(us1.scenarios[0]!.given).toBe("a precondition");
      expect(us1.scenarios[0]!.then).toBe("result is good");
      expect(us1.scenarios[1]!.given).toBe("valid given");
      expect(us1.scenarios[1]!.then).toBe("valid then");
    });

    it("should extract FR-xxx requirements correctly", () => {
      const result = parseSpecContent(VALID_SPEC, "test/spec.md");

      expect(result.requirements).toHaveLength(3);
      expect(result.requirements[0]!.id).toBe("FR-001");
      expect(result.requirements[0]!.text).toBe(
        "System MUST persist messages in SQLite with id, from, to, body, threadId, createdAt"
      );
      expect(result.requirements[1]!.id).toBe("FR-002");
      expect(result.requirements[2]!.id).toBe("FR-003");
    });

    it("should map FR references in scenarios and story text back to requirements", () => {
      const result = parseSpecContent(FR_REFERENCE_SPEC, "test/spec.md");

      expect(result.requirements).toHaveLength(3);

      // FR-001 is referenced in US1 description and scenario text
      const fr001 = result.requirements.find((r) => r.id === "FR-001")!;
      expect(fr001.coveredByStories).toContain(1);

      // FR-002 is referenced in US1 scenario and US2 description
      const fr002 = result.requirements.find((r) => r.id === "FR-002")!;
      expect(fr002.coveredByStories).toContain(1);
      expect(fr002.coveredByStories).toContain(2);

      // FR-003 is referenced in US1 description and US2 description/scenario
      const fr003 = result.requirements.find((r) => r.id === "FR-003")!;
      expect(fr003.coveredByStories).toContain(1);
      expect(fr003.coveredByStories).toContain(2);
    });

    it("should parse edge cases section", () => {
      const result = parseSpecContent(VALID_SPEC, "test/spec.md");

      expect(result.edgeCases).toHaveLength(2);
      expect(result.edgeCases[0]).toContain("non-existent agent");
      expect(result.edgeCases[1]).toContain("database is full");
    });

    it("should handle spec with only some sections present", () => {
      const result = parseSpecContent(PARTIAL_SPEC, "test/spec.md");

      expect(result.featureName).toBe("Partial Spec");
      expect(result.userStories).toHaveLength(1);
      expect(result.userStories[0]!.priority).toBe("P3");
      expect(result.requirements).toEqual([]);
      expect(result.edgeCases).toEqual([]);
    });

    it("should populate requirementIds on user stories from scenario FR references", () => {
      const result = parseSpecContent(FR_REFERENCE_SPEC, "test/spec.md");

      const us1 = result.userStories[0]!;
      expect(us1.requirementIds).toContain("FR-001");
      expect(us1.requirementIds).toContain("FR-002");
      expect(us1.requirementIds).toContain("FR-003");

      const us2 = result.userStories[1]!;
      expect(us2.requirementIds).toContain("FR-002");
      expect(us2.requirementIds).toContain("FR-003");
    });
  });

  describe("parseSpecContent — real spec integration", () => {
    it("should parse the real specs/017-agent-proposals/spec.md", () => {
      // Read the actual spec file from the repo
      const specPath = join(
        process.cwd(),
        "..",
        "specs",
        "017-agent-proposals",
        "spec.md"
      );
      let content: string;
      try {
        content = readFileSync(specPath, "utf-8");
      } catch {
        // If running from a different cwd, try absolute path
        const altPath = join(
          "/Users/Reason/code/ai/adjutant",
          "specs",
          "017-agent-proposals",
          "spec.md"
        );
        content = readFileSync(altPath, "utf-8");
      }

      const result = parseSpecContent(content, specPath);

      // Basic structure
      expect(result.featureName).toBe("Agent Proposals System");
      expect(result.userStories.length).toBeGreaterThanOrEqual(4);

      // US1 — Data Model & Backend API
      const us1 = result.userStories[0]!;
      expect(us1.title).toBe("Data Model & Backend API");
      expect(us1.storyNumber).toBe(1);
      expect(us1.priority).toBe("P1");
      expect(us1.scenarios).toHaveLength(4);

      // Check a specific scenario
      expect(us1.scenarios[0]!.given).toContain("database is initialized");
      expect(us1.scenarios[0]!.when).toContain("POST /api/proposals");
      expect(us1.scenarios[0]!.then).toContain("persisted with status");

      // US2 — MCP Tools for Agents
      // Note: scenario 3 in the real spec is malformed (missing **When**),
      // so the parser correctly skips it, yielding 2 valid scenarios
      const us2 = result.userStories[1]!;
      expect(us2.title).toBe("MCP Tools for Agents");
      expect(us2.scenarios).toHaveLength(2);

      // Requirements
      expect(result.requirements.length).toBeGreaterThanOrEqual(10);
      expect(result.requirements[0]!.id).toBe("FR-001");

      // Edge cases
      expect(result.edgeCases.length).toBeGreaterThanOrEqual(3);
    });
  });
});

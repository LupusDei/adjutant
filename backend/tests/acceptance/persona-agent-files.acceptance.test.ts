/**
 * Acceptance Tests: Persona Agent Files
 * Generated from: /Users/Reason/code/ai/adjutant/.claude/worktrees/agent-ad5a6715/specs/036-persona-agent-files/spec.md
 *
 * DO NOT EDIT GENERATED STRUCTURE — add step implementations only.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { TestHarness } from "../../src/acceptance/test-harness.js";

describe("Acceptance: Persona Agent Files", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = new TestHarness();
    await harness.setup();
  });

  afterEach(async () => {
    await harness.destroy();
  });

  describe("US1 - Deploy Persona as Claude Agent (P1)", () => {
    it.skip("should `.claude/agents/sentinel.md` is written to...", () => {
      // AUTO-GENERATED
      // Requires agent simulation — not API-testable
      // Given a persona "Sentinel" exists
      // When user deploys it to project `/code/myapp`
      // Then `.claude/agents/sentinel.md` is written to `/code/myapp/.claude/agents/` and Claude starts with `--agent sentinel`
    });

    it.skip("should agent file is written as `qa-lead.md` (kebab-case, lowercase)", () => {
      // AUTO-GENERATED
      // Requires agent simulation — not API-testable
      // Given a persona name contains spaces/caps "QA Lead"
      // When deployed
      // Then agent file is written as `qa-lead.md` (kebab-case, lowercase)
    });

    it("should directory is created automatically", async () => {
      // AUTO-GENERATED
      // TODO: implement step definitions
      // Given `.claude/agents/` directory doesn't exist in the target project
      // When persona is deployed
      // Then directory is created automatically
    });

    it.skip("should agent file is overwritten with the latest prompt (idempotent)", () => {
      // AUTO-GENERATED
      // Requires agent simulation — not API-testable
      // Given a persona is deployed twice to the same project
      // When the second deploy happens
      // Then the agent file is overwritten with the latest prompt (idempotent)
    });

  });
});

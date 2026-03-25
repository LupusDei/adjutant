import { describe, it, expect } from "vitest";

import { buildEscalationMessage } from "../../src/services/escalation-builder.js";
import type { LowConfidenceProposal } from "../../src/services/escalation-builder.js";

describe("buildEscalationMessage", () => {
  it("should build a message for a single low-confidence proposal", () => {
    const proposals: LowConfidenceProposal[] = [
      {
        id: "prop-1",
        title: "Add dark mode toggle",
        confidenceScore: 45,
        primaryConcern: "Unclear if users want this feature",
      },
    ];

    const result = buildEscalationMessage("adjutant", proposals);

    expect(result.title).toBe("Vision Update Needed — Project: adjutant");
    expect(result.projectName).toBe("adjutant");
    expect(result.proposalIds).toEqual(["prop-1"]);
    expect(result.body).toContain("1 proposal(s)");
    expect(result.body).toContain('"Add dark mode toggle"');
    expect(result.body).toContain("Score: 45");
    expect(result.body).toContain("Unclear if users want this feature");
    expect(result.body).toContain("Reply with guidance or disable auto-develop to pause.");
  });

  it("should build a message for multiple low-confidence proposals", () => {
    const proposals: LowConfidenceProposal[] = [
      {
        id: "prop-1",
        title: "Refactor auth module",
        confidenceScore: 42,
        primaryConcern: "Architecture direction unclear",
      },
      {
        id: "prop-2",
        title: "Add notification system",
        confidenceScore: 55,
        primaryConcern: "Scope too large without guidance",
      },
      {
        id: "prop-3",
        title: "Migrate to PostgreSQL",
        confidenceScore: 41,
        primaryConcern: "Major infrastructure change needs approval",
      },
    ];

    const result = buildEscalationMessage("my-app", proposals);

    expect(result.title).toBe("Vision Update Needed — Project: my-app");
    expect(result.projectName).toBe("my-app");
    expect(result.proposalIds).toEqual(["prop-1", "prop-2", "prop-3"]);
    expect(result.body).toContain("3 proposal(s)");
    // Verify ordering
    expect(result.body).toContain('1. "Refactor auth module"');
    expect(result.body).toContain('2. "Add notification system"');
    expect(result.body).toContain('3. "Migrate to PostgreSQL"');
    // Verify all scores present
    expect(result.body).toContain("Score: 42");
    expect(result.body).toContain("Score: 55");
    expect(result.body).toContain("Score: 41");
  });

  it("should handle empty proposals list gracefully", () => {
    const result = buildEscalationMessage("empty-project", []);

    expect(result.title).toBe("Vision Update Needed — Project: empty-project");
    expect(result.projectName).toBe("empty-project");
    expect(result.proposalIds).toEqual([]);
    expect(result.body).toContain("0 proposal(s)");
    expect(result.body).toContain("What would help:");
  });

  it("should handle proposals with long titles", () => {
    const longTitle = "A".repeat(200);
    const proposals: LowConfidenceProposal[] = [
      {
        id: "prop-long",
        title: longTitle,
        confidenceScore: 50,
        primaryConcern: "Title is very long",
      },
    ];

    const result = buildEscalationMessage("test-project", proposals);

    expect(result.proposalIds).toEqual(["prop-long"]);
    expect(result.body).toContain(`"${longTitle}"`);
    expect(result.body).toContain("Score: 50");
  });

  it("should include actionable guidance in the body", () => {
    const proposals: LowConfidenceProposal[] = [
      {
        id: "prop-1",
        title: "Test proposal",
        confidenceScore: 48,
        primaryConcern: "Needs direction",
      },
    ];

    const result = buildEscalationMessage("adjutant", proposals);

    expect(result.body).toContain("Clarify product direction");
    expect(result.body).toContain("Confirm or reject the proposed approaches");
    expect(result.body).toContain("Provide updated vision context via the dashboard or MCP");
  });
});

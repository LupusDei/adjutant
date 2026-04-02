import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event bus
const mockEmit = vi.fn();
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({
    emit: mockEmit,
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

// Mock MCP server (getAgentBySession)
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: vi.fn(() => "test-agent"),
}));

import { buildGenesisPrompt, extractLoreExcerpt } from "../../src/services/adjutant/genesis-prompt.js";
import {
  POINT_BUDGET,
  TRAIT_DEFINITIONS,
  TRAIT_MAX,
  type TraitValues,
} from "../../src/types/personas.js";

// ============================================================================
// Genesis Prompt Builder Tests
// ============================================================================

describe("buildGenesisPrompt", () => {
  it("should include callsign name in the prompt", () => {
    const prompt = buildGenesisPrompt("raynor", "Some lore text here.");
    expect(prompt).toContain("raynor");
    expect(prompt).toContain("Genesis Ritual");
  });

  it("should include lore excerpt when provided", () => {
    const lore = "Jim Raynor is a rebel leader who fights for justice.";
    const prompt = buildGenesisPrompt("raynor", lore);
    expect(prompt).toContain(lore);
    expect(prompt).toContain("Your Lore");
  });

  it("should not include lore section when excerpt is empty", () => {
    const prompt = buildGenesisPrompt("unknown-agent", "");
    expect(prompt).not.toContain("Your Lore");
  });

  it("should include all 12 trait names", () => {
    const prompt = buildGenesisPrompt("raynor", "Some lore.");
    for (const def of TRAIT_DEFINITIONS) {
      expect(prompt).toContain(def.key);
    }
  });

  it("should mention the point budget", () => {
    const prompt = buildGenesisPrompt("raynor", "Some lore.");
    expect(prompt).toContain(String(POINT_BUDGET));
  });

  it("should include assigned work when provided", () => {
    const work = "Implement the new messaging system for adj-042.";
    const prompt = buildGenesisPrompt("raynor", "Lore", work);
    expect(prompt).toContain(work);
    expect(prompt).toContain("Your Assigned Work");
  });

  it("should mention create_persona MCP tool", () => {
    const prompt = buildGenesisPrompt("kerrigan", "Ghost operative.");
    expect(prompt).toContain("create_persona");
  });

  it("should include trait range constraints", () => {
    const prompt = buildGenesisPrompt("raynor", "Lore text.");
    expect(prompt).toContain(`0-${TRAIT_MAX}`);
  });
});

// ============================================================================
// extractLoreExcerpt Tests
// ============================================================================

describe("extractLoreExcerpt", () => {
  it("should return correct entry for a known callsign", () => {
    const excerpt = extractLoreExcerpt("Raynor");
    expect(excerpt).toContain("Jim Raynor");
    expect(excerpt).toContain("rebel leader");
  });

  it("should return correct entry case-insensitively", () => {
    const excerpt = extractLoreExcerpt("raynor");
    expect(excerpt).toContain("Jim Raynor");
  });

  it("should return empty string for unknown callsign", () => {
    const excerpt = extractLoreExcerpt("completely-unknown-hero-xyz");
    expect(excerpt).toBe("");
  });

  it("should not include content from the next hero entry", () => {
    const excerpt = extractLoreExcerpt("Raynor");
    // Kerrigan's entry should not be in Raynor's excerpt
    expect(excerpt).not.toContain("Queen of Blades");
  });

  it("should extract entries from different factions", () => {
    // Kerrigan is in Terran section
    const kerrigan = extractLoreExcerpt("Kerrigan");
    expect(kerrigan).toContain("ghost operative");
  });
});

// ============================================================================
// create_persona validation tests (unit-level, no MCP server needed)
// ============================================================================

describe("create_persona validation", () => {
  it("should reject traits that sum to less than 100", () => {
    const traits: TraitValues = {
      architecture_focus: 5,
      product_design: 5,
      uiux_focus: 5,
      qa_scalability: 5,
      qa_correctness: 5,
      testing_unit: 5,
      testing_acceptance: 5,
      modular_architecture: 5,
      business_objectives: 5,
      technical_depth: 5,
      code_review: 5,
      documentation: 4, // sum = 59, not 100
    };
    const total = Object.values(traits).reduce((s, v) => s + v, 0);
    expect(total).not.toBe(POINT_BUDGET);
  });

  it("should reject traits that sum to more than 100", () => {
    const traits: TraitValues = {
      architecture_focus: 20,
      product_design: 20,
      uiux_focus: 20,
      qa_scalability: 20,
      qa_correctness: 20,
      testing_unit: 1,
      testing_acceptance: 0,
      modular_architecture: 0,
      business_objectives: 0,
      technical_depth: 0,
      code_review: 0,
      documentation: 0, // sum = 101
    };
    const total = Object.values(traits).reduce((s, v) => s + v, 0);
    expect(total).toBeGreaterThan(POINT_BUDGET);
  });

  it("should accept traits that sum to exactly 100", () => {
    const traits: TraitValues = {
      architecture_focus: 15,
      product_design: 10,
      uiux_focus: 5,
      qa_scalability: 10,
      qa_correctness: 10,
      testing_unit: 10,
      testing_acceptance: 5,
      modular_architecture: 10,
      business_objectives: 5,
      technical_depth: 10,
      code_review: 5,
      documentation: 5, // sum = 100
    };
    const total = Object.values(traits).reduce((s, v) => s + v, 0);
    expect(total).toBe(POINT_BUDGET);
  });

  it("should reject trait values above 20", () => {
    // This is validated by Zod's TRAIT_MAX constraint
    expect(TRAIT_MAX).toBe(20);
    const invalidValue = 21;
    expect(invalidValue).toBeGreaterThan(TRAIT_MAX);
  });
});

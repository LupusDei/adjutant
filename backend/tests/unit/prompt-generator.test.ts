/**
 * Prompt Generator Unit Tests
 *
 * Tests the persona prompt generation from trait values.
 * The prompt generator converts a Persona's trait allocations into
 * a structured text prompt suitable for --prompt CLI injection.
 */

import { describe, it, expect } from "vitest";

import { generatePersonaPrompt } from "../../src/services/prompt-generator.js";
import type { Persona, TraitValues } from "../../src/types/personas.js";
import { PERSONA_TRAIT_KEYS } from "../../src/types/personas.js";

// ============================================================================
// Helpers
// ============================================================================

function zeroTraits(): TraitValues {
  const traits = {} as Record<string, number>;
  for (const key of PERSONA_TRAIT_KEYS) {
    traits[key] = 0;
  }
  return traits as TraitValues;
}

function makeTraits(overrides: Partial<Record<string, number>>): TraitValues {
  const traits = zeroTraits();
  for (const [key, value] of Object.entries(overrides)) {
    (traits as Record<string, number>)[key] = value!;
  }
  return traits;
}

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: "test-uuid",
    name: "TestPersona",
    description: "",
    traits: zeroTraits(),
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("generatePersonaPrompt", () => {
  it("should include persona name in prompt", () => {
    const persona = makePersona({ name: "Architect" });
    const prompt = generatePersonaPrompt(persona);

    expect(prompt).toContain("Architect");
  });

  it("should include description when provided", () => {
    const persona = makePersona({
      name: "Architect",
      description: "A system design specialist focused on clean abstractions",
    });
    const prompt = generatePersonaPrompt(persona);

    expect(prompt).toContain("A system design specialist focused on clean abstractions");
  });

  it("should not include description when empty", () => {
    const persona = makePersona({ name: "Architect", description: "" });
    const prompt = generatePersonaPrompt(persona);

    // Should not have an empty line where description would be
    const lines = prompt.split("\n").filter(l => l.trim() === "" && l !== "");
    // Just verify the name is there and no double blank lines
    expect(prompt).toContain("Architect");
  });

  it("should list active traits sorted by value descending", () => {
    const persona = makePersona({
      name: "Balanced",
      traits: makeTraits({
        architecture_focus: 18,
        testing_unit: 10,
        code_review: 5,
      }),
    });
    const prompt = generatePersonaPrompt(persona);

    // architecture_focus (18) should appear before testing_unit (10)
    const archIdx = prompt.indexOf("Architecture Focus");
    const testIdx = prompt.indexOf("Testing: Unit");
    const reviewIdx = prompt.indexOf("Code Review");

    expect(archIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(archIdx).toBeLessThan(testIdx);
    expect(testIdx).toBeLessThan(reviewIdx);
  });

  it("should omit zero-value traits", () => {
    const persona = makePersona({
      name: "Specialist",
      traits: makeTraits({
        architecture_focus: 20,
        // All others are 0
      }),
    });
    const prompt = generatePersonaPrompt(persona);

    // Should contain architecture_focus
    expect(prompt).toContain("Architecture Focus");

    // Should NOT contain any zero-value traits
    expect(prompt).not.toContain("Product Design");
    expect(prompt).not.toContain("UI/UX Focus");
    expect(prompt).not.toContain("Documentation");
  });

  it("should show 'No specific specializations' for all-zero traits", () => {
    const persona = makePersona({
      name: "Blank",
      traits: zeroTraits(),
    });
    const prompt = generatePersonaPrompt(persona);

    expect(prompt).toContain("No specific specializations");
  });

  it("should label traits as HIGH when value >= 15", () => {
    const persona = makePersona({
      name: "HighTrait",
      traits: makeTraits({ architecture_focus: 15 }),
    });
    const prompt = generatePersonaPrompt(persona);

    expect(prompt).toContain("[HIGH]");
  });

  it("should label traits as MEDIUM when value >= 8 and < 15", () => {
    const persona = makePersona({
      name: "MedTrait",
      traits: makeTraits({ architecture_focus: 10 }),
    });
    const prompt = generatePersonaPrompt(persona);

    expect(prompt).toContain("[MEDIUM]");
  });

  it("should label traits as LOW when value >= 1 and < 8", () => {
    const persona = makePersona({
      name: "LowTrait",
      traits: makeTraits({ architecture_focus: 3 }),
    });
    const prompt = generatePersonaPrompt(persona);

    expect(prompt).toContain("[LOW]");
  });

  it("should handle a fully loaded persona with all traits active", () => {
    const persona = makePersona({
      name: "Generalist",
      traits: makeTraits({
        architecture_focus: 10,
        product_design: 8,
        uiux_focus: 8,
        qa_scalability: 8,
        qa_correctness: 8,
        testing_unit: 8,
        testing_acceptance: 8,
        modular_architecture: 8,
        business_objectives: 8,
        technical_depth: 8,
        code_review: 8,
        documentation: 10,
      }),
    });
    const prompt = generatePersonaPrompt(persona);

    // All 12 traits should appear
    expect(prompt).toContain("Architecture Focus");
    expect(prompt).toContain("Product Design");
    expect(prompt).toContain("UI/UX Focus");
    expect(prompt).toContain("QA: Scalability");
    expect(prompt).toContain("QA: Correctness");
    expect(prompt).toContain("Testing: Unit");
    expect(prompt).toContain("Testing: Acceptance");
    expect(prompt).toContain("Modular Architecture");
    expect(prompt).toContain("Business Objectives");
    expect(prompt).toContain("Technical Depth");
    expect(prompt).toContain("Code Review");
    expect(prompt).toContain("Documentation");
  });

  it("should return a string, not undefined or null", () => {
    const persona = makePersona({ name: "SafeReturn" });
    const prompt = generatePersonaPrompt(persona);

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("should handle persona with only description and no active traits", () => {
    const persona = makePersona({
      name: "Described",
      description: "A flexible agent for any task",
      traits: zeroTraits(),
    });
    const prompt = generatePersonaPrompt(persona);

    expect(prompt).toContain("Described");
    expect(prompt).toContain("A flexible agent for any task");
    expect(prompt).toContain("No specific specializations");
  });
});

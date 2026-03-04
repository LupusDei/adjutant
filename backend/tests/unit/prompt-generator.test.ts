import { describe, it, expect } from "vitest";

import type { Persona, TraitValues } from "../../src/types/personas.js";
import { PERSONA_TRAIT_KEYS } from "../../src/types/personas.js";
import {
  generatePrompt,
  getTier,
  TRAIT_PROMPT_TEMPLATES,
} from "../../src/services/prompt-generator.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a valid traits object with all zeros */
function zeroTraits(): TraitValues {
  const traits = {} as Record<string, number>;
  for (const key of PERSONA_TRAIT_KEYS) {
    traits[key] = 0;
  }
  return traits as TraitValues;
}

/** Create a valid traits object with specified values, rest zero */
function makeTraits(overrides: Partial<Record<string, number>>): TraitValues {
  const traits = zeroTraits();
  for (const [key, value] of Object.entries(overrides)) {
    (traits as Record<string, number>)[key] = value!;
  }
  return traits;
}

/** Create a full Persona object for testing */
function makePersona(
  overrides: Partial<Persona> & { traits?: TraitValues },
): Persona {
  return {
    id: overrides.id ?? "test-id-123",
    name: overrides.name ?? "TestAgent",
    description: overrides.description ?? "A test persona",
    traits: overrides.traits ?? zeroTraits(),
    createdAt: overrides.createdAt ?? "2026-03-04T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-04T00:00:00.000Z",
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe("PromptGenerator", () => {
  // ==========================================================================
  // Tier Selection
  // ==========================================================================

  describe("getTier", () => {
    it("should return 'zero' for value 0", () => {
      expect(getTier(0)).toBe("zero");
    });

    it("should return 'low' for values 1-7", () => {
      expect(getTier(1)).toBe("low");
      expect(getTier(4)).toBe("low");
      expect(getTier(7)).toBe("low");
    });

    it("should return 'medium' for values 8-14", () => {
      expect(getTier(8)).toBe("medium");
      expect(getTier(11)).toBe("medium");
      expect(getTier(14)).toBe("medium");
    });

    it("should return 'high' for values 15-20", () => {
      expect(getTier(15)).toBe("high");
      expect(getTier(18)).toBe("high");
      expect(getTier(20)).toBe("high");
    });

    it("should handle exact boundary values correctly", () => {
      // Verify every boundary transition
      expect(getTier(0)).toBe("zero");
      expect(getTier(1)).toBe("low");
      expect(getTier(7)).toBe("low");
      expect(getTier(8)).toBe("medium");
      expect(getTier(14)).toBe("medium");
      expect(getTier(15)).toBe("high");
      expect(getTier(20)).toBe("high");
    });
  });

  // ==========================================================================
  // TRAIT_PROMPT_TEMPLATES
  // ==========================================================================

  describe("TRAIT_PROMPT_TEMPLATES", () => {
    it("should have templates for all 12 traits", () => {
      for (const key of PERSONA_TRAIT_KEYS) {
        expect(TRAIT_PROMPT_TEMPLATES).toHaveProperty(key);
      }
    });

    it("should have low, medium, and high tiers for each trait", () => {
      for (const key of PERSONA_TRAIT_KEYS) {
        const template = TRAIT_PROMPT_TEMPLATES[key];
        expect(template).toHaveProperty("low");
        expect(template).toHaveProperty("medium");
        expect(template).toHaveProperty("high");
        expect(typeof template.low).toBe("string");
        expect(typeof template.medium).toBe("string");
        expect(typeof template.high).toBe("string");
        // Each tier should be non-empty
        expect(template.low.length).toBeGreaterThan(0);
        expect(template.medium.length).toBeGreaterThan(0);
        expect(template.high.length).toBeGreaterThan(0);
      }
    });

    it("should have progressively longer/stronger text from low to high", () => {
      // High tier should be more detailed than low tier for each trait
      for (const key of PERSONA_TRAIT_KEYS) {
        const template = TRAIT_PROMPT_TEMPLATES[key];
        expect(template.high.length).toBeGreaterThan(template.low.length);
      }
    });
  });

  // ==========================================================================
  // Prompt Generation — Identity & Structure
  // ==========================================================================

  describe("generatePrompt — identity", () => {
    it("should include the persona name in the output", () => {
      const persona = makePersona({ name: "Sentinel" });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain("Sentinel");
    });

    it("should include the persona description in the output", () => {
      const persona = makePersona({
        name: "Sentinel",
        description: "A QA-focused agent who catches bugs before they ship",
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain(
        "A QA-focused agent who catches bugs before they ship",
      );
    });

    it("should start with a heading containing the persona name", () => {
      const persona = makePersona({ name: "Architect" });
      const prompt = generatePrompt(persona);

      // First line should be a heading with the persona name
      const firstLine = prompt.split("\n")[0]!;
      expect(firstLine).toMatch(/^#\s+.*Architect/);
    });
  });

  // ==========================================================================
  // Prompt Generation — Trait Inclusion / Omission
  // ==========================================================================

  describe("generatePrompt — trait handling", () => {
    it("should omit traits with value 0 entirely", () => {
      const persona = makePersona({
        name: "Focused",
        traits: makeTraits({ architecture_focus: 18 }),
        // all other traits are 0
      });
      const prompt = generatePrompt(persona);

      // Should NOT contain low-tier text for zero-value traits
      expect(prompt).toContain("architecture"); // the active trait
      // documentation is at 0, its prompt text should be absent
      expect(prompt).not.toContain(TRAIT_PROMPT_TEMPLATES.documentation.low);
      expect(prompt).not.toContain(TRAIT_PROMPT_TEMPLATES.documentation.medium);
      expect(prompt).not.toContain(TRAIT_PROMPT_TEMPLATES.documentation.high);
    });

    it("should include low-tier text for traits 1-7", () => {
      const persona = makePersona({
        name: "Casual",
        traits: makeTraits({ code_review: 5 }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain(TRAIT_PROMPT_TEMPLATES.code_review.low);
    });

    it("should include medium-tier text for traits 8-14", () => {
      const persona = makePersona({
        name: "Balanced",
        traits: makeTraits({ testing_unit: 12 }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain(TRAIT_PROMPT_TEMPLATES.testing_unit.medium);
    });

    it("should include high-tier text for traits 15-20", () => {
      const persona = makePersona({
        name: "Expert",
        traits: makeTraits({ qa_correctness: 18 }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain(TRAIT_PROMPT_TEMPLATES.qa_correctness.high);
    });

    it("should handle all traits at maximum (budget-impossible but logically valid)", () => {
      const traits = {} as Record<string, number>;
      for (const key of PERSONA_TRAIT_KEYS) {
        traits[key] = 20;
      }
      const persona = makePersona({
        name: "MaxAll",
        traits: traits as TraitValues,
      });
      const prompt = generatePrompt(persona);

      // All high tiers should be present
      for (const key of PERSONA_TRAIT_KEYS) {
        expect(prompt).toContain(TRAIT_PROMPT_TEMPLATES[key].high);
      }
    });

    it("should produce a minimal prompt for all-zero traits", () => {
      const persona = makePersona({
        name: "Blank",
        description: "A blank persona",
        traits: zeroTraits(),
      });
      const prompt = generatePrompt(persona);

      // Should still have the identity header
      expect(prompt).toContain("Blank");
      expect(prompt).toContain("A blank persona");

      // Should NOT contain any trait-specific instructions
      for (const key of PERSONA_TRAIT_KEYS) {
        expect(prompt).not.toContain(TRAIT_PROMPT_TEMPLATES[key].low);
        expect(prompt).not.toContain(TRAIT_PROMPT_TEMPLATES[key].medium);
        expect(prompt).not.toContain(TRAIT_PROMPT_TEMPLATES[key].high);
      }
    });
  });

  // ==========================================================================
  // Prompt Generation — Cognitive Grouping
  // ==========================================================================

  describe("generatePrompt — cognitive grouping", () => {
    it("should group engineering traits under an Engineering section", () => {
      const persona = makePersona({
        name: "Engineer",
        traits: makeTraits({
          architecture_focus: 15,
          modular_architecture: 12,
          technical_depth: 8,
        }),
      });
      const prompt = generatePrompt(persona);

      // Engineering section should exist
      expect(prompt).toMatch(/##\s+Engineering/i);
    });

    it("should group quality traits under a Quality section", () => {
      const persona = makePersona({
        name: "QA",
        traits: makeTraits({
          qa_correctness: 18,
          testing_unit: 15,
        }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toMatch(/##\s+Quality/i);
    });

    it("should group product traits under a Product section", () => {
      const persona = makePersona({
        name: "PM",
        traits: makeTraits({
          product_design: 18,
          business_objectives: 12,
        }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toMatch(/##\s+Product/i);
    });

    it("should group craft traits under a Craft section", () => {
      const persona = makePersona({
        name: "Mentor",
        traits: makeTraits({
          code_review: 15,
          documentation: 12,
        }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toMatch(/##\s+Craft/i);
    });

    it("should omit section headers when all traits in a group are 0", () => {
      // Only engineering traits active, all others 0
      const persona = makePersona({
        name: "PureEngineer",
        traits: makeTraits({
          architecture_focus: 18,
          modular_architecture: 15,
        }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toMatch(/##\s+Engineering/i);
      // Quality, Product, Craft sections should be absent
      expect(prompt).not.toMatch(/##\s+Quality/i);
      expect(prompt).not.toMatch(/##\s+Product/i);
      expect(prompt).not.toMatch(/##\s+Craft/i);
    });
  });

  // ==========================================================================
  // Prompt Generation — Core Identity Section
  // ==========================================================================

  describe("generatePrompt — core identity", () => {
    it("should include a Core Identity section summarizing top traits", () => {
      const persona = makePersona({
        name: "Sentinel",
        traits: makeTraits({
          qa_correctness: 20,
          testing_unit: 18,
          architecture_focus: 5,
        }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toMatch(/##\s+Core Identity/i);
    });

    it("should mention the highest-valued traits in the Core Identity", () => {
      const persona = makePersona({
        name: "Sentinel",
        traits: makeTraits({
          qa_correctness: 20,
          testing_unit: 18,
          architecture_focus: 3,
        }),
      });
      const prompt = generatePrompt(persona);

      // Extract core identity section
      const coreMatch = prompt.match(
        /## Core Identity\n([\s\S]*?)(?=\n## |$)/,
      );
      expect(coreMatch).not.toBeNull();
      const coreSection = coreMatch![1]!;

      // Should reference the top traits' domains
      expect(coreSection).toMatch(/correctness|qa|quality/i);
      expect(coreSection).toMatch(/test/i);
    });
  });

  // ==========================================================================
  // Determinism
  // ==========================================================================

  describe("generatePrompt — determinism", () => {
    it("should produce identical output for identical personas", () => {
      const traits = makeTraits({
        architecture_focus: 15,
        qa_correctness: 12,
        testing_unit: 8,
        documentation: 5,
      });

      const persona1 = makePersona({
        name: "Alpha",
        description: "Test persona",
        traits,
      });
      const persona2 = makePersona({
        name: "Alpha",
        description: "Test persona",
        traits,
      });

      const prompt1 = generatePrompt(persona1);
      const prompt2 = generatePrompt(persona2);

      expect(prompt1).toBe(prompt2);
    });

    it("should produce identical output across multiple calls", () => {
      const persona = makePersona({
        name: "Consistent",
        traits: makeTraits({
          architecture_focus: 18,
          code_review: 10,
          qa_correctness: 15,
        }),
      });

      const results = Array.from({ length: 5 }, () => generatePrompt(persona));

      // All 5 outputs should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBe(results[0]);
      }
    });

    it("should produce different output for different trait values", () => {
      const persona1 = makePersona({
        name: "Agent",
        traits: makeTraits({ architecture_focus: 20 }),
      });
      const persona2 = makePersona({
        name: "Agent",
        traits: makeTraits({ qa_correctness: 20 }),
      });

      const prompt1 = generatePrompt(persona1);
      const prompt2 = generatePrompt(persona2);

      expect(prompt1).not.toBe(prompt2);
    });

    it("should produce different output for different persona names", () => {
      const traits = makeTraits({ architecture_focus: 15 });

      const prompt1 = generatePrompt(makePersona({ name: "Alpha", traits }));
      const prompt2 = generatePrompt(makePersona({ name: "Beta", traits }));

      expect(prompt1).not.toBe(prompt2);
    });
  });

  // ==========================================================================
  // Behavioral Differentiation
  // ==========================================================================

  describe("generatePrompt — behavioral differentiation", () => {
    it("should produce a QA-heavy prompt that emphasizes testing and correctness", () => {
      const persona = makePersona({
        name: "Sentinel",
        description: "QA specialist",
        traits: makeTraits({
          qa_correctness: 20,
          qa_scalability: 15,
          testing_unit: 18,
          testing_acceptance: 15,
        }),
      });
      const prompt = generatePrompt(persona);

      // Should contain strong QA-related instructions
      expect(prompt).toMatch(/test/i);
      expect(prompt).toMatch(/correct/i);
      expect(prompt).toMatch(/edge case/i);
    });

    it("should produce an architecture-heavy prompt that emphasizes design", () => {
      const persona = makePersona({
        name: "Architect",
        description: "System design specialist",
        traits: makeTraits({
          architecture_focus: 20,
          modular_architecture: 18,
          technical_depth: 15,
        }),
      });
      const prompt = generatePrompt(persona);

      // Should contain strong architecture-related instructions
      expect(prompt).toMatch(/design|architec/i);
      expect(prompt).toMatch(/modular|separation|interface/i);
    });

    it("should produce a product-heavy prompt that emphasizes user needs", () => {
      const persona = makePersona({
        name: "ProductManager",
        description: "Product thinking specialist",
        traits: makeTraits({
          product_design: 20,
          uiux_focus: 15,
          business_objectives: 18,
        }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toMatch(/user|product/i);
      expect(prompt).toMatch(/business|value|ROI/i);
    });

    it("should produce a documentation-heavy prompt that emphasizes writing", () => {
      const persona = makePersona({
        name: "Scribe",
        description: "Documentation specialist",
        traits: makeTraits({
          documentation: 20,
          code_review: 15,
        }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toMatch(/document/i);
      expect(prompt).toMatch(/comment|README|doc/i);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("generatePrompt — edge cases", () => {
    it("should handle a persona with empty description", () => {
      const persona = makePersona({
        name: "NoDesc",
        description: "",
        traits: makeTraits({ architecture_focus: 10 }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain("NoDesc");
      // Should not have awkward empty lines from missing description
      expect(prompt).not.toMatch(/\n{4,}/);
    });

    it("should handle a single trait at value 1 (minimum non-zero)", () => {
      const persona = makePersona({
        name: "Minimal",
        traits: makeTraits({ documentation: 1 }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain(TRAIT_PROMPT_TEMPLATES.documentation.low);
    });

    it("should handle a single trait at value 20 (maximum)", () => {
      const persona = makePersona({
        name: "Maxed",
        traits: makeTraits({ technical_depth: 20 }),
      });
      const prompt = generatePrompt(persona);

      expect(prompt).toContain(TRAIT_PROMPT_TEMPLATES.technical_depth.high);
    });

    it("should produce well-formed markdown with proper heading hierarchy", () => {
      const persona = makePersona({
        name: "WellFormed",
        traits: makeTraits({
          architecture_focus: 15,
          qa_correctness: 12,
          product_design: 8,
          code_review: 5,
        }),
      });
      const prompt = generatePrompt(persona);

      // Should have H1 for title
      expect(prompt).toMatch(/^# /);
      // Should have H2 sections
      expect(prompt).toMatch(/\n## /);
      // Should NOT have H3 or deeper (keep it flat for LLM consumption)
      expect(prompt).not.toMatch(/\n### /);
    });
  });
});

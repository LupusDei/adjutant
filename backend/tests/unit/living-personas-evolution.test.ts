import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

import type { PersonaService } from "../../src/services/persona-service.js";
import type { TraitValues } from "../../src/types/personas.js";
import {
  PERSONA_TRAIT_KEYS,
  POINT_BUDGET,
  EVOLUTION_MAX_DELTA,
  TRAIT_MAX,
  TRAIT_MIN,
} from "../../src/types/personas.js";

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;
let db: Database.Database;
let service: PersonaService;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-evolution-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

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

/** Create a persona with balanced traits summing to POINT_BUDGET */
function createBalancedPersona(name: string): ReturnType<PersonaService["createPersona"]> {
  // Distribute 100 across 12 traits: 8*8 + 4*9 = 64 + 36 = 100
  const traits = makeTraits({
    architecture_focus: 8,
    product_design: 8,
    uiux_focus: 8,
    qa_scalability: 8,
    qa_correctness: 9,
    testing_unit: 9,
    testing_acceptance: 9,
    modular_architecture: 9,
    business_objectives: 8,
    technical_depth: 8,
    code_review: 8,
    documentation: 8,
  });
  return service.createPersona({ name, description: "Test persona", traits });
}

// ============================================================================
// Test Suite
// ============================================================================

describe("LivingPersonasEvolution", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createPersonaService } = await import("../../src/services/persona-service.js");
    service = createPersonaService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // evolvePersona — delta validation
  // ==========================================================================

  describe("evolvePersona", () => {
    it("should apply valid deltas within +/-2 range and update traits", () => {
      const persona = createBalancedPersona("Evolving Agent");

      // +2 architecture_focus, -2 documentation = net zero change
      const updated = service.evolvePersona(persona.id, {
        architecture_focus: 2,
        documentation: -2,
      });

      expect(updated).not.toBeNull();
      expect(updated!.traits.architecture_focus).toBe(10); // was 8
      expect(updated!.traits.documentation).toBe(6); // was 8
    });

    it("should reject delta greater than EVOLUTION_MAX_DELTA", () => {
      const persona = createBalancedPersona("Over Delta");

      expect(() => {
        service.evolvePersona(persona.id, {
          architecture_focus: EVOLUTION_MAX_DELTA + 1,
          documentation: -(EVOLUTION_MAX_DELTA + 1),
        });
      }).toThrow(/must be an integer between/);
    });

    it("should reject delta less than -EVOLUTION_MAX_DELTA", () => {
      const persona = createBalancedPersona("Under Delta");

      expect(() => {
        service.evolvePersona(persona.id, {
          architecture_focus: -(EVOLUTION_MAX_DELTA + 1),
          documentation: EVOLUTION_MAX_DELTA + 1,
        });
      }).toThrow(/must be an integer between/);
    });

    it("should preserve the 100-point total budget after evolution", () => {
      const persona = createBalancedPersona("Budget Check");

      // Attempt to add points without removing — total would exceed 100
      expect(() => {
        service.evolvePersona(persona.id, {
          architecture_focus: 2,
        });
      }).toThrow(/must equal 100/);
    });

    it("should keep each trait within 0-20 range after evolution", () => {
      // Create persona with documentation at 1 (near TRAIT_MIN)
      const traits = makeTraits({
        architecture_focus: 20,
        product_design: 20,
        uiux_focus: 20,
        qa_scalability: 20,
        qa_correctness: 19,
        documentation: 1,
      });
      const persona = service.createPersona({
        name: "Near Boundary",
        description: "Near boundary",
        traits,
      });

      // Try to push documentation below TRAIT_MIN (0)
      expect(() => {
        service.evolvePersona(persona.id, {
          documentation: -2,
          qa_correctness: 2,
        });
      }).toThrow(/must be between 0 and 20/);
    });

    it("should return null when persona ID does not exist", () => {
      const result = service.evolvePersona("nonexistent-id", {
        architecture_focus: 1,
        documentation: -1,
      });
      expect(result).toBeNull();
    });

    it("should reject unknown trait names", () => {
      const persona = createBalancedPersona("Unknown Trait");

      expect(() => {
        service.evolvePersona(persona.id, {
          nonexistent_trait: 1,
          architecture_focus: -1,
        });
      }).toThrow(/Unknown trait/);
    });

    it("should return unchanged persona when all deltas are zero", () => {
      const persona = createBalancedPersona("No Change");

      const updated = service.evolvePersona(persona.id, {
        architecture_focus: 0,
        documentation: 0,
      });

      expect(updated).not.toBeNull();
      expect(updated!.traits.architecture_focus).toBe(persona.traits.architecture_focus);
    });
  });

  // ==========================================================================
  // logEvolution
  // ==========================================================================

  describe("logEvolution", () => {
    it("should persist evolution events to persona_evolution_log", () => {
      const persona = createBalancedPersona("Log Test");

      service.logEvolution(persona.id, "architecture_focus", 8, 10);
      service.logEvolution(persona.id, "documentation", 8, 6);

      const history = service.getEvolutionHistory(persona.id);
      expect(history).toHaveLength(2);
      expect(history[0]!.trait).toBe("documentation"); // most recent first
      expect(history[0]!.oldValue).toBe(8);
      expect(history[0]!.newValue).toBe(6);
      expect(history[1]!.trait).toBe("architecture_focus");
    });
  });

  // ==========================================================================
  // getEvolutionHistory
  // ==========================================================================

  describe("getEvolutionHistory", () => {
    it("should return changes in reverse chronological order", () => {
      const persona = createBalancedPersona("History Order");

      // Log three events sequentially
      service.logEvolution(persona.id, "architecture_focus", 8, 10);
      service.logEvolution(persona.id, "documentation", 8, 6);
      service.logEvolution(persona.id, "code_review", 8, 10);

      const history = service.getEvolutionHistory(persona.id);
      expect(history).toHaveLength(3);
      // Most recent first (reverse chronological)
      expect(history[0]!.trait).toBe("code_review");
      expect(history[1]!.trait).toBe("documentation");
      expect(history[2]!.trait).toBe("architecture_focus");
    });

    it("should respect the limit parameter", () => {
      const persona = createBalancedPersona("History Limit");

      service.logEvolution(persona.id, "architecture_focus", 8, 10);
      service.logEvolution(persona.id, "documentation", 8, 6);
      service.logEvolution(persona.id, "code_review", 8, 10);

      const history = service.getEvolutionHistory(persona.id, 2);
      expect(history).toHaveLength(2);
    });

    it("should return empty array for persona with no evolution history", () => {
      const persona = createBalancedPersona("No History");
      const history = service.getEvolutionHistory(persona.id);
      expect(history).toEqual([]);
    });

    it("should include correct PersonaEvolution fields", () => {
      const persona = createBalancedPersona("Fields Check");
      service.logEvolution(persona.id, "technical_depth", 8, 10);

      const history = service.getEvolutionHistory(persona.id);
      expect(history).toHaveLength(1);
      const entry = history[0]!;
      expect(entry.id).toBeTypeOf("number");
      expect(entry.personaId).toBe(persona.id);
      expect(entry.trait).toBe("technical_depth");
      expect(entry.oldValue).toBe(8);
      expect(entry.newValue).toBe(10);
      expect(entry.changedAt).toBeTruthy();
    });
  });

  // ==========================================================================
  // evolvePersona — evolution logging integration
  // ==========================================================================

  describe("evolvePersona logging integration", () => {
    it("should auto-log evolution events when evolving a persona", () => {
      const persona = createBalancedPersona("Auto Log");

      service.evolvePersona(persona.id, {
        architecture_focus: 2,
        documentation: -2,
      });

      const history = service.getEvolutionHistory(persona.id);
      expect(history).toHaveLength(2);

      // The two changed traits should be logged
      const traits = history.map((h) => h.trait).sort();
      expect(traits).toEqual(["architecture_focus", "documentation"]);

      // Check the values
      const archEntry = history.find((h) => h.trait === "architecture_focus")!;
      expect(archEntry.oldValue).toBe(8);
      expect(archEntry.newValue).toBe(10);

      const docEntry = history.find((h) => h.trait === "documentation")!;
      expect(docEntry.oldValue).toBe(8);
      expect(docEntry.newValue).toBe(6);
    });
  });
});

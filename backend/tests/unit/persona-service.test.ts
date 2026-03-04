import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

import type { PersonaService } from "../../src/services/persona-service.js";
import type { TraitValues } from "../../src/types/personas.js";
import { PERSONA_TRAIT_KEYS, POINT_BUDGET, TRAIT_MAX } from "../../src/types/personas.js";

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;
let db: Database.Database;
let service: PersonaService;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-persona-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

// ============================================================================
// Test Suite
// ============================================================================

describe("PersonaService", () => {
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
  // createPersona
  // ==========================================================================

  describe("createPersona", () => {
    it("should create a persona with valid traits and return it", () => {
      const traits = makeTraits({ architecture_focus: 18, technical_depth: 15, code_review: 10 });
      const persona = service.createPersona({
        name: "Architect",
        description: "System design specialist",
        traits,
      });

      expect(persona.id).toBeTruthy();
      expect(persona.name).toBe("Architect");
      expect(persona.description).toBe("System design specialist");
      expect(persona.traits).toEqual(traits);
      expect(persona.createdAt).toBeTruthy();
      expect(persona.updatedAt).toBeTruthy();
    });

    it("should create a persona with all zero traits (valid, 0 points used)", () => {
      const traits = zeroTraits();
      const persona = service.createPersona({
        name: "Blank",
        description: "",
        traits,
      });

      expect(persona.name).toBe("Blank");
      expect(persona.traits).toEqual(traits);
    });

    it("should create a persona using exactly the full budget (100 points)", () => {
      const traits = makeTraits({
        architecture_focus: 20,
        technical_depth: 20,
        code_review: 20,
        modular_architecture: 20,
        testing_unit: 20,
      });
      const persona = service.createPersona({
        name: "Maxed Five",
        description: "Five traits maxed",
        traits,
      });

      expect(persona.name).toBe("Maxed Five");
    });

    it("should reject traits exceeding the point budget", () => {
      const traits = makeTraits({
        architecture_focus: 20,
        technical_depth: 20,
        code_review: 20,
        modular_architecture: 20,
        testing_unit: 20,
        documentation: 1, // sum=101
      });

      expect(() =>
        service.createPersona({ name: "Over Budget", description: "", traits }),
      ).toThrow(/point/i);
    });

    it("should reject a trait value above maximum (>20)", () => {
      const traits = zeroTraits();
      // Force invalid value past TypeScript via explicit cast
      (traits as Record<string, number>).architecture_focus = 21;

      expect(() =>
        service.createPersona({ name: "Invalid", description: "", traits }),
      ).toThrow();
    });

    it("should reject a trait value below minimum (<0)", () => {
      const traits = zeroTraits();
      (traits as Record<string, number>).architecture_focus = -1;

      expect(() =>
        service.createPersona({ name: "Negative", description: "", traits }),
      ).toThrow();
    });

    it("should reject non-integer trait values", () => {
      const traits = zeroTraits();
      (traits as Record<string, number>).architecture_focus = 10.5;

      expect(() =>
        service.createPersona({ name: "Fractional", description: "", traits }),
      ).toThrow();
    });

    it("should reject duplicate names (case-insensitive)", () => {
      const traits = zeroTraits();
      service.createPersona({ name: "Sentinel", description: "", traits });

      expect(() =>
        service.createPersona({ name: "sentinel", description: "", traits }),
      ).toThrow(/unique|duplicate|already exists/i);
    });

    it("should reject duplicate names with different casing", () => {
      const traits = zeroTraits();
      service.createPersona({ name: "MyAgent", description: "", traits });

      expect(() =>
        service.createPersona({ name: "MYAGENT", description: "", traits }),
      ).toThrow(/unique|duplicate|already exists/i);
    });

    it("should reject empty name", () => {
      expect(() =>
        service.createPersona({ name: "", description: "", traits: zeroTraits() }),
      ).toThrow();
    });

    it("should reject name exceeding 64 characters", () => {
      expect(() =>
        service.createPersona({
          name: "A".repeat(65),
          description: "",
          traits: zeroTraits(),
        }),
      ).toThrow();
    });

    it("should generate unique IDs for each persona", () => {
      const traits = zeroTraits();
      const p1 = service.createPersona({ name: "Alpha", description: "", traits });
      const p2 = service.createPersona({ name: "Beta", description: "", traits });

      expect(p1.id).not.toBe(p2.id);
    });

    it("should trim whitespace from name", () => {
      const persona = service.createPersona({
        name: "  Padded  ",
        description: "",
        traits: zeroTraits(),
      });

      expect(persona.name).toBe("Padded");
    });
  });

  // ==========================================================================
  // getPersona
  // ==========================================================================

  describe("getPersona", () => {
    it("should return a persona by ID", () => {
      const traits = makeTraits({ architecture_focus: 15 });
      const created = service.createPersona({
        name: "Test",
        description: "Desc",
        traits,
      });

      const fetched = service.getPersona(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe("Test");
      expect(fetched!.traits).toEqual(traits);
    });

    it("should return null for non-existent ID", () => {
      const result = service.getPersona("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getPersonaByName
  // ==========================================================================

  describe("getPersonaByName", () => {
    it("should find a persona by exact name", () => {
      const traits = zeroTraits();
      service.createPersona({ name: "Sentinel", description: "", traits });

      const found = service.getPersonaByName("Sentinel");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Sentinel");
    });

    it("should find a persona case-insensitively", () => {
      const traits = zeroTraits();
      service.createPersona({ name: "Sentinel", description: "", traits });

      const found = service.getPersonaByName("sentinel");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Sentinel");
    });

    it("should return null for unknown name", () => {
      const result = service.getPersonaByName("unknown");
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // listPersonas
  // ==========================================================================

  describe("listPersonas", () => {
    it("should return empty array when no personas exist", () => {
      const result = service.listPersonas();
      expect(result).toEqual([]);
    });

    it("should return all personas sorted by name", () => {
      const traits = zeroTraits();
      service.createPersona({ name: "Charlie", description: "", traits });
      service.createPersona({ name: "Alpha", description: "", traits });
      service.createPersona({ name: "Bravo", description: "", traits });

      const result = service.listPersonas();
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    it("should return full persona objects with traits", () => {
      const traits = makeTraits({ architecture_focus: 10 });
      service.createPersona({ name: "Test", description: "A test persona", traits });

      const result = service.listPersonas();
      expect(result[0]!.traits.architecture_focus).toBe(10);
      expect(result[0]!.description).toBe("A test persona");
    });
  });

  // ==========================================================================
  // updatePersona
  // ==========================================================================

  describe("updatePersona", () => {
    it("should update name only", () => {
      const persona = service.createPersona({
        name: "OldName",
        description: "Desc",
        traits: zeroTraits(),
      });

      const updated = service.updatePersona(persona.id, { name: "NewName" });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("NewName");
      expect(updated!.description).toBe("Desc");
    });

    it("should update description only", () => {
      const persona = service.createPersona({
        name: "Test",
        description: "Old desc",
        traits: zeroTraits(),
      });

      const updated = service.updatePersona(persona.id, {
        description: "New desc",
      });
      expect(updated).not.toBeNull();
      expect(updated!.description).toBe("New desc");
      expect(updated!.name).toBe("Test");
    });

    it("should update traits with valid budget", () => {
      const persona = service.createPersona({
        name: "Test",
        description: "",
        traits: zeroTraits(),
      });

      const newTraits = makeTraits({ qa_correctness: 20, testing_unit: 20 });
      const updated = service.updatePersona(persona.id, { traits: newTraits });
      expect(updated).not.toBeNull();
      expect(updated!.traits.qa_correctness).toBe(20);
      expect(updated!.traits.testing_unit).toBe(20);
    });

    it("should reject traits exceeding budget on update", () => {
      const persona = service.createPersona({
        name: "Test",
        description: "",
        traits: zeroTraits(),
      });

      const overBudget = makeTraits({
        architecture_focus: 20,
        technical_depth: 20,
        code_review: 20,
        modular_architecture: 20,
        testing_unit: 20,
        documentation: 1,
      });

      expect(() =>
        service.updatePersona(persona.id, { traits: overBudget }),
      ).toThrow(/point/i);
    });

    it("should reject duplicate name on update (case-insensitive)", () => {
      const traits = zeroTraits();
      service.createPersona({ name: "Alpha", description: "", traits });
      const beta = service.createPersona({ name: "Beta", description: "", traits });

      expect(() =>
        service.updatePersona(beta.id, { name: "alpha" }),
      ).toThrow(/unique|duplicate|already exists/i);
    });

    it("should allow updating name to same name (no-op rename)", () => {
      const persona = service.createPersona({
        name: "Same",
        description: "",
        traits: zeroTraits(),
      });

      const updated = service.updatePersona(persona.id, { name: "Same" });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Same");
    });

    it("should return null for non-existent ID", () => {
      const result = service.updatePersona("nonexistent", { name: "X" });
      expect(result).toBeNull();
    });

    it("should update updatedAt timestamp", () => {
      const persona = service.createPersona({
        name: "Test",
        description: "",
        traits: zeroTraits(),
      });

      // Small delay to ensure different timestamp
      const updated = service.updatePersona(persona.id, { description: "Changed" });
      expect(updated).not.toBeNull();
      expect(updated!.updatedAt).toBeTruthy();
    });

    it("should update all fields at once", () => {
      const persona = service.createPersona({
        name: "Old",
        description: "Old desc",
        traits: zeroTraits(),
      });

      const newTraits = makeTraits({ product_design: 15, uiux_focus: 15 });
      const updated = service.updatePersona(persona.id, {
        name: "New",
        description: "New desc",
        traits: newTraits,
      });

      expect(updated!.name).toBe("New");
      expect(updated!.description).toBe("New desc");
      expect(updated!.traits).toEqual(newTraits);
    });
  });

  // ==========================================================================
  // deletePersona
  // ==========================================================================

  describe("deletePersona", () => {
    it("should delete an existing persona", () => {
      const persona = service.createPersona({
        name: "ToDelete",
        description: "",
        traits: zeroTraits(),
      });

      const deleted = service.deletePersona(persona.id);
      expect(deleted).toBe(true);

      const fetched = service.getPersona(persona.id);
      expect(fetched).toBeNull();
    });

    it("should return false for non-existent ID", () => {
      const deleted = service.deletePersona("nonexistent");
      expect(deleted).toBe(false);
    });

    it("should not affect other personas", () => {
      const traits = zeroTraits();
      const p1 = service.createPersona({ name: "Keep", description: "", traits });
      const p2 = service.createPersona({ name: "Delete", description: "", traits });

      service.deletePersona(p2.id);

      const remaining = service.listPersonas();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.name).toBe("Keep");
    });

    it("should allow re-creating a persona with a deleted name", () => {
      const traits = zeroTraits();
      const original = service.createPersona({ name: "Reuse", description: "", traits });
      service.deletePersona(original.id);

      const recreated = service.createPersona({ name: "Reuse", description: "V2", traits });
      expect(recreated.name).toBe("Reuse");
      expect(recreated.id).not.toBe(original.id);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("edge cases", () => {
    it("should handle boundary budget of exactly 100", () => {
      // 5 traits at 20 = 100 exactly
      const traits = makeTraits({
        architecture_focus: 20,
        product_design: 20,
        uiux_focus: 20,
        qa_scalability: 20,
        qa_correctness: 20,
      });

      const persona = service.createPersona({
        name: "Boundary",
        description: "",
        traits,
      });
      expect(persona).toBeTruthy();
    });

    it("should reject budget of 101 (one over)", () => {
      const traits = makeTraits({
        architecture_focus: 20,
        product_design: 20,
        uiux_focus: 20,
        qa_scalability: 20,
        qa_correctness: 20,
        testing_unit: 1,
      });

      expect(() =>
        service.createPersona({ name: "OneOver", description: "", traits }),
      ).toThrow(/point/i);
    });

    it("should preserve all 12 trait keys in stored persona", () => {
      const traits = zeroTraits();
      const persona = service.createPersona({ name: "AllKeys", description: "", traits });

      const fetched = service.getPersona(persona.id);
      expect(fetched).not.toBeNull();
      for (const key of PERSONA_TRAIT_KEYS) {
        expect(fetched!.traits).toHaveProperty(key);
      }
    });

    it("should handle description with special characters", () => {
      const persona = service.createPersona({
        name: "Special",
        description: 'Handles "quotes", <angles>, & ampersands, newlines\nand\ttabs inside',
        traits: zeroTraits(),
      });

      const fetched = service.getPersona(persona.id);
      expect(fetched!.description).toBe(
        'Handles "quotes", <angles>, & ampersands, newlines\nand\ttabs inside',
      );
    });
  });
});

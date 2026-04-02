import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { createPersonaService } from "../../src/services/persona-service.js";
import type { PersonaService } from "../../src/services/persona-service.js";
import type { TraitValues } from "../../src/types/personas.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create personas table
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      traits TEXT NOT NULL,
      source TEXT DEFAULT 'hand-crafted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create callsign_personas junction table (adj-158 migration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS callsign_personas (
      callsign TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return db;
}

function validTraits(): TraitValues {
  return {
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
    documentation: 5,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("PersonaService — callsign persona methods", () => {
  let db: Database.Database;
  let service: PersonaService;

  beforeEach(() => {
    db = createTestDb();
    service = createPersonaService(db);
  });

  afterEach(() => {
    db.close();
  });

  // --------------------------------------------------------------------------
  // getPersonaByCallsign
  // --------------------------------------------------------------------------

  describe("getPersonaByCallsign", () => {
    it("should return persona when callsign is linked", () => {
      // Create a persona
      const persona = service.createPersona({
        name: "Test Persona",
        description: "A test persona",
        traits: validTraits(),
      });

      // Link the callsign
      service.linkCallsignPersona("raynor", persona.id);

      // Query
      const result = service.getPersonaByCallsign("raynor");
      expect(result).not.toBeNull();
      expect(result!.id).toBe(persona.id);
      expect(result!.name).toBe("Test Persona");
    });

    it("should return null when callsign is not linked", () => {
      const result = service.getPersonaByCallsign("unknown-callsign");
      expect(result).toBeNull();
    });

    it("should return null when callsign link exists but persona was deleted", () => {
      // Create and link
      const persona = service.createPersona({
        name: "Deletable Persona",
        description: "Will be deleted",
        traits: validTraits(),
      });
      service.linkCallsignPersona("tosh", persona.id);

      // Delete the persona
      service.deletePersona(persona.id);

      // The JOIN should return null since the persona row is gone
      const result = service.getPersonaByCallsign("tosh");
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // linkCallsignPersona
  // --------------------------------------------------------------------------

  describe("linkCallsignPersona", () => {
    it("should create the link between callsign and persona", () => {
      const persona = service.createPersona({
        name: "Link Test",
        description: "",
        traits: validTraits(),
      });

      service.linkCallsignPersona("kerrigan", persona.id);

      const result = service.getPersonaByCallsign("kerrigan");
      expect(result).not.toBeNull();
      expect(result!.id).toBe(persona.id);
    });

    it("should silently ignore duplicate callsign insertion (INSERT OR IGNORE)", () => {
      const persona1 = service.createPersona({
        name: "Persona One",
        description: "",
        traits: validTraits(),
      });

      const persona2 = service.createPersona({
        name: "Persona Two",
        description: "",
        traits: validTraits(),
      });

      // First link
      service.linkCallsignPersona("nova", persona1.id);

      // Second link for same callsign should be silently ignored
      // (INSERT OR IGNORE — the PRIMARY KEY constraint prevents update)
      expect(() => {
        service.linkCallsignPersona("nova", persona2.id);
      }).not.toThrow();

      // Should still be linked to the first persona
      const result = service.getPersonaByCallsign("nova");
      expect(result!.id).toBe(persona1.id);
    });
  });

  // --------------------------------------------------------------------------
  // updatePersonaSource
  // --------------------------------------------------------------------------

  describe("updatePersonaSource", () => {
    it("should update source to self-generated", () => {
      const persona = service.createPersona({
        name: "Source Test",
        description: "",
        traits: validTraits(),
      });

      // Default source from migration is 'hand-crafted'
      service.updatePersonaSource!(persona.id, "self-generated");

      // Verify via raw DB query (service doesn't expose source in Persona interface)
      // Safe cast: we know the row shape from the schema
      const row = db.prepare("SELECT source FROM personas WHERE id = ?").get(persona.id) as { source: string } | undefined;
      expect(row?.source).toBe("self-generated");
    });
  });
});

/**
 * PersonaService — CRUD operations for agent personas with trait-based point budgets.
 *
 * Each persona has 12 personality traits (0-20 each, total <= 100).
 * Stored in SQLite with JSON-serialized trait values.
 * Name uniqueness is enforced case-insensitively at both SQL and application layers.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import type { Persona, PersonaRow, TraitValues, CreatePersonaInput, UpdatePersonaInput, PersonaEvolution } from "../types/personas.js";
import { CreatePersonaSchema, UpdatePersonaSchema, EVOLUTION_MAX_DELTA, TRAIT_MIN, TRAIT_MAX, POINT_BUDGET, sumTraits } from "../types/personas.js";

// ============================================================================
// Row Mapping
// ============================================================================

function rowToPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    traits: JSON.parse(row.traits) as TraitValues,
    source: row.source ?? "hand-crafted",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Service Interface
// ============================================================================

export interface PersonaService {
  /** Create a new persona. Throws on validation failure or duplicate name. */
  createPersona(input: CreatePersonaInput): Persona;

  /** Get a persona by ID. Returns null if not found. */
  getPersona(id: string): Persona | null;

  /** Find a persona by name (case-insensitive). Returns null if not found. */
  getPersonaByName(name: string): Persona | null;

  /** List personas, sorted by name ascending. Excludes self-generated callsign personas by default. */
  listPersonas(includeCallsignPersonas?: boolean): Persona[];

  /** Update an existing persona. Returns null if ID not found. Throws on validation failure. */
  updatePersona(id: string, input: UpdatePersonaInput): Persona | null;

  /** Delete a persona by ID. Returns true if deleted, false if not found. */
  deletePersona(id: string): boolean;

  /** Get the persona linked to a callsign. Returns null if no link exists. */
  getPersonaByCallsign(callsign: string): Persona | null;

  /** Link a callsign to a persona. Uses INSERT OR IGNORE for race-condition safety. */
  linkCallsignPersona(callsign: string, personaId: string): void;

  /** Update the source field of a persona (hand-crafted vs self-generated). */
  updatePersonaSource?(id: string, source: "hand-crafted" | "self-generated"): void;

  /** Evolve a persona's traits by applying deltas (+/-2 max per trait, total must stay at 100). */
  evolvePersona(id: string, adjustments: Partial<Record<string, number>>): Persona | null;

  /** Log a single trait evolution event to the persona_evolution_log table. */
  logEvolution(personaId: string, trait: string, oldValue: number, newValue: number): void;

  /** Get evolution history for a persona, ordered by changed_at DESC. */
  getEvolutionHistory(personaId: string, limit?: number): PersonaEvolution[];
}

// ============================================================================
// Implementation
// ============================================================================

// ============================================================================
// Singleton Accessor
// ============================================================================

let _instance: PersonaService | null = null;

/**
 * Get the global PersonaService instance.
 * Returns null if not yet initialized via initPersonaService().
 */
export function getPersonaService(): PersonaService | null {
  return _instance;
}

/**
 * Initialize the global PersonaService singleton.
 * Called once at startup from index.ts.
 */
export function initPersonaService(service: PersonaService): void {
  _instance = service;
}

/**
 * Reset the global singleton (for testing).
 */
export function resetPersonaService(): void {
  _instance = null;
}

// ============================================================================
// Factory
// ============================================================================

export function createPersonaService(db: Database.Database): PersonaService {
  const insertStmt = db.prepare(`
    INSERT INTO personas (id, name, description, traits, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const getByIdStmt = db.prepare("SELECT * FROM personas WHERE id = ?");

  const getByNameStmt = db.prepare(
    "SELECT * FROM personas WHERE name = ? COLLATE NOCASE",
  );

  const listStmt = db.prepare(
    "SELECT * FROM personas ORDER BY name COLLATE NOCASE ASC",
  );
  const listHandCraftedStmt = db.prepare(
    "SELECT * FROM personas WHERE source != 'self-generated' OR source IS NULL ORDER BY name COLLATE NOCASE ASC",
  );

  const deleteStmt = db.prepare("DELETE FROM personas WHERE id = ?");

  // Living Personas (adj-158) — callsign-persona linkage
  const getByCallsignStmt = db.prepare(`
    SELECT p.* FROM personas p
    INNER JOIN callsign_personas cp ON cp.persona_id = p.id
    WHERE cp.callsign = ?
  `);

  const linkCallsignStmt = db.prepare(`
    INSERT OR IGNORE INTO callsign_personas (callsign, persona_id)
    VALUES (?, ?)
  `);

  const updateSourceStmt = db.prepare(
    "UPDATE personas SET source = ? WHERE id = ?",
  );

  const insertEvolutionStmt = db.prepare(`
    INSERT INTO persona_evolution_log (persona_id, trait, old_value, new_value, changed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  const getEvolutionStmt = db.prepare(
    "SELECT * FROM persona_evolution_log WHERE persona_id = ? ORDER BY changed_at DESC, id DESC LIMIT ?",
  );

  return {
    createPersona(input: CreatePersonaInput): Persona {
      // Validate via Zod (range checks, budget, name format)
      const parsed = CreatePersonaSchema.parse(input);

      // Check for duplicate name at the application level for a clearer error
      const existing = getByNameStmt.get(parsed.name) as PersonaRow | undefined;
      if (existing !== undefined) {
        throw new Error(
          `Persona with name '${parsed.name}' already exists`,
        );
      }

      const id = randomUUID();
      const traitsJson = JSON.stringify(parsed.traits);

      insertStmt.run(id, parsed.name, parsed.description, traitsJson);

      const row = getByIdStmt.get(id) as PersonaRow;
      return rowToPersona(row);
    },

    getPersona(id: string): Persona | null {
      const row = getByIdStmt.get(id) as PersonaRow | undefined;
      return row !== undefined ? rowToPersona(row) : null;
    },

    getPersonaByName(name: string): Persona | null {
      const row = getByNameStmt.get(name) as PersonaRow | undefined;
      return row !== undefined ? rowToPersona(row) : null;
    },

    listPersonas(includeCallsignPersonas = false): Persona[] {
      const rows = includeCallsignPersonas
        ? listStmt.all() as PersonaRow[]
        : listHandCraftedStmt.all() as PersonaRow[];
      return rows.map(rowToPersona);
    },

    updatePersona(id: string, input: UpdatePersonaInput): Persona | null {
      // Validate update input
      const parsed = UpdatePersonaSchema.parse(input);

      // Check the persona exists
      const existing = getByIdStmt.get(id) as PersonaRow | undefined;
      if (existing === undefined) {
        return null;
      }

      // If renaming, check name uniqueness (but allow keeping same name)
      if (parsed.name !== undefined) {
        const nameConflict = getByNameStmt.get(parsed.name) as PersonaRow | undefined;
        if (nameConflict !== undefined && nameConflict.id !== id) {
          throw new Error(
            `Persona with name '${parsed.name}' already exists`,
          );
        }
      }

      // Build dynamic UPDATE
      const setClauses: string[] = ["updated_at = datetime('now')"];
      const params: unknown[] = [];

      if (parsed.name !== undefined) {
        setClauses.push("name = ?");
        params.push(parsed.name);
      }

      if (parsed.description !== undefined) {
        setClauses.push("description = ?");
        params.push(parsed.description);
      }

      if (parsed.traits !== undefined) {
        setClauses.push("traits = ?");
        params.push(JSON.stringify(parsed.traits));
      }

      params.push(id);

      const sql = `UPDATE personas SET ${setClauses.join(", ")} WHERE id = ?`;
      db.prepare(sql).run(...params);

      const updated = getByIdStmt.get(id) as PersonaRow;
      return rowToPersona(updated);
    },

    deletePersona(id: string): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },

    getPersonaByCallsign(callsign: string): Persona | null {
      const row = getByCallsignStmt.get(callsign) as PersonaRow | undefined;
      return row !== undefined ? rowToPersona(row) : null;
    },

    linkCallsignPersona(callsign: string, personaId: string): void {
      linkCallsignStmt.run(callsign, personaId);
    },

    updatePersonaSource(id: string, source: "hand-crafted" | "self-generated"): void {
      updateSourceStmt.run(source, id);
    },

    evolvePersona(id: string, adjustments: Partial<Record<string, number>>): Persona | null {
      const row = getByIdStmt.get(id) as PersonaRow | undefined;
      if (row === undefined) return null;

      const persona = rowToPersona(row);
      const currentTraits = { ...persona.traits };
      const changes: { trait: string; oldValue: number; newValue: number }[] = [];

      for (const [trait, delta] of Object.entries(adjustments)) {
        if (delta === undefined || delta === 0) continue;
        if (!Number.isInteger(delta) || delta < -EVOLUTION_MAX_DELTA || delta > EVOLUTION_MAX_DELTA) {
          throw new Error(`Delta for '${trait}' must be an integer between -${EVOLUTION_MAX_DELTA} and +${EVOLUTION_MAX_DELTA}, got ${delta}`);
        }
        if (!(trait in currentTraits)) {
          throw new Error(`Unknown trait: '${trait}'`);
        }
        const oldValue = currentTraits[trait as keyof TraitValues];
        const newValue = oldValue + delta;
        if (newValue < TRAIT_MIN || newValue > TRAIT_MAX) {
          throw new Error(`Trait '${trait}' would be ${newValue} after applying delta ${delta}, but must be between ${TRAIT_MIN} and ${TRAIT_MAX}`);
        }
        changes.push({ trait, oldValue, newValue });
        (currentTraits as Record<string, number>)[trait] = newValue;
      }

      const newTotal = sumTraits(currentTraits);
      if (newTotal !== POINT_BUDGET) {
        throw new Error(`Total trait points must equal ${POINT_BUDGET} after evolution, but would be ${newTotal}`);
      }

      if (changes.length === 0) return persona;

      const traitsJson = JSON.stringify(currentTraits);
      db.prepare("UPDATE personas SET traits = ?, updated_at = datetime('now') WHERE id = ?").run(traitsJson, id);
      for (const change of changes) {
        insertEvolutionStmt.run(id, change.trait, change.oldValue, change.newValue);
      }
      const updated = getByIdStmt.get(id) as PersonaRow;
      return rowToPersona(updated);
    },

    logEvolution(personaId: string, trait: string, oldValue: number, newValue: number): void {
      insertEvolutionStmt.run(personaId, trait, oldValue, newValue);
    },

    getEvolutionHistory(personaId: string, limit?: number): PersonaEvolution[] {
      const effectiveLimit = limit ?? 100;
      const rows = getEvolutionStmt.all(personaId, effectiveLimit) as {
        id: number; persona_id: string; trait: string; old_value: number; new_value: number; changed_at: string;
      }[];
      return rows.map((r) => ({
        id: r.id,
        personaId: r.persona_id,
        trait: r.trait as PersonaEvolution["trait"],
        oldValue: r.old_value,
        newValue: r.new_value,
        changedAt: r.changed_at,
      }));
    },
  };
}

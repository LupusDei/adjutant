/**
 * PersonaService — CRUD operations for agent personas with trait-based point budgets.
 *
 * Each persona has 12 personality traits (0-20 each, total <= 100).
 * Stored in SQLite with JSON-serialized trait values.
 * Name uniqueness is enforced case-insensitively at both SQL and application layers.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import type { Persona, PersonaRow, TraitValues, CreatePersonaInput, UpdatePersonaInput } from "../types/personas.js";
import { CreatePersonaSchema, UpdatePersonaSchema } from "../types/personas.js";

// ============================================================================
// Row Mapping
// ============================================================================

function rowToPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    traits: JSON.parse(row.traits) as TraitValues,
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

  /** List all personas, sorted by name ascending. */
  listPersonas(): Persona[];

  /** Update an existing persona. Returns null if ID not found. Throws on validation failure. */
  updatePersona(id: string, input: UpdatePersonaInput): Persona | null;

  /** Delete a persona by ID. Returns true if deleted, false if not found. */
  deletePersona(id: string): boolean;
}

// ============================================================================
// Implementation
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

  const deleteStmt = db.prepare("DELETE FROM personas WHERE id = ?");

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

    listPersonas(): Persona[] {
      const rows = listStmt.all() as PersonaRow[];
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
  };
}

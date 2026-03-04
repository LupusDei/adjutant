/**
 * CallsignToggleService — persists enabled/disabled state for StarCraft callsigns.
 *
 * Individual callsigns can be toggled on/off. There's also a master toggle
 * that, when disabled, disables ALL callsigns from auto-assignment.
 * State is stored in the `callsign_settings` SQLite table.
 *
 * Callsigns not in the table are considered enabled by default.
 * The master toggle uses a special row with name='__master__'.
 */

import type Database from "better-sqlite3";

import { CALLSIGNS, type CallsignEntry } from "./callsign-service.js";

// ============================================================================
// Constants
// ============================================================================

/** Special row key for the master toggle */
const MASTER_KEY = "__master__";

// ============================================================================
// Types
// ============================================================================

export interface CallsignSetting extends CallsignEntry {
  enabled: boolean;
}

export interface CallsignToggleService {
  /** Check if a specific callsign is enabled. Returns true if no row exists (default). */
  isEnabled(name: string): boolean;

  /** Set a specific callsign's enabled state. Creates or updates the row. */
  setEnabled(name: string, enabled: boolean): void;

  /** Check if the master toggle is enabled. Returns true if no row exists (default). */
  isMasterEnabled(): boolean;

  /** Set the master toggle state. */
  setMasterEnabled(enabled: boolean): void;

  /** Get the set of all explicitly disabled callsign names (excludes master row). */
  getDisabledCallsigns(): Set<string>;

  /** Get all 44 callsigns with their enabled/disabled state. */
  getAllSettings(): CallsignSetting[];

  /** Enable or disable all 44 callsigns at once. Also sets master toggle. */
  setAllEnabled(enabled: boolean): void;
}

// ============================================================================
// Implementation
// ============================================================================

export function createCallsignToggleService(db: Database.Database): CallsignToggleService {
  const getStmt = db.prepare(
    "SELECT enabled FROM callsign_settings WHERE name = ?",
  );

  const upsertStmt = db.prepare(`
    INSERT INTO callsign_settings (name, enabled, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')
  `);

  const getDisabledStmt = db.prepare(
    "SELECT name FROM callsign_settings WHERE enabled = 0 AND name != ?",
  );

  const deleteAllCallsignsStmt = db.prepare(
    "DELETE FROM callsign_settings WHERE name != ?",
  );

  return {
    isEnabled(name: string): boolean {
      const row = getStmt.get(name) as { enabled: number } | undefined;
      if (row === undefined) return true; // default enabled
      return row.enabled === 1;
    },

    setEnabled(name: string, enabled: boolean): void {
      upsertStmt.run(name, enabled ? 1 : 0);
    },

    isMasterEnabled(): boolean {
      const row = getStmt.get(MASTER_KEY) as { enabled: number } | undefined;
      if (row === undefined) return true;
      return row.enabled === 1;
    },

    setMasterEnabled(enabled: boolean): void {
      upsertStmt.run(MASTER_KEY, enabled ? 1 : 0);
    },

    getDisabledCallsigns(): Set<string> {
      const rows = getDisabledStmt.all(MASTER_KEY) as Array<{ name: string }>;
      return new Set(rows.map((r) => r.name));
    },

    getAllSettings(): CallsignSetting[] {
      const disabled = this.getDisabledCallsigns();
      return CALLSIGNS.map((c) => ({
        ...c,
        enabled: !disabled.has(c.name),
      }));
    },

    setAllEnabled(enabled: boolean): void {
      if (enabled) {
        // Remove all individual settings (revert to default=enabled)
        deleteAllCallsignsStmt.run(MASTER_KEY);
        // Also set master to enabled
        upsertStmt.run(MASTER_KEY, 1);
      } else {
        // Disable all 44 callsigns individually
        const insertAll = db.transaction(() => {
          for (const callsign of CALLSIGNS) {
            upsertStmt.run(callsign.name, 0);
          }
          upsertStmt.run(MASTER_KEY, 0);
        });
        insertAll();
      }
    },
  };
}

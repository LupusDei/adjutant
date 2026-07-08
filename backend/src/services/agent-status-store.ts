/**
 * AgentStatusStore (adj-pyhm4) — persistent last-known agent status snapshot.
 *
 * Live agent status is held in-memory (mcp-tools/status.ts `agentStatuses` Map).
 * A backend restart wipes it, so the roster falsely shows everyone idle/booting
 * until each agent re-reports. This store is a lightweight, queryable snapshot —
 * ONE row per agent — written through on every status transition and hydrated
 * back into the in-memory registry on boot.
 *
 * Scope (Constitution Rule 9 — simplest thing that solves the problem):
 * only the DURABLE status fields are persisted. Liveness (is the agent currently
 * connected?) is derived at read time from the live MCP connection registry, NOT
 * stored. Transient runtime metrics (cost, context %) are excluded — they are
 * re-reported live on reconnect and a stale persisted value would mislead.
 */

import type Database from "better-sqlite3";

// ============================================================================
// Types
// ============================================================================

/** A last-known status snapshot for a single agent. */
export interface AgentStatusSnapshot {
  agentId: string;
  status: string;
  currentTask?: string | undefined;
  beadId?: string | undefined;
  projectId?: string | undefined;
  /** ISO timestamp of the last status transition — doubles as "last seen". */
  updatedAt: string;
}

/** Raw DB row shape (snake_case columns). */
interface AgentStatusRow {
  agent_id: string;
  status: string;
  current_task: string | null;
  bead_id: string | null;
  project_id: string | null;
  updated_at: string;
}

export interface AgentStatusStore {
  /** Insert or update (one row per agent) the last-known snapshot. */
  upsert(snapshot: AgentStatusSnapshot): void;
  /** All persisted snapshots (used for boot hydration). */
  getAll(): AgentStatusSnapshot[];
  /** A single agent's snapshot, or null when none is persisted. */
  get(agentId: string): AgentStatusSnapshot | null;
  /** Delete an agent's snapshot. No-op when absent; never throws. */
  remove(agentId: string): void;
}

// ============================================================================
// Mapping
// ============================================================================

function rowToSnapshot(row: AgentStatusRow): AgentStatusSnapshot {
  return {
    agentId: row.agent_id,
    status: row.status,
    currentTask: row.current_task ?? undefined,
    beadId: row.bead_id ?? undefined,
    projectId: row.project_id ?? undefined,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an AgentStatusStore bound to the given better-sqlite3 connection.
 */
export function createAgentStatusStore(db: Database.Database): AgentStatusStore {
  return {
    upsert(snapshot: AgentStatusSnapshot): void {
      db.prepare(
        `
        INSERT INTO agent_status
          (agent_id, status, current_task, bead_id, project_id, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          status       = excluded.status,
          current_task = excluded.current_task,
          bead_id      = excluded.bead_id,
          project_id   = excluded.project_id,
          updated_at   = excluded.updated_at
      `,
      ).run(
        snapshot.agentId,
        snapshot.status,
        snapshot.currentTask ?? null,
        snapshot.beadId ?? null,
        snapshot.projectId ?? null,
        snapshot.updatedAt,
      );
    },

    getAll(): AgentStatusSnapshot[] {
      const rows = db
        .prepare("SELECT * FROM agent_status ORDER BY agent_id ASC")
        .all() as AgentStatusRow[];
      return rows.map(rowToSnapshot);
    },

    get(agentId: string): AgentStatusSnapshot | null {
      const row = db
        .prepare("SELECT * FROM agent_status WHERE agent_id = ?")
        .get(agentId) as AgentStatusRow | undefined;
      return row ? rowToSnapshot(row) : null;
    },

    remove(agentId: string): void {
      db.prepare("DELETE FROM agent_status WHERE agent_id = ?").run(agentId);
    },
  };
}

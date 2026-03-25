import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// ============================================================================
// Types
// ============================================================================

export interface AutoDevelopCycle {
  id: string;
  projectId: string;
  phase: string;
  startedAt: string;
  completedAt: string | null;
  proposalsGenerated: number;
  proposalsAccepted: number;
  proposalsEscalated: number;
  proposalsDismissed: number;
}

interface CycleRow {
  id: string;
  project_id: string;
  phase: string;
  started_at: string;
  completed_at: string | null;
  proposals_generated: number;
  proposals_accepted: number;
  proposals_escalated: number;
  proposals_dismissed: number;
}

export interface AutoDevelopStore {
  startCycle(projectId: string, phase: string): AutoDevelopCycle;
  updateCycle(
    id: string,
    updates: Partial<
      Pick<
        AutoDevelopCycle,
        | "phase"
        | "proposalsGenerated"
        | "proposalsAccepted"
        | "proposalsEscalated"
        | "proposalsDismissed"
      >
    >,
  ): AutoDevelopCycle | null;
  completeCycle(id: string): AutoDevelopCycle | null;
  getActiveCycle(projectId: string): AutoDevelopCycle | null;
  getCycleHistory(projectId: string, limit?: number): AutoDevelopCycle[];
}

// ============================================================================
// Row Mapping
// ============================================================================

function rowToCycle(row: CycleRow): AutoDevelopCycle {
  return {
    id: row.id,
    projectId: row.project_id,
    phase: row.phase,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    proposalsGenerated: row.proposals_generated,
    proposalsAccepted: row.proposals_accepted,
    proposalsEscalated: row.proposals_escalated,
    proposalsDismissed: row.proposals_dismissed,
  };
}

// ============================================================================
// Store Factory
// ============================================================================

export function createAutoDevelopStore(db: Database.Database): AutoDevelopStore {
  const insertStmt = db.prepare(`
    INSERT INTO auto_develop_cycles (id, project_id, phase, started_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  const getByIdStmt = db.prepare("SELECT * FROM auto_develop_cycles WHERE id = ?");

  const getActiveStmt = db.prepare(
    "SELECT * FROM auto_develop_cycles WHERE project_id = ? AND completed_at IS NULL ORDER BY started_at DESC, rowid DESC LIMIT 1",
  );

  const completeStmt = db.prepare(
    "UPDATE auto_develop_cycles SET completed_at = datetime('now') WHERE id = ?",
  );

  return {
    startCycle(projectId: string, phase: string): AutoDevelopCycle {
      const id = randomUUID();
      insertStmt.run(id, projectId, phase);
      const row = getByIdStmt.get(id) as CycleRow;
      return rowToCycle(row);
    },

    updateCycle(
      id: string,
      updates: Partial<
        Pick<
          AutoDevelopCycle,
          | "phase"
          | "proposalsGenerated"
          | "proposalsAccepted"
          | "proposalsEscalated"
          | "proposalsDismissed"
        >
      >,
    ): AutoDevelopCycle | null {
      const existing = getByIdStmt.get(id) as CycleRow | undefined;
      if (!existing) return null;

      const setClauses: string[] = [];
      const params: unknown[] = [];

      if (updates.phase !== undefined) {
        setClauses.push("phase = ?");
        params.push(updates.phase);
      }
      if (updates.proposalsGenerated !== undefined) {
        setClauses.push("proposals_generated = ?");
        params.push(updates.proposalsGenerated);
      }
      if (updates.proposalsAccepted !== undefined) {
        setClauses.push("proposals_accepted = ?");
        params.push(updates.proposalsAccepted);
      }
      if (updates.proposalsEscalated !== undefined) {
        setClauses.push("proposals_escalated = ?");
        params.push(updates.proposalsEscalated);
      }
      if (updates.proposalsDismissed !== undefined) {
        setClauses.push("proposals_dismissed = ?");
        params.push(updates.proposalsDismissed);
      }

      if (setClauses.length === 0) {
        return rowToCycle(existing);
      }

      params.push(id);
      db.prepare(`UPDATE auto_develop_cycles SET ${setClauses.join(", ")} WHERE id = ?`).run(
        ...params,
      );

      const updated = getByIdStmt.get(id) as CycleRow;
      return rowToCycle(updated);
    },

    completeCycle(id: string): AutoDevelopCycle | null {
      const existing = getByIdStmt.get(id) as CycleRow | undefined;
      if (!existing) return null;

      completeStmt.run(id);
      const updated = getByIdStmt.get(id) as CycleRow;
      return rowToCycle(updated);
    },

    getActiveCycle(projectId: string): AutoDevelopCycle | null {
      const row = getActiveStmt.get(projectId) as CycleRow | undefined;
      return row ? rowToCycle(row) : null;
    },

    getCycleHistory(projectId: string, limit = 50): AutoDevelopCycle[] {
      const rows = db
        .prepare(
          "SELECT * FROM auto_develop_cycles WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?",
        )
        .all(projectId, limit) as CycleRow[];
      return rows.map(rowToCycle);
    },
  };
}

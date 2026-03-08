import type Database from "better-sqlite3";

export interface AgentProfile {
  agentId: string;
  lastStatus: string;
  lastStatusAt: string;
  lastActivity: string | null;
  currentTask: string | null;
  currentBeadId: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  assignmentCount: number;
  lastEpicId: string | null;
}

export interface DecisionEntry {
  id?: number;
  behavior: string;
  action: string;
  target: string | null;
  reason: string | null;
  createdAt: string;
}

export interface AdjutantState {
  getAgentProfile(agentId: string): AgentProfile | null;
  upsertAgentProfile(profile: Partial<Omit<AgentProfile, 'lastStatusAt'>> & { agentId: string }): void;
  getAllAgentProfiles(): AgentProfile[];
  /** Atomically increment the assignment count for the given agent. */
  incrementAssignmentCount(agentId: string): void;
  logDecision(entry: Omit<DecisionEntry, "id" | "createdAt">): void;
  getRecentDecisions(limit: number): DecisionEntry[];
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  /** Delete decisions older than the given number of days. Returns count of deleted rows. */
  pruneOldDecisions(olderThanDays: number): number;
}

interface AgentProfileRow {
  agent_id: string;
  last_status: string;
  last_status_at: string;
  last_activity: string | null;
  current_task: string | null;
  current_bead_id: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  assignment_count: number;
  last_epic_id: string | null;
}

interface DecisionRow {
  id: number;
  behavior: string;
  action: string;
  target: string | null;
  reason: string | null;
  created_at: string;
}

interface MetaRow {
  key: string;
  value: string;
  updated_at: string;
}

function rowToProfile(row: AgentProfileRow): AgentProfile {
  return {
    agentId: row.agent_id,
    lastStatus: row.last_status,
    lastStatusAt: row.last_status_at,
    lastActivity: row.last_activity,
    currentTask: row.current_task,
    currentBeadId: row.current_bead_id,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    assignmentCount: row.assignment_count,
    lastEpicId: row.last_epic_id,
  };
}

function rowToDecision(row: DecisionRow): DecisionEntry {
  return {
    id: row.id,
    behavior: row.behavior,
    action: row.action,
    target: row.target,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function createAdjutantState(db: Database.Database): AdjutantState {
  const getProfileStmt = db.prepare(
    "SELECT * FROM adjutant_agent_profiles WHERE agent_id = ?",
  );

  const getAllProfilesStmt = db.prepare(
    "SELECT * FROM adjutant_agent_profiles ORDER BY agent_id",
  );

  const insertProfileStmt = db.prepare(`
    INSERT INTO adjutant_agent_profiles (agent_id, last_status, last_status_at, last_activity, current_task, current_bead_id, connected_at, disconnected_at, assignment_count, last_epic_id)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateProfileStmt = db.prepare(`
    UPDATE adjutant_agent_profiles
    SET last_status = ?, last_status_at = datetime('now'), last_activity = ?,
        current_task = ?, current_bead_id = ?, connected_at = ?, disconnected_at = ?,
        assignment_count = ?, last_epic_id = ?
    WHERE agent_id = ?
  `);

  const incrementAssignmentCountStmt = db.prepare(`
    UPDATE adjutant_agent_profiles SET assignment_count = assignment_count + 1 WHERE agent_id = ?
  `);

  const logDecisionStmt = db.prepare(`
    INSERT INTO adjutant_decisions (behavior, action, target, reason)
    VALUES (?, ?, ?, ?)
  `);

  const getRecentDecisionsStmt = db.prepare(`
    SELECT * FROM adjutant_decisions ORDER BY id DESC LIMIT ?
  `);

  const getMetaStmt = db.prepare(
    "SELECT value FROM adjutant_metadata WHERE key = ?",
  );

  const setMetaStmt = db.prepare(`
    INSERT OR REPLACE INTO adjutant_metadata (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `);

  return {
    getAgentProfile(agentId: string): AgentProfile | null {
      const row = getProfileStmt.get(agentId) as AgentProfileRow | undefined;
      return row !== undefined ? rowToProfile(row) : null;
    },

    upsertAgentProfile(profile: Partial<Omit<AgentProfile, 'lastStatusAt'>> & { agentId: string }): void {
      const existing = getProfileStmt.get(profile.agentId) as AgentProfileRow | undefined;

      if (existing !== undefined) {
        // Merge: only update fields that are provided
        const merged = {
          last_status: profile.lastStatus ?? existing.last_status,
          last_activity: profile.lastActivity !== undefined ? profile.lastActivity : existing.last_activity,
          current_task: profile.currentTask !== undefined ? profile.currentTask : existing.current_task,
          current_bead_id: profile.currentBeadId !== undefined ? profile.currentBeadId : existing.current_bead_id,
          connected_at: profile.connectedAt !== undefined ? profile.connectedAt : existing.connected_at,
          disconnected_at: profile.disconnectedAt !== undefined ? profile.disconnectedAt : existing.disconnected_at,
          assignment_count: profile.assignmentCount !== undefined ? profile.assignmentCount : existing.assignment_count,
          last_epic_id: profile.lastEpicId !== undefined ? profile.lastEpicId : existing.last_epic_id,
        };

        updateProfileStmt.run(
          merged.last_status,
          merged.last_activity,
          merged.current_task,
          merged.current_bead_id,
          merged.connected_at,
          merged.disconnected_at,
          merged.assignment_count,
          merged.last_epic_id,
          profile.agentId,
        );
      } else {
        insertProfileStmt.run(
          profile.agentId,
          profile.lastStatus ?? "unknown",
          profile.lastActivity ?? null,
          profile.currentTask ?? null,
          profile.currentBeadId ?? null,
          profile.connectedAt ?? null,
          profile.disconnectedAt ?? null,
          profile.assignmentCount ?? 0,
          profile.lastEpicId ?? null,
        );
      }
    },

    getAllAgentProfiles(): AgentProfile[] {
      const rows = getAllProfilesStmt.all() as AgentProfileRow[];
      return rows.map(rowToProfile);
    },

    incrementAssignmentCount(agentId: string): void {
      incrementAssignmentCountStmt.run(agentId);
    },

    logDecision(entry: Omit<DecisionEntry, "id" | "createdAt">): void {
      logDecisionStmt.run(entry.behavior, entry.action, entry.target ?? null, entry.reason ?? null);
    },

    getRecentDecisions(limit: number): DecisionEntry[] {
      const safeLimit = Math.max(0, Math.min(limit, 1000));
      const rows = getRecentDecisionsStmt.all(safeLimit) as DecisionRow[];
      return rows.map(rowToDecision);
    },

    getMeta(key: string): string | null {
      const row = getMetaStmt.get(key) as MetaRow | undefined;
      return row !== undefined ? row.value : null;
    },

    setMeta(key: string, value: string): void {
      setMetaStmt.run(key, value);
    },

    pruneOldDecisions(olderThanDays: number): number {
      const stmt = db.prepare(
        "DELETE FROM adjutant_decisions WHERE created_at < datetime('now', '-' || ? || ' days')",
      );
      const result = stmt.run(olderThanDays);
      return result.changes;
    },
  };
}

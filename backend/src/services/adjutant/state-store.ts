import type Database from "better-sqlite3";

export type AgentRole = "coordinator" | "worker" | "qa";

/** Well-known agent IDs that are always treated as coordinators. */
export const KNOWN_COORDINATOR_IDS = new Set([
  "adjutant-coordinator",
  "adjutant",
  "adjutant-core",
]);

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
  role: AgentRole;
}

export interface DecisionEntry {
  id?: number;
  behavior: string;
  action: string;
  target: string | null;
  reason: string | null;
  createdAt: string;
  outcome: string | null;
  outcomeAt: string | null;
}

export interface SpawnRecord {
  id: number;
  agentId: string;
  spawnedAt: string;
  reason: string | null;
  beadId: string | null;
  decommissionedAt: string | null;
}

export interface AdjutantState {
  getAgentProfile(agentId: string): AgentProfile | null;
  upsertAgentProfile(profile: Partial<Omit<AgentProfile, 'lastStatusAt'>> & { agentId: string }): void;
  getAllAgentProfiles(): AgentProfile[];
  /** Atomically increment the assignment count for the given agent. */
  incrementAssignmentCount(agentId: string): void;
  logDecision(entry: Omit<DecisionEntry, "id" | "createdAt" | "outcome" | "outcomeAt">): void;
  getRecentDecisions(limit: number): DecisionEntry[];
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  /** Delete decisions older than the given number of days. Returns count of deleted rows. */
  pruneOldDecisions(olderThanDays: number): number;
  /** Log a new agent spawn. Returns the spawn record ID. */
  logSpawn(agentId: string, reason?: string, beadId?: string): number;
  /** Get spawn history ordered newest first. */
  getSpawnHistory(limit?: number): SpawnRecord[];
  /** Get spawn history for a specific agent, ordered newest first. */
  getAgentSpawnHistory(agentId: string): SpawnRecord[];
  /** Mark a spawn record as decommissioned. */
  markDecommissioned(spawnId: number): void;
  /** Get the most recent spawn for an agent, or null if none. */
  getLastSpawn(agentId: string): SpawnRecord | null;
  /** Count spawns that have not been decommissioned. */
  countActiveSpawns(): number;
  /** Mark all profiles with disconnectedAt IS NULL as disconnected (for server restart cleanup). Returns count updated. */
  markAllDisconnected(): number;
  /** Record the outcome of a decision. */
  recordOutcome(decisionId: number, outcome: string): void;
  /** Get recent decisions that have outcomes (for feedback in prompts). */
  getRecentDecisionsWithOutcomes(limit: number): DecisionEntry[];
  /** Find decisions targeting a specific bead/agent (for linking outcomes). */
  getDecisionsForTarget(target: string, limit?: number): DecisionEntry[];
  /** Check if an agent is a coordinator (by profile role or known ID fallback). */
  isCoordinator(agentId: string): boolean;
  /** Get all agent profiles with the given role. */
  getAgentsByRole(role: AgentRole): AgentProfile[];
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
  role: string;
}

interface DecisionRow {
  id: number;
  behavior: string;
  action: string;
  target: string | null;
  reason: string | null;
  created_at: string;
  outcome: string | null;
  outcome_at: string | null;
}

interface MetaRow {
  key: string;
  value: string;
  updated_at: string;
}

interface SpawnHistoryRow {
  id: number;
  agent_id: string;
  spawned_at: string;
  reason: string | null;
  bead_id: string | null;
  decommissioned_at: string | null;
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
    role: (row.role as AgentRole) ?? "worker",
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
    outcome: row.outcome ?? null,
    outcomeAt: row.outcome_at ?? null,
  };
}

function rowToSpawnRecord(row: SpawnHistoryRow): SpawnRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    spawnedAt: row.spawned_at,
    reason: row.reason,
    beadId: row.bead_id,
    decommissionedAt: row.decommissioned_at,
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
    INSERT INTO adjutant_agent_profiles (agent_id, last_status, last_status_at, last_activity, current_task, current_bead_id, connected_at, disconnected_at, assignment_count, last_epic_id, role)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateProfileStmt = db.prepare(`
    UPDATE adjutant_agent_profiles
    SET last_status = ?, last_status_at = datetime('now'), last_activity = ?,
        current_task = ?, current_bead_id = ?, connected_at = ?, disconnected_at = ?,
        assignment_count = ?, last_epic_id = ?, role = ?
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

  const logSpawnStmt = db.prepare(`
    INSERT INTO adjutant_spawn_history (agent_id, reason, bead_id)
    VALUES (?, ?, ?)
  `);

  const getSpawnHistoryStmt = db.prepare(`
    SELECT * FROM adjutant_spawn_history ORDER BY id DESC LIMIT ?
  `);

  const getAgentSpawnHistoryStmt = db.prepare(`
    SELECT * FROM adjutant_spawn_history WHERE agent_id = ? ORDER BY id DESC
  `);

  const markDecommissionedStmt = db.prepare(`
    UPDATE adjutant_spawn_history SET decommissioned_at = datetime('now') WHERE id = ?
  `);

  const getLastSpawnStmt = db.prepare(`
    SELECT * FROM adjutant_spawn_history WHERE agent_id = ? ORDER BY id DESC LIMIT 1
  `);

  const countActiveSpawnsStmt = db.prepare(`
    SELECT COUNT(*) AS count FROM adjutant_spawn_history WHERE decommissioned_at IS NULL
  `);

  const markAllDisconnectedStmt = db.prepare(`
    UPDATE adjutant_agent_profiles
    SET disconnected_at = datetime('now'), last_status = 'disconnected'
    WHERE disconnected_at IS NULL AND connected_at IS NOT NULL
  `);

  const recordOutcomeStmt = db.prepare(`
    UPDATE adjutant_decisions SET outcome = ?, outcome_at = datetime('now') WHERE id = ?
  `);

  const getRecentDecisionsWithOutcomesStmt = db.prepare(`
    SELECT * FROM adjutant_decisions WHERE outcome IS NOT NULL ORDER BY outcome_at DESC LIMIT ?
  `);

  const getDecisionsForTargetStmt = db.prepare(`
    SELECT * FROM adjutant_decisions WHERE target = ? ORDER BY id DESC LIMIT ?
  `);

  const getAgentsByRoleStmt = db.prepare(
    "SELECT * FROM adjutant_agent_profiles WHERE role = ? ORDER BY agent_id",
  );

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
          role: profile.role !== undefined ? profile.role : existing.role,
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
          merged.role,
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
          profile.role ?? "worker",
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

    logDecision(entry: Omit<DecisionEntry, "id" | "createdAt" | "outcome" | "outcomeAt">): void {
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

    logSpawn(agentId: string, reason?: string, beadId?: string): number {
      const result = logSpawnStmt.run(agentId, reason ?? null, beadId ?? null);
      return Number(result.lastInsertRowid);
    },

    getSpawnHistory(limit?: number): SpawnRecord[] {
      const safeLimit = limit !== undefined ? Math.max(0, Math.min(limit, 1000)) : 1000;
      const rows = getSpawnHistoryStmt.all(safeLimit) as SpawnHistoryRow[];
      return rows.map(rowToSpawnRecord);
    },

    getAgentSpawnHistory(agentId: string): SpawnRecord[] {
      const rows = getAgentSpawnHistoryStmt.all(agentId) as SpawnHistoryRow[];
      return rows.map(rowToSpawnRecord);
    },

    markDecommissioned(spawnId: number): void {
      markDecommissionedStmt.run(spawnId);
    },

    getLastSpawn(agentId: string): SpawnRecord | null {
      const row = getLastSpawnStmt.get(agentId) as SpawnHistoryRow | undefined;
      return row !== undefined ? rowToSpawnRecord(row) : null;
    },

    countActiveSpawns(): number {
      const row = countActiveSpawnsStmt.get() as { count: number };
      return row.count;
    },

    markAllDisconnected(): number {
      const result = markAllDisconnectedStmt.run();
      return result.changes;
    },

    recordOutcome(decisionId: number, outcome: string): void {
      recordOutcomeStmt.run(outcome, decisionId);
    },

    getRecentDecisionsWithOutcomes(limit: number): DecisionEntry[] {
      const safeLimit = Math.max(0, Math.min(limit, 1000));
      const rows = getRecentDecisionsWithOutcomesStmt.all(safeLimit) as DecisionRow[];
      return rows.map(rowToDecision);
    },

    getDecisionsForTarget(target: string, limit?: number): DecisionEntry[] {
      const safeLimit = limit !== undefined ? Math.max(0, Math.min(limit, 100)) : 10;
      const rows = getDecisionsForTargetStmt.all(target, safeLimit) as DecisionRow[];
      return rows.map(rowToDecision);
    },

    isCoordinator(agentId: string): boolean {
      const profile = getProfileStmt.get(agentId) as AgentProfileRow | undefined;
      if (profile !== undefined) {
        return profile.role === "coordinator";
      }
      return KNOWN_COORDINATOR_IDS.has(agentId);
    },

    getAgentsByRole(role: AgentRole): AgentProfile[] {
      const rows = getAgentsByRoleStmt.all(role) as AgentProfileRow[];
      return rows.map(rowToProfile);
    },
  };
}

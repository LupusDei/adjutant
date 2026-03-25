import type Database from "better-sqlite3";

// ============================================================================
// Types
// ============================================================================

export interface Learning {
  id: number;
  category: string;
  topic: string;
  content: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: number;
  reinforcementCount: number;
  lastAppliedAt: string | null;
  lastValidatedAt: string | null;
  supersededBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewLearning {
  category: string;
  topic: string;
  content: string;
  sourceType: string;
  sourceRef?: string;
  confidence?: number;
}

export interface Retrospective {
  id: number;
  sessionDate: string;
  beadsClosed: number;
  beadsFailed: number;
  correctionsReceived: number;
  agentsUsed: number;
  avgBeadTimeMins: number | null;
  wentWell: string | null;
  wentWrong: string | null;
  actionItems: string | null;
  metrics: string | null;
  createdAt: string;
}

export interface NewRetrospective {
  sessionDate: string;
  beadsClosed?: number;
  beadsFailed?: number;
  correctionsReceived?: number;
  agentsUsed?: number;
  avgBeadTimeMins?: number;
  wentWell?: string;
  wentWrong?: string;
  actionItems?: string;
  metrics?: string;
}

export interface Correction {
  id: number;
  messageId: string | null;
  correctionType: string;
  pattern: string;
  description: string;
  learningId: number | null;
  recurrenceCount: number;
  lastRecurrenceAt: string | null;
  resolved: boolean;
  createdAt: string;
}

export interface NewCorrection {
  messageId?: string;
  correctionType: string;
  pattern: string;
  description: string;
  learningId?: number;
}

export interface LearningQuery {
  category?: string;
  topic?: string;
  minConfidence?: number;
  includeSuperseded?: boolean;
  limit?: number;
}

export interface TopicFrequency {
  topic: string;
  count: number;
}

// ============================================================================
// Row types (snake_case from SQLite)
// ============================================================================

interface LearningRow {
  id: number;
  category: string;
  topic: string;
  content: string;
  source_type: string;
  source_ref: string | null;
  confidence: number;
  reinforcement_count: number;
  last_applied_at: string | null;
  last_validated_at: string | null;
  superseded_by: number | null;
  created_at: string;
  updated_at: string;
}

interface RetrospectiveRow {
  id: number;
  session_date: string;
  beads_closed: number;
  beads_failed: number;
  corrections_received: number;
  agents_used: number;
  avg_bead_time_mins: number | null;
  went_well: string | null;
  went_wrong: string | null;
  action_items: string | null;
  metrics: string | null;
  created_at: string;
}

interface CorrectionRow {
  id: number;
  message_id: string | null;
  correction_type: string;
  pattern: string;
  description: string;
  learning_id: number | null;
  recurrence_count: number;
  last_recurrence_at: string | null;
  resolved: number;
  created_at: string;
}

interface TopicFrequencyRow {
  topic: string;
  count: number;
}

// ============================================================================
// Row mappers
// ============================================================================

function rowToLearning(row: LearningRow): Learning {
  return {
    id: row.id,
    category: row.category,
    topic: row.topic,
    content: row.content,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    confidence: row.confidence,
    reinforcementCount: row.reinforcement_count,
    lastAppliedAt: row.last_applied_at,
    lastValidatedAt: row.last_validated_at,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRetrospective(row: RetrospectiveRow): Retrospective {
  return {
    id: row.id,
    sessionDate: row.session_date,
    beadsClosed: row.beads_closed,
    beadsFailed: row.beads_failed,
    correctionsReceived: row.corrections_received,
    agentsUsed: row.agents_used,
    avgBeadTimeMins: row.avg_bead_time_mins,
    wentWell: row.went_well,
    wentWrong: row.went_wrong,
    actionItems: row.action_items,
    metrics: row.metrics,
    createdAt: row.created_at,
  };
}

function rowToCorrection(row: CorrectionRow): Correction {
  return {
    id: row.id,
    messageId: row.message_id,
    correctionType: row.correction_type,
    pattern: row.pattern,
    description: row.description,
    learningId: row.learning_id,
    recurrenceCount: row.recurrence_count,
    lastRecurrenceAt: row.last_recurrence_at,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
  };
}

// ============================================================================
// MemoryStore Interface
// ============================================================================

export interface MemoryStore {
  // Learnings
  insertLearning(learning: NewLearning): Learning;
  getLearning(id: number): Learning | null;
  updateLearning(id: number, updates: Partial<Pick<Learning, "content" | "confidence" | "category" | "topic" | "lastAppliedAt" | "lastValidatedAt">>): void;
  queryLearnings(query: LearningQuery): Learning[];
  searchLearnings(searchText: string, limit?: number): Learning[];
  findSimilarLearnings(topic: string, contentQuery: string): Learning[];
  reinforceLearning(id: number): void;
  supersedeLearning(oldId: number, newId: number): void;
  pruneStale(staleThresholdDays: number): number;

  // Retrospectives
  insertRetrospective(retro: NewRetrospective): Retrospective;
  getRecentRetrospectives(limit: number): Retrospective[];

  // Corrections
  insertCorrection(correction: NewCorrection): Correction;
  findSimilarCorrection(correctionType: string, pattern: string): Correction | null;
  incrementRecurrence(id: number): void;
  getUnresolvedCorrections(): Correction[];

  // Analytics
  getTopicFrequency(): TopicFrequency[];
  getCorrectionRecurrenceRate(minRecurrence: number): Correction[];
  getLearningEffectiveness(limit: number): Learning[];
}

// ============================================================================
// FTS5 query sanitization
// ============================================================================

/**
 * Sanitize a string for safe use in FTS5 MATCH queries.
 * Wraps the input in double quotes to treat it as a literal phrase,
 * escaping internal double quotes per FTS5 syntax.
 * Returns null for empty/whitespace-only input.
 */
function sanitizeFts5Query(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return '"' + trimmed.replace(/"/g, '""') + '"';
}

// ============================================================================
// Factory
// ============================================================================

export function createMemoryStore(db: Database.Database): MemoryStore {
  // ---- Learnings prepared statements ----
  const insertLearningStmt = db.prepare(`
    INSERT INTO adjutant_learnings (category, topic, content, source_type, source_ref, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const getLearningStmt = db.prepare(
    "SELECT * FROM adjutant_learnings WHERE id = ?"
  );

  const reinforceStmt = db.prepare(`
    UPDATE adjutant_learnings
    SET reinforcement_count = reinforcement_count + 1,
        confidence = MIN(1.0, confidence + (1.0 - confidence) * 0.1),
        updated_at = datetime('now')
    WHERE id = ?
  `);

  const supersedeStmt = db.prepare(`
    UPDATE adjutant_learnings SET superseded_by = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const transferReinforcementStmt = db.prepare(`
    UPDATE adjutant_learnings
    SET reinforcement_count = reinforcement_count + (SELECT reinforcement_count FROM adjutant_learnings WHERE id = ?),
        updated_at = datetime('now')
    WHERE id = ?
  `);

  // ---- Retrospectives prepared statements ----
  const insertRetroStmt = db.prepare(`
    INSERT INTO adjutant_retrospectives (session_date, beads_closed, beads_failed, corrections_received, agents_used, avg_bead_time_mins, went_well, went_wrong, action_items, metrics)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getRecentRetrosStmt = db.prepare(
    "SELECT * FROM adjutant_retrospectives ORDER BY session_date DESC LIMIT ?"
  );

  // ---- Corrections prepared statements ----
  const insertCorrectionStmt = db.prepare(`
    INSERT INTO adjutant_corrections (message_id, correction_type, pattern, description, learning_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const findSimilarCorrectionStmt = db.prepare(
    "SELECT * FROM adjutant_corrections WHERE correction_type = ? AND pattern = ? LIMIT 1"
  );

  const incrementRecurrenceStmt = db.prepare(`
    UPDATE adjutant_corrections
    SET recurrence_count = recurrence_count + 1,
        last_recurrence_at = datetime('now')
    WHERE id = ?
  `);

  const getUnresolvedStmt = db.prepare(
    "SELECT * FROM adjutant_corrections WHERE resolved = 0 ORDER BY recurrence_count DESC"
  );

  // ---- Analytics prepared statements ----
  const topicFrequencyStmt = db.prepare(`
    SELECT topic, COUNT(*) as count FROM adjutant_learnings
    WHERE superseded_by IS NULL
    GROUP BY topic ORDER BY count DESC
  `);

  const recurrenceRateStmt = db.prepare(
    "SELECT * FROM adjutant_corrections WHERE recurrence_count >= ? ORDER BY recurrence_count DESC"
  );

  const effectivenessStmt = db.prepare(`
    SELECT * FROM adjutant_learnings
    WHERE superseded_by IS NULL
    ORDER BY (reinforcement_count * confidence) DESC
    LIMIT ?
  `);

  return {
    // ==== Learnings ====

    insertLearning(learning: NewLearning): Learning {
      const result = insertLearningStmt.run(
        learning.category,
        learning.topic,
        learning.content,
        learning.sourceType,
        learning.sourceRef ?? null,
        learning.confidence ?? 0.5,
      );
      const id = Number(result.lastInsertRowid);
      return rowToLearning(getLearningStmt.get(id) as LearningRow);
    },

    getLearning(id: number): Learning | null {
      const row = getLearningStmt.get(id) as LearningRow | undefined;
      return row !== undefined ? rowToLearning(row) : null;
    },

    updateLearning(id: number, updates: Partial<Pick<Learning, "content" | "confidence" | "category" | "topic" | "lastAppliedAt" | "lastValidatedAt">>): void {
      const setClauses: string[] = [];
      const values: (string | number | null)[] = [];

      if (updates.content !== undefined) {
        setClauses.push("content = ?");
        values.push(updates.content);
      }
      if (updates.confidence !== undefined) {
        setClauses.push("confidence = ?");
        values.push(updates.confidence);
      }
      if (updates.category !== undefined) {
        setClauses.push("category = ?");
        values.push(updates.category);
      }
      if (updates.topic !== undefined) {
        setClauses.push("topic = ?");
        values.push(updates.topic);
      }
      if (updates.lastAppliedAt !== undefined) {
        setClauses.push("last_applied_at = ?");
        values.push(updates.lastAppliedAt);
      }
      if (updates.lastValidatedAt !== undefined) {
        setClauses.push("last_validated_at = ?");
        values.push(updates.lastValidatedAt);
      }

      if (setClauses.length === 0) return;

      setClauses.push("updated_at = datetime('now')");
      values.push(id);

      db.prepare(
        `UPDATE adjutant_learnings SET ${setClauses.join(", ")} WHERE id = ?`
      ).run(...values);
    },

    queryLearnings(query: LearningQuery): Learning[] {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (query.category !== undefined) {
        conditions.push("category = ?");
        params.push(query.category);
      }
      if (query.topic !== undefined) {
        conditions.push("topic = ?");
        params.push(query.topic);
      }
      if (query.minConfidence !== undefined) {
        conditions.push("confidence >= ?");
        params.push(query.minConfidence);
      }
      if (!query.includeSuperseded) {
        conditions.push("superseded_by IS NULL");
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const hasLimit = query.limit !== undefined;
      const limitClause = hasLimit ? "LIMIT ?" : "";
      if (hasLimit) {
        params.push(Math.max(0, Math.min(query.limit!, 1000)));
      }

      const sql = `SELECT * FROM adjutant_learnings ${where} ORDER BY updated_at DESC ${limitClause}`;
      const rows = db.prepare(sql).all(...params) as LearningRow[];
      return rows.map(rowToLearning);
    },

    searchLearnings(searchText: string, limit = 20): Learning[] {
      const sanitized = sanitizeFts5Query(searchText);
      if (sanitized === null) return [];

      const rows = db.prepare(`
        SELECT l.* FROM adjutant_learnings l
        INNER JOIN adjutant_learnings_fts fts ON l.id = fts.rowid
        WHERE adjutant_learnings_fts MATCH ?
        AND l.superseded_by IS NULL
        ORDER BY rank
        LIMIT ?
      `).all(sanitized, limit) as LearningRow[];
      return rows.map(rowToLearning);
    },

    findSimilarLearnings(topic: string, contentQuery: string): Learning[] {
      const sanitized = sanitizeFts5Query(contentQuery);
      if (sanitized === null) return [];

      const rows = db.prepare(`
        SELECT l.* FROM adjutant_learnings l
        INNER JOIN adjutant_learnings_fts fts ON l.id = fts.rowid
        WHERE l.topic = ? AND adjutant_learnings_fts MATCH ?
        AND l.superseded_by IS NULL
        LIMIT 10
      `).all(topic, sanitized) as LearningRow[];
      return rows.map(rowToLearning);
    },

    reinforceLearning(id: number): void {
      reinforceStmt.run(id);
    },

    supersedeLearning(oldId: number, newId: number): void {
      // Check for circular supersede chains: walk from newId following
      // superseded_by links — if we ever reach oldId, it's a cycle.
      let currentId: number | null = newId;
      const visited = new Set<number>();
      while (currentId !== null) {
        if (currentId === oldId) {
          throw new Error(
            `Circular supersede chain detected: setting learning ${oldId} superseded_by ${newId} would create a cycle`
          );
        }
        if (visited.has(currentId)) break;
        visited.add(currentId);
        const row = db.prepare(
          "SELECT superseded_by FROM adjutant_learnings WHERE id = ?"
        ).get(currentId) as { superseded_by: number | null } | undefined;
        currentId = row?.superseded_by ?? null;
      }

      db.transaction(() => {
        transferReinforcementStmt.run(oldId, newId);
        supersedeStmt.run(newId, oldId);
      })();
    },

    pruneStale(staleThresholdDays: number): number {
      return db.transaction(() => {
        // Delete learnings with very low confidence that are stale (effectively dead)
        const deleteResult = db.prepare(`
          DELETE FROM adjutant_learnings
          WHERE updated_at < datetime('now', '-' || ? || ' days')
          AND superseded_by IS NULL
          AND confidence < 0.1
        `).run(staleThresholdDays);

        // Apply 5% decay to remaining stale learnings
        const decayResult = db.prepare(`
          UPDATE adjutant_learnings
          SET confidence = confidence * 0.95,
              updated_at = datetime('now')
          WHERE updated_at < datetime('now', '-' || ? || ' days')
          AND superseded_by IS NULL
          AND confidence > 0.05
        `).run(staleThresholdDays);

        return deleteResult.changes + decayResult.changes;
      })();
    },

    // ==== Retrospectives ====

    insertRetrospective(retro: NewRetrospective): Retrospective {
      const result = insertRetroStmt.run(
        retro.sessionDate,
        retro.beadsClosed ?? 0,
        retro.beadsFailed ?? 0,
        retro.correctionsReceived ?? 0,
        retro.agentsUsed ?? 0,
        retro.avgBeadTimeMins ?? null,
        retro.wentWell ?? null,
        retro.wentWrong ?? null,
        retro.actionItems ?? null,
        retro.metrics ?? null,
      );
      const id = Number(result.lastInsertRowid);
      const row = db.prepare("SELECT * FROM adjutant_retrospectives WHERE id = ?").get(id) as RetrospectiveRow;
      return rowToRetrospective(row);
    },

    getRecentRetrospectives(limit: number): Retrospective[] {
      const safeLimit = Math.max(0, Math.min(limit, 100));
      const rows = getRecentRetrosStmt.all(safeLimit) as RetrospectiveRow[];
      return rows.map(rowToRetrospective);
    },

    // ==== Corrections ====

    insertCorrection(correction: NewCorrection): Correction {
      const result = insertCorrectionStmt.run(
        correction.messageId ?? null,
        correction.correctionType,
        correction.pattern,
        correction.description,
        correction.learningId ?? null,
      );
      const id = Number(result.lastInsertRowid);
      const row = db.prepare("SELECT * FROM adjutant_corrections WHERE id = ?").get(id) as CorrectionRow;
      return rowToCorrection(row);
    },

    findSimilarCorrection(correctionType: string, pattern: string): Correction | null {
      const row = findSimilarCorrectionStmt.get(correctionType, pattern) as CorrectionRow | undefined;
      return row !== undefined ? rowToCorrection(row) : null;
    },

    incrementRecurrence(id: number): void {
      incrementRecurrenceStmt.run(id);
    },

    getUnresolvedCorrections(): Correction[] {
      const rows = getUnresolvedStmt.all() as CorrectionRow[];
      return rows.map(rowToCorrection);
    },

    // ==== Analytics ====

    getTopicFrequency(): TopicFrequency[] {
      return topicFrequencyStmt.all() as TopicFrequencyRow[];
    },

    getCorrectionRecurrenceRate(minRecurrence: number): Correction[] {
      const rows = recurrenceRateStmt.all(minRecurrence) as CorrectionRow[];
      return rows.map(rowToCorrection);
    },

    getLearningEffectiveness(limit: number): Learning[] {
      const safeLimit = Math.max(0, Math.min(limit, 100));
      const rows = effectivenessStmt.all(safeLimit) as LearningRow[];
      return rows.map(rowToLearning);
    },
  };
}

-- Adjutant persistent memory tables for self-correcting learning system

-- Core learnings table
CREATE TABLE IF NOT EXISTS adjutant_learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,              -- 'operational'|'technical'|'coordination'|'project'
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,           -- 'user_correction'|'bead_outcome'|'agent_failure'|'observation'
  source_ref TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_applied_at TEXT,
  last_validated_at TEXT,
  superseded_by INTEGER REFERENCES adjutant_learnings(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session retrospectives
CREATE TABLE IF NOT EXISTS adjutant_retrospectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_date TEXT NOT NULL,
  beads_closed INTEGER NOT NULL DEFAULT 0,
  beads_failed INTEGER NOT NULL DEFAULT 0,
  corrections_received INTEGER NOT NULL DEFAULT 0,
  agents_used INTEGER NOT NULL DEFAULT 0,
  avg_bead_time_mins REAL,
  went_well TEXT,
  went_wrong TEXT,
  action_items TEXT,
  metrics TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Correction tracking
CREATE TABLE IF NOT EXISTS adjutant_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  correction_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  description TEXT NOT NULL,
  learning_id INTEGER REFERENCES adjutant_learnings(id),
  recurrence_count INTEGER NOT NULL DEFAULT 0,
  last_recurrence_at TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 virtual table for full-text search on learnings
CREATE VIRTUAL TABLE IF NOT EXISTS adjutant_learnings_fts USING fts5(
  content, topic, category,
  content=adjutant_learnings,
  content_rowid=id
);

-- Triggers to keep FTS5 index in sync with adjutant_learnings

-- After INSERT: add new row to FTS
CREATE TRIGGER IF NOT EXISTS adjutant_learnings_ai AFTER INSERT ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(rowid, content, topic, category)
  VALUES (new.id, new.content, new.topic, new.category);
END;

-- After DELETE: remove row from FTS
CREATE TRIGGER IF NOT EXISTS adjutant_learnings_ad AFTER DELETE ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(adjutant_learnings_fts, rowid, content, topic, category)
  VALUES ('delete', old.id, old.content, old.topic, old.category);
END;

-- After UPDATE: remove old, insert new in FTS
CREATE TRIGGER IF NOT EXISTS adjutant_learnings_au AFTER UPDATE ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(adjutant_learnings_fts, rowid, content, topic, category)
  VALUES ('delete', old.id, old.content, old.topic, old.category);
  INSERT INTO adjutant_learnings_fts(rowid, content, topic, category)
  VALUES (new.id, new.content, new.topic, new.category);
END;

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_adjutant_learnings_category ON adjutant_learnings(category);
CREATE INDEX IF NOT EXISTS idx_adjutant_learnings_topic ON adjutant_learnings(topic);
CREATE INDEX IF NOT EXISTS idx_adjutant_learnings_confidence ON adjutant_learnings(confidence);
CREATE INDEX IF NOT EXISTS idx_adjutant_corrections_learning_id ON adjutant_corrections(learning_id);
CREATE INDEX IF NOT EXISTS idx_adjutant_retrospectives_session_date ON adjutant_retrospectives(session_date);

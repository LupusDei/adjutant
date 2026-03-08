-- Add CHECK constraints, UNIQUE constraint, and ON DELETE SET NULL
-- for the memory store tables (adj-3kyx, adj-bcsy, adj-fz5d, adj-hw2m)

-- SQLite does not support ALTER TABLE ADD CONSTRAINT, so we must
-- recreate tables with the new constraints and migrate data.

-- ============================================================================
-- adjutant_learnings: add CHECK constraints + ON DELETE SET NULL for FK
-- ============================================================================

-- Drop existing FTS triggers (they reference adjutant_learnings)
DROP TRIGGER IF EXISTS adjutant_learnings_ai;
DROP TRIGGER IF EXISTS adjutant_learnings_ad;
DROP TRIGGER IF EXISTS adjutant_learnings_au;

CREATE TABLE adjutant_learnings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK(length(category) > 0),
  topic TEXT NOT NULL CHECK(length(topic) > 0),
  content TEXT NOT NULL CHECK(length(content) > 0),
  source_type TEXT NOT NULL,
  source_ref TEXT,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_applied_at TEXT,
  last_validated_at TEXT,
  superseded_by INTEGER REFERENCES adjutant_learnings_new(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO adjutant_learnings_new
  SELECT * FROM adjutant_learnings;

DROP TABLE adjutant_learnings;
ALTER TABLE adjutant_learnings_new RENAME TO adjutant_learnings;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_adjutant_learnings_category ON adjutant_learnings(category);
CREATE INDEX IF NOT EXISTS idx_adjutant_learnings_topic ON adjutant_learnings(topic);
CREATE INDEX IF NOT EXISTS idx_adjutant_learnings_confidence ON adjutant_learnings(confidence);

-- Recreate FTS triggers
CREATE TRIGGER IF NOT EXISTS adjutant_learnings_ai AFTER INSERT ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(rowid, content, topic, category)
  VALUES (new.id, new.content, new.topic, new.category);
END;

CREATE TRIGGER IF NOT EXISTS adjutant_learnings_ad AFTER DELETE ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(adjutant_learnings_fts, rowid, content, topic, category)
  VALUES ('delete', old.id, old.content, old.topic, old.category);
END;

CREATE TRIGGER IF NOT EXISTS adjutant_learnings_au AFTER UPDATE ON adjutant_learnings BEGIN
  INSERT INTO adjutant_learnings_fts(adjutant_learnings_fts, rowid, content, topic, category)
  VALUES ('delete', old.id, old.content, old.topic, old.category);
  INSERT INTO adjutant_learnings_fts(rowid, content, topic, category)
  VALUES (new.id, new.content, new.topic, new.category);
END;

-- ============================================================================
-- adjutant_retrospectives: add UNIQUE constraint on session_date
-- ============================================================================

CREATE TABLE adjutant_retrospectives_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_date TEXT NOT NULL UNIQUE,
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

-- Deduplicate: keep the row with the highest id for each session_date
INSERT INTO adjutant_retrospectives_new
  SELECT * FROM adjutant_retrospectives
  WHERE id IN (
    SELECT MAX(id) FROM adjutant_retrospectives GROUP BY session_date
  );

DROP TABLE adjutant_retrospectives;
ALTER TABLE adjutant_retrospectives_new RENAME TO adjutant_retrospectives;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_adjutant_retrospectives_session_date ON adjutant_retrospectives(session_date);

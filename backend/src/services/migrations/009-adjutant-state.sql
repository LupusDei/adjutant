-- Adjutant persistent state tables

CREATE TABLE IF NOT EXISTS adjutant_agent_profiles (
  agent_id TEXT PRIMARY KEY,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_status_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity TEXT,
  current_task TEXT,
  current_bead_id TEXT,
  connected_at TEXT,
  disconnected_at TEXT
);

CREATE TABLE IF NOT EXISTS adjutant_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  behavior TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adjutant_decisions_behavior ON adjutant_decisions(behavior);
CREATE INDEX IF NOT EXISTS idx_adjutant_decisions_created ON adjutant_decisions(created_at);

CREATE TABLE IF NOT EXISTS adjutant_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS adjutant_spawn_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  spawned_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT,
  bead_id TEXT,
  decommissioned_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_adjutant_spawn_history_agent ON adjutant_spawn_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_adjutant_spawn_history_spawned ON adjutant_spawn_history(spawned_at);

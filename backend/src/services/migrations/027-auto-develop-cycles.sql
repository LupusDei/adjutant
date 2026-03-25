CREATE TABLE IF NOT EXISTS auto_develop_cycles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  proposals_generated INTEGER NOT NULL DEFAULT 0,
  proposals_accepted INTEGER NOT NULL DEFAULT 0,
  proposals_escalated INTEGER NOT NULL DEFAULT 0,
  proposals_dismissed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_auto_develop_cycles_project ON auto_develop_cycles(project_id);
CREATE INDEX IF NOT EXISTS idx_auto_develop_cycles_phase ON auto_develop_cycles(phase);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  bead_id TEXT,
  message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_bead ON events(bead_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

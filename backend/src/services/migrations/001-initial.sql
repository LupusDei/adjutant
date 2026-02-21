CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','agent','system','announcement')),
  body TEXT NOT NULL,
  metadata TEXT,
  delivery_status TEXT DEFAULT 'sent' CHECK(delivery_status IN ('pending','sent','delivered','read')),
  event_type TEXT,
  thread_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(delivery_status);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body, content=messages, content_rowid=rowid
);

-- FTS triggers
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

-- Agent connections table
CREATE TABLE IF NOT EXISTS agent_connections (
  agent_id TEXT PRIMARY KEY,
  session_id TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  disconnected_at TEXT,
  status TEXT DEFAULT 'connected'
);

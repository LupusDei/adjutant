CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK(platform IN ('ios', 'macos')),
  agent_id TEXT,
  bundle_id TEXT NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_platform ON device_tokens(platform);
CREATE INDEX IF NOT EXISTS idx_device_tokens_agent ON device_tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_last_seen ON device_tokens(last_seen_at);

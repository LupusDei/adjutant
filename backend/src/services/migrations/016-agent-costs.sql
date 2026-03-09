-- Agent cost tracking: per-session cost and token data (replaces JSON file persistence)
CREATE TABLE IF NOT EXISTS agent_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  bead_id TEXT,
  project_path TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_costs_session ON agent_costs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_costs_bead ON agent_costs(bead_id);
CREATE INDEX IF NOT EXISTS idx_agent_costs_recorded ON agent_costs(recorded_at);

-- Budget management for cost alerts
CREATE TABLE IF NOT EXISTS cost_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'session',
  scope_id TEXT,
  budget_amount REAL NOT NULL,
  warning_percent REAL DEFAULT 80,
  critical_percent REAL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

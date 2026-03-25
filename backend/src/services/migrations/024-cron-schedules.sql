CREATE TABLE IF NOT EXISTS cron_schedules (
  id TEXT PRIMARY KEY,
  cron_expr TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_fired_at TEXT,
  next_fire_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  max_fires INTEGER,
  fire_count INTEGER NOT NULL DEFAULT 0
);

-- Personas table: stores agent persona configurations with trait-based point budgets.
-- Each persona has 12 personality traits stored as a JSON object in the traits column.
-- Name uniqueness is enforced case-insensitively via COLLATE NOCASE.

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL,  -- JSON object with all 12 trait keys, each 0-20
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_personas_name ON personas(name COLLATE NOCASE);

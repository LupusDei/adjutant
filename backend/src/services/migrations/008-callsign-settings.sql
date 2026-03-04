-- Callsign settings table: persists enabled/disabled state for individual StarCraft callsigns.
-- Also stores a master toggle row with name='__master__'.
-- When a callsign is disabled, it's excluded from auto-assignment in pickRandomCallsign().

CREATE TABLE IF NOT EXISTS callsign_settings (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,  -- 1=enabled, 0=disabled
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

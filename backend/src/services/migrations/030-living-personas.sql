-- Living Personas (adj-158): callsign-to-persona linkage, evolution tracking, persona source

-- Junction table linking StarCraft callsigns to persona records
CREATE TABLE IF NOT EXISTS callsign_personas (
  callsign TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_callsign_personas_persona ON callsign_personas(persona_id);

-- Evolution log tracking trait changes over time
CREATE TABLE IF NOT EXISTS persona_evolution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id TEXT NOT NULL,
  trait TEXT NOT NULL,
  old_value INTEGER NOT NULL,
  new_value INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persona_evolution_persona ON persona_evolution_log(persona_id);

-- Add source field to personas table (hand-crafted vs self-generated)
ALTER TABLE personas ADD COLUMN source TEXT DEFAULT 'hand-crafted';

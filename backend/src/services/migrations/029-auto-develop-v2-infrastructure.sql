-- Auto-Develop V2: escalation tracking on cycles + proposal linkage
ALTER TABLE auto_develop_cycles ADD COLUMN escalation_count INTEGER DEFAULT 0;
ALTER TABLE auto_develop_cycles ADD COLUMN last_escalation_at TEXT DEFAULT NULL;

-- Proposal-to-epic linkage: track which proposals spawned which epics
CREATE TABLE IF NOT EXISTS proposal_epics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  epic_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(proposal_id, epic_id)
);
CREATE INDEX IF NOT EXISTS idx_proposal_epics_proposal ON proposal_epics(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_epics_epic ON proposal_epics(epic_id);

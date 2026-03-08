-- Work assignment tracking columns for agent profiles
ALTER TABLE adjutant_agent_profiles ADD COLUMN assignment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE adjutant_agent_profiles ADD COLUMN last_epic_id TEXT;

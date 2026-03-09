-- Agent role taxonomy: add role column to agent profiles
ALTER TABLE adjutant_agent_profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'worker';

-- Add context_percent column to agent_costs for persistence across restarts (adj-nygv)
ALTER TABLE agent_costs ADD COLUMN context_percent REAL DEFAULT NULL;

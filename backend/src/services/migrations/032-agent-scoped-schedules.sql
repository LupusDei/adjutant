-- adj-163: Agent-scoped scheduling
-- Add target_agent and target_tmux_session to cron_schedules.
-- Existing schedules default to the adjutant-coordinator.
-- When a schedule fires, the wake is delivered to target_agent's tmux session.
-- When a session dies, all schedules targeting that agent are disabled.
ALTER TABLE cron_schedules ADD COLUMN target_agent TEXT NOT NULL DEFAULT 'adjutant-coordinator';
ALTER TABLE cron_schedules ADD COLUMN target_tmux_session TEXT NOT NULL DEFAULT 'adj-swarm-adjutant-coordinator';

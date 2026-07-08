-- adj-pyhm4: persist agent last-known status across backend restarts.
--
-- Live agent status is otherwise held IN-MEMORY only (mcp-tools/status.ts
-- `agentStatuses` Map + mcp-server `connections` Map). Every backend restart
-- (frequent during live updates/redeploys) wipes it, so on reconnect the roster
-- falsely shows everyone idle/booting until each agent re-reports.
--
-- This is a lightweight last-known snapshot — ONE row per agent, write-through
-- on every status transition, hydrated into the in-memory registry on boot.
-- Liveness (is the agent currently connected?) is NOT stored — it is derived at
-- read time from the live MCP connection registry; this table only remembers the
-- last-known status + when it was last seen. Transient runtime metrics
-- (cost, context %) are intentionally excluded: they are re-reported live on
-- reconnect and a stale persisted value would be misleading.

CREATE TABLE IF NOT EXISTS agent_status (
  agent_id     TEXT PRIMARY KEY,
  status       TEXT NOT NULL,
  current_task TEXT,
  bead_id      TEXT,
  project_id   TEXT,
  updated_at   TEXT NOT NULL
);

-- Roster views filter/scope by project.
CREATE INDEX IF NOT EXISTS idx_agent_status_project ON agent_status(project_id);

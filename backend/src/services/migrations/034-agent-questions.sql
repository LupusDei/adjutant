-- adj-181.1.2 — Agent question triage data model.
--
-- A first-class, triageable agent question/answer entity. Agents file questions
-- via the file_question MCP tool; the General triages and answers them. A filed
-- question also mirrors into the asking agent's DM conversation (linked via
-- conversation_id) so nothing about today's chat flow is lost.
--
-- urgency values: low | normal (default) | high | blocking
-- status values:  open (default) | answered | dismissed
-- category: free text (decision|clarification|approval|action_required|other
--           are the recommended values but not enforced by a CHECK constraint,
--           per the plan — Phase 2+ can evolve the vocabulary without a migration)
-- suggested_options: JSON array string (e.g. '["yes","no"]'), nullable
-- answered_at: NULL until answered/dismissed

CREATE TABLE IF NOT EXISTS agent_questions (
  id               TEXT NOT NULL PRIMARY KEY,
  project_id       TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  body             TEXT NOT NULL,
  context          TEXT,
  category         TEXT,
  suggested_options TEXT,
  urgency          TEXT NOT NULL DEFAULT 'normal'
                     CHECK(urgency IN ('low','normal','high','blocking')),
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK(status IN ('open','answered','dismissed')),
  answer_body      TEXT,
  chosen_option    TEXT,
  answered_by      TEXT,
  bead_id          TEXT,
  conversation_id  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at      TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Primary triage sort: (status, urgency, created_at) — used by listQuestions()
-- Sort order within urgency is handled in the query (CASE expression), but
-- this composite index covers the common filtered-by-status + ordered query.
CREATE INDEX IF NOT EXISTS idx_agent_questions_status
  ON agent_questions(status, urgency, created_at);

-- Project-scoped list (the dominant filter for multi-project setups)
CREATE INDEX IF NOT EXISTS idx_agent_questions_project
  ON agent_questions(project_id, status);

-- Category-filtered list (triage by type)
CREATE INDEX IF NOT EXISTS idx_agent_questions_category
  ON agent_questions(category, status);

-- Agent-specific list (see all questions from one agent)
CREATE INDEX IF NOT EXISTS idx_agent_questions_agent
  ON agent_questions(agent_id, status);

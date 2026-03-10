-- Proposal comments: flat comments per proposal
CREATE TABLE IF NOT EXISTS proposal_comments (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proposal_comments_proposal ON proposal_comments(proposal_id, created_at);

-- Proposal revisions: full snapshots of previous proposal versions
CREATE TABLE IF NOT EXISTS proposal_revisions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  revision_number INTEGER NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proposal_revisions_proposal ON proposal_revisions(proposal_id, revision_number);
